"""Processing pipeline: DICOM validation, TotalSegmentator orchestration, job management."""
import os
import uuid
import time
import asyncio
import logging
import zipfile
import tempfile
import json
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import partial
from pathlib import Path

import numpy as np

from app.models import (
    JobStatus,
    SegmentationQuality,
    VolumeQuality,
    ProgressUpdate,
)
from app.websocket import manager
from app.color_map import get_label_schema_for_backend
from app.mesh_generation import generate_all_meshes
from app.volume_export import export_dicom_series_to_nifti, export_volume_bundle, load_dicom_series

logger = logging.getLogger(__name__)

# In-memory job store (suitable for single-instance deployment)
_jobs: dict[str, "JobState"] = {}

# Concurrency guard: only one pipeline at a time (TotalSegmentator is very resource-heavy)
_pipeline_lock = asyncio.Lock()

# Base directory for processing outputs
OUTPUT_BASE_ENV_VAR = "SUPERNOVA_OUTPUT_DIR"
TOTALSEGMENTATOR_COMMAND_ENV_VAR = "SUPERNOVA_TOTALSEGMENTATOR_COMMAND"
MRSEGMENTATOR_COMMAND_ENV_VAR = "SUPERNOVA_MRSEGMENTATOR_COMMAND"
OUTPUT_BASE = os.path.join(tempfile.gettempdir(), "supernova_jobs")
RECENT_UPLOADS_PATH = os.path.join(OUTPUT_BASE, "recent_uploads.json")
RECENT_UPLOAD_LIMIT = 5
DEFAULT_USER_ID = "local-user"
SUPPORTED_TORSO_KEYWORDS = {
    "abdomen",
    "abdominal",
    "pelvis",
    "pelvic",
    "chest",
    "thorax",
    "thoracic",
    "torso",
}
UNSUPPORTED_MRI_SEQUENCE_KEYWORDS = {
    "dynamic",
    "dyn",
    "dce",
    "perfusion",
    "diffusion",
    "diff",
    "adc",
    "localizer",
    "survey",
}
UNSUPPORTED_MRI_KEYWORDS = {
    "brain",
    "head",
    "skull",
    "spine",
    "cervical",
    "knee",
    "shoulder",
    "elbow",
    "wrist",
    "hand",
    "ankle",
    "foot",
}
MIN_SUPPORTED_MRI_Z_COVERAGE_MM = 96.0
MIN_SUPPORTED_MRI_SLICE_COUNT = 24


@dataclass(frozen=True)
class StudyProfile:
    modality: str
    is_supported: bool
    reason: str = ""


@dataclass
class JobState:
    job_id: str
    status: JobStatus = JobStatus.PENDING
    progress: int = 0
    message: str = ""
    seg_quality: SegmentationQuality = SegmentationQuality.FAST
    vol_quality: VolumeQuality = VolumeQuality.STANDARD
    start_time: float = field(default_factory=time.time)
    error: str | None = None
    zip_path: str | None = None


def _normalize_study_text(value: object) -> str:
    return str(value or "").strip().lower()


def _get_numeric_sequence(values: object) -> tuple[float, ...]:
    if not isinstance(values, (list, tuple)):
        return ()

    numeric_values: list[float] = []
    for value in values:
        try:
            numeric_values.append(float(value))
        except (TypeError, ValueError):
            return ()
    return tuple(numeric_values)


def _estimate_mri_z_coverage_mm(metadata: dict | None) -> float | None:
    if not isinstance(metadata, dict):
        return None

    spacing = _get_numeric_sequence(metadata.get("spacing"))
    dimensions = _get_numeric_sequence(metadata.get("dimensions"))
    study = metadata.get("study", {}) if isinstance(metadata.get("study"), dict) else {}

    slice_spacing = spacing[0] if spacing else None
    slice_count = None

    if dimensions:
        slice_count = max(int(round(dimensions[0])), 0)
    else:
        try:
            slice_count = max(int(study.get("slice_count")), 0)
        except (TypeError, ValueError):
            slice_count = None

    if slice_spacing is None or slice_count is None or slice_count <= 0:
        return None

    return slice_spacing * slice_count


def profile_study(metadata: dict | None) -> StudyProfile:
    study = metadata.get("study", {}) if isinstance(metadata, dict) else {}
    modality = _normalize_study_text(study.get("modality")).upper()

    if modality == "CT":
        return StudyProfile(modality="CT", is_supported=True)

    if modality not in {"MR", "MRI"}:
        return StudyProfile(
            modality=modality or "UNKNOWN",
            is_supported=False,
            reason="Unsupported imaging modality for segmentation.",
        )

    text_parts = [
        _normalize_study_text(study.get("body_part_examined")),
        _normalize_study_text(study.get("study_description")),
        _normalize_study_text(study.get("series_description")),
    ]
    combined_text = " ".join(part for part in text_parts if part)

    if any(keyword in combined_text for keyword in SUPPORTED_TORSO_KEYWORDS):
        is_torso_series = True
    else:
        is_torso_series = False

    if any(keyword in combined_text for keyword in UNSUPPORTED_MRI_KEYWORDS):
        return StudyProfile(
            modality="MR",
            is_supported=False,
            reason="MRI uploads are currently supported only for torso studies.",
        )

    if any(keyword in combined_text for keyword in UNSUPPORTED_MRI_SEQUENCE_KEYWORDS):
        return StudyProfile(
            modality="MR",
            is_supported=False,
            reason="MRI uploads currently support only anatomical torso series; dynamic or derived series are not supported.",
        )

    z_coverage_mm = _estimate_mri_z_coverage_mm(metadata)
    try:
        slice_count = int(study.get("slice_count"))
    except (TypeError, ValueError):
        dimensions = _get_numeric_sequence(metadata.get("dimensions")) if isinstance(metadata, dict) else ()
        slice_count = int(round(dimensions[0])) if dimensions else 0

    if z_coverage_mm is not None and z_coverage_mm < MIN_SUPPORTED_MRI_Z_COVERAGE_MM:
        return StudyProfile(
            modality="MR",
            is_supported=False,
            reason="MRI uploads currently require anatomical torso coverage; limited-field-of-view series do not segment reliably.",
        )

    if slice_count and slice_count < MIN_SUPPORTED_MRI_SLICE_COUNT:
        return StudyProfile(
            modality="MR",
            is_supported=False,
            reason="MRI uploads currently require anatomical torso coverage; limited-field-of-view series do not segment reliably.",
        )

    if is_torso_series:
        return StudyProfile(modality="MR", is_supported=True)

    return StudyProfile(modality="MR", is_supported=True)


def select_segmentation_backend(profile: StudyProfile) -> str:
    if not profile.is_supported:
        raise ValueError(profile.reason or "Unsupported study for segmentation.")

    if profile.modality == "CT":
        return "totalsegmentator"

    if profile.modality == "MR":
        return "mrsegmentator"

    raise ValueError(f"Unsupported study modality: {profile.modality}")


def run_segmentation_for_study(
    dicom_dir: str,
    output_path: str,
    fast: bool,
    metadata: dict | None,
) -> str:
    profile = profile_study(metadata)
    backend = select_segmentation_backend(profile)

    if backend == "totalsegmentator":
        _run_totalsegmentator(dicom_dir, output_path, fast)
        return backend

    _run_mrsegmentator(dicom_dir, output_path, fast)
    return backend


def _resolve_segmentation_executable(
    env_var_name: str,
    default_command: str,
    tool_name: str,
) -> str:
    configured_command = os.environ.get(env_var_name)
    if configured_command:
        return configured_command

    resolved_command = shutil.which(default_command)
    if resolved_command:
        return resolved_command

    raise RuntimeError(
        f"{tool_name} CLI was not found in PATH. Set {env_var_name} to the executable path."
    )


def _run_mrsegmentator(dicom_dir: str, output_path: str, fast: bool) -> None:
    """Run MRSegmentator via CLI and normalize its output to a NIfTI file path."""
    executable = _resolve_segmentation_executable(
        MRSEGMENTATOR_COMMAND_ENV_VAR,
        "mrsegmentator",
        "MRSegmentator",
    )

    with tempfile.TemporaryDirectory() as temp_output_dir:
        nifti_input_path = os.path.join(temp_output_dir, "study.nii.gz")
        export_dicom_series_to_nifti(dicom_dir, nifti_input_path)

        command = [
            executable,
            "--input",
            nifti_input_path,
            "--outdir",
            temp_output_dir,
        ]
        if fast:
            command.extend(["--fold", "0"])

        subprocess.run(command, check=True)

        output_candidates = sorted(Path(temp_output_dir).glob("*.nii.gz"))
        if not output_candidates:
            output_candidates = sorted(Path(temp_output_dir).glob("*.nii"))
        if not output_candidates:
            raise FileNotFoundError("MRSegmentator did not produce a NIfTI segmentation output.")

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        shutil.copyfile(output_candidates[0], output_path)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_output_base() -> str:
    return os.environ.get(OUTPUT_BASE_ENV_VAR, OUTPUT_BASE)


def get_recent_uploads_path() -> str:
    configured_output_base = os.environ.get(OUTPUT_BASE_ENV_VAR)
    if configured_output_base:
        return os.path.join(configured_output_base, "recent_uploads.json")
    return RECENT_UPLOADS_PATH


def _load_recent_uploads() -> list[dict[str, object]]:
    recent_uploads_path = get_recent_uploads_path()
    if not os.path.exists(recent_uploads_path):
        return []

    try:
        with open(recent_uploads_path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        logger.warning("Failed to read recent upload catalog", exc_info=True)
        return []

    return payload if isinstance(payload, list) else []


def _save_recent_uploads(entries: list[dict[str, object]]) -> None:
    output_base = get_output_base()
    recent_uploads_path = get_recent_uploads_path()
    os.makedirs(output_base, exist_ok=True)
    temp_path = os.path.join(output_base, f".recent_uploads.{uuid.uuid4().hex}.tmp")

    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(entries, handle)

    os.replace(temp_path, recent_uploads_path)


def _sort_recent_uploads(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    return sorted(
        entries,
        key=lambda entry: (
            str(entry.get("created_at", "")),
            str(entry.get("updated_at", "")),
        ),
        reverse=True,
    )


def update_recent_upload(
    job_id: str,
    *,
    user_id: str = DEFAULT_USER_ID,
    **fields: object,
) -> None:
    entries = _load_recent_uploads()
    now = _utc_now_iso()
    entry_index = next(
        (
            index
            for index, entry in enumerate(entries)
            if entry.get("job_id") == job_id and entry.get("user_id") == user_id
        ),
        None,
    )

    if entry_index is None:
        entry: dict[str, object] = {
            "job_id": job_id,
            "user_id": user_id,
            "created_at": now,
        }
        entries.append(entry)
    else:
        entry = entries[entry_index]
        entry.setdefault("created_at", now)

    entry.update(fields)
    entry["updated_at"] = now

    _save_recent_uploads(_sort_recent_uploads(entries))


def register_recent_upload(
    job_id: str,
    filename: str,
    seg_quality: SegmentationQuality,
    vol_quality: VolumeQuality,
    *,
    user_id: str = DEFAULT_USER_ID,
) -> None:
    update_recent_upload(
        job_id,
        user_id=user_id,
        file_name=filename,
        seg_quality=seg_quality.value,
        vol_quality=vol_quality.value,
        status=JobStatus.PENDING.value,
        progress=0,
        message="Upload received",
        error=None,
    )


def load_job_result_metadata(job_id: str) -> dict | None:
    mesh_dir = os.path.join(get_job_output_dir(job_id), "meshes")
    metadata_path = os.path.join(mesh_dir, "metadata.json")

    if not os.path.exists(metadata_path):
        return None

    with open(metadata_path, encoding="utf-8") as handle:
        metadata = json.load(handle)

    volume_dir = os.path.join(get_job_output_dir(job_id), "volume")
    volume_meta_path = os.path.join(volume_dir, "volume_meta.json")
    segmentation_meta_path = os.path.join(volume_dir, "segmentation_meta.json")

    if os.path.exists(volume_meta_path) and os.path.exists(segmentation_meta_path):
        with open(volume_meta_path, encoding="utf-8") as volume_file:
            intensity = json.load(volume_file)
        with open(segmentation_meta_path, encoding="utf-8") as segmentation_file:
            segmentation = json.load(segmentation_file)

        metadata["volume"] = {
            "intensity": intensity,
            "segmentation": segmentation,
        }

    return metadata


def list_recent_uploads(
    *,
    user_id: str = DEFAULT_USER_ID,
    limit: int = RECENT_UPLOAD_LIMIT,
) -> list[dict[str, object]]:
    uploads: list[dict[str, object]] = []

    for entry in _sort_recent_uploads(_load_recent_uploads()):
        if entry.get("user_id") != user_id:
            continue

        upload = dict(entry)
        metadata = load_job_result_metadata(str(upload.get("job_id", "")))
        organs = metadata.get("organs", []) if isinstance(metadata, dict) else []
        upload["result_available"] = metadata is not None
        upload["organ_count"] = len(organs) if isinstance(organs, list) else 0
        upload["preview_organs"] = [
            organ.get("name")
            for organ in organs[:3]
            if isinstance(organ, dict) and isinstance(organ.get("name"), str)
        ]
        uploads.append(upload)

        if len(uploads) >= limit:
            break

    return uploads


def create_job(
    seg_quality: SegmentationQuality,
    vol_quality: VolumeQuality,
) -> str:
    """Create a new processing job and return its ID."""
    job_id = uuid.uuid4().hex[:12]
    _jobs[job_id] = JobState(
        job_id=job_id,
        seg_quality=seg_quality,
        vol_quality=vol_quality,
    )
    return job_id


def get_job(job_id: str) -> JobState | None:
    """Retrieve job state by ID."""
    return _jobs.get(job_id)


def get_job_output_dir(job_id: str) -> str:
    """Return the output directory path for a job."""
    return os.path.join(get_output_base(), job_id)


def validate_zip_contains_dicom(zip_path: str) -> tuple[bool, str]:
    """Check if a ZIP file contains DICOM files.

    Returns:
        (is_valid, message) tuple
    """
    if not os.path.exists(zip_path):
        return False, "File does not exist"

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            names = zf.namelist()
    except (zipfile.BadZipFile, Exception):
        return False, "Invalid or corrupt ZIP file"

    # Check for .dcm files
    dcm_files = [n for n in names if n.lower().endswith(".dcm")]
    if not dcm_files:
        # Also check for DICOM magic bytes in files without .dcm extension
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                for name in names:
                    if name.endswith("/"):
                        continue
                    data = zf.read(name)
                    if len(data) > 132 and data[128:132] == b"DICM":
                        dcm_files.append(name)
                        break
        except Exception:
            pass

    if not dcm_files:
        return False, "No DICOM files found in ZIP archive"

    return True, f"Found {len(dcm_files)} DICOM file(s)"


def extract_zip(zip_path: str, output_dir: str) -> None:
    """Extract a ZIP file to the specified directory."""
    os.makedirs(output_dir, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(output_dir)


async def _update_progress(
    job: JobState,
    status: JobStatus,
    progress: int,
    message: str,
) -> None:
    """Update job state and broadcast progress via WebSocket."""
    job.status = status
    job.progress = progress
    job.message = message
    update_recent_upload(
        job.job_id,
        status=status.value,
        progress=progress,
        message=message,
        error=job.error,
    )

    elapsed = time.time() - job.start_time
    update = ProgressUpdate(
        job_id=job.job_id,
        status=status,
        progress=progress,
        message=message,
        elapsed_seconds=elapsed,
    )
    await manager.send_progress(job.job_id, update)


def _find_dicom_dir(extract_dir: str) -> str:
    """Find the directory containing .dcm files within the extracted archive."""
    for root, dirs, files in os.walk(extract_dir):
        dcm_files = [f for f in files if f.lower().endswith(".dcm")]
        if dcm_files:
            return root
    return extract_dir


async def run_pipeline(job_id: str, zip_path: str) -> None:
    """Run the full processing pipeline for a job.

    Steps:
    1. Validate DICOM files
    2. Run TotalSegmentator
    3. Generate STL meshes
    4. Prepare volume data

    Only one pipeline runs at a time to avoid memory/shm exhaustion.
    """
    job = get_job(job_id)
    if job is None:
        logger.error(f"Job {job_id} not found")
        return

    # Wait for any running pipeline to finish before starting
    async with _pipeline_lock:
        await _run_pipeline_inner(job, zip_path)


async def _run_pipeline_inner(job: "JobState", zip_path: str) -> None:
    """Inner pipeline logic, called under the concurrency lock."""
    job_id = job.job_id
    job.zip_path = zip_path
    output_dir = get_job_output_dir(job_id)
    os.makedirs(output_dir, exist_ok=True)
    extract_dir = os.path.join(output_dir, "dicom")
    mesh_dir = os.path.join(output_dir, "meshes")
    volume_dir = os.path.join(output_dir, "volume")

    try:
        # Stage 1: Validate
        await _update_progress(job, JobStatus.VALIDATING, 5, "Validating DICOM files...")
        is_valid, msg = validate_zip_contains_dicom(zip_path)
        if not is_valid:
            job.error = msg
            await _update_progress(job, JobStatus.FAILED, 0, f"Validation failed: {msg}")
            return

        extract_zip(zip_path, extract_dir)
        dicom_dir = _find_dicom_dir(extract_dir)

        # Stage 2: Segmentation
        await _update_progress(job, JobStatus.SEGMENTING, 10, "Running AI segmentation model...")
        seg_output = os.path.join(output_dir, "segmentation.nii.gz")
        is_fast = job.seg_quality == SegmentationQuality.FAST
        loop = asyncio.get_event_loop()

        _, dicom_metadata = await loop.run_in_executor(
            None,
            load_dicom_series,
            dicom_dir,
        )

        segmentation_backend = await loop.run_in_executor(
            None,
            run_segmentation_for_study,
            dicom_dir,
            seg_output,
            is_fast,
            dicom_metadata,
        )

        if not os.path.exists(seg_output):
            raise FileNotFoundError("Segmentation output not produced")

        await _update_progress(job, JobStatus.SEGMENTING, 75, "Segmentation complete")

        # Stage 3: Mesh generation
        await _update_progress(job, JobStatus.MESHING, 80, "Generating 3D meshes...")

        def mesh_progress(current, total, name):
            pct = 80 + int((current / max(total, 1)) * 15)
            asyncio.run_coroutine_threadsafe(
                _update_progress(job, JobStatus.MESHING, pct, f"Meshing: {name}"),
                loop,
            )

        organs = await loop.run_in_executor(
            None,
            partial(
                generate_all_meshes,
                seg_output,
                mesh_dir,
                progress_callback=mesh_progress,
                label_schema=get_label_schema_for_backend(segmentation_backend),
            ),
        )

        # Stage 4: Volume preparation
        await _update_progress(job, JobStatus.VOLUME_PREP, 95, "Preparing volume data...")
        is_high_quality = job.vol_quality == VolumeQuality.HIGH
        await loop.run_in_executor(
            None,
            _prepare_volume,
            dicom_dir,
            seg_output,
            volume_dir,
            is_high_quality,
        )

        # Done
        await _update_progress(job, JobStatus.COMPLETED, 100, "Processing complete!")

    except Exception as e:
        logger.exception(f"Pipeline failed for job {job_id}")
        job.error = str(e)
        await _update_progress(job, JobStatus.FAILED, 0, f"Error: {str(e)}")


def _prepare_volume(
    dicom_dir: str,
    segmentation_path: str,
    output_dir: str,
    high_quality: bool,
) -> dict:
    """Load DICOM series and export aligned CT and segmentation volumes."""
    volume, metadata = load_dicom_series(dicom_dir)
    return export_volume_bundle(volume, metadata, segmentation_path, output_dir, high_quality)


def _run_totalsegmentator(dicom_dir: str, output_path: str, fast: bool) -> None:
    """Run TotalSegmentator via CLI so it can live in an isolated environment."""
    executable = _resolve_segmentation_executable(
        TOTALSEGMENTATOR_COMMAND_ENV_VAR,
        "TotalSegmentator",
        "TotalSegmentator",
    )

    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    command = [
        executable,
        "-i",
        dicom_dir,
        "-o",
        output_path,
        "--ml",
        "--task",
        "total",
        "--device",
        "cpu",
    ]
    if fast:
        command.append("--fast")

    subprocess.run(command, check=True)
