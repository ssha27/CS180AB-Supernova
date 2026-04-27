"""Processing pipeline: DICOM validation, TotalSegmentator orchestration, job management."""
import os
import uuid
import time
import asyncio
import logging
import zipfile
import tempfile
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from app.models import (
    JobStatus,
    SegmentationQuality,
    VolumeQuality,
    ProgressUpdate,
)
from app.websocket import manager
from app.mesh_generation import generate_all_meshes
from app.volume_export import export_volume_bundle, load_dicom_series

logger = logging.getLogger(__name__)

# In-memory job store (suitable for single-instance deployment)
_jobs: dict[str, "JobState"] = {}

# Concurrency guard: only one pipeline at a time (TotalSegmentator is very resource-heavy)
_pipeline_lock = asyncio.Lock()

# Base directory for processing outputs
OUTPUT_BASE = os.path.join(tempfile.gettempdir(), "supernova_jobs")
RECENT_UPLOADS_PATH = os.path.join(OUTPUT_BASE, "recent_uploads.json")
RECENT_UPLOAD_LIMIT = 5
DEFAULT_USER_ID = "local-user"


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


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_recent_uploads() -> list[dict[str, object]]:
    if not os.path.exists(RECENT_UPLOADS_PATH):
        return []

    try:
        with open(RECENT_UPLOADS_PATH, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        logger.warning("Failed to read recent upload catalog", exc_info=True)
        return []

    return payload if isinstance(payload, list) else []


def _save_recent_uploads(entries: list[dict[str, object]]) -> None:
    os.makedirs(OUTPUT_BASE, exist_ok=True)
    temp_path = os.path.join(OUTPUT_BASE, f".recent_uploads.{uuid.uuid4().hex}.tmp")

    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(entries, handle)

    os.replace(temp_path, RECENT_UPLOADS_PATH)


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
    return os.path.join(OUTPUT_BASE, job_id)


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

        # Run TotalSegmentator in a thread to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            _run_totalsegmentator,
            dicom_dir,
            seg_output,
            is_fast,
        )

        if not os.path.exists(seg_output):
            raise FileNotFoundError("Segmentation output not produced")

        await _update_progress(job, JobStatus.SEGMENTING, 75, "Segmentation complete")

        # Stage 3: Mesh generation
        await _update_progress(job, JobStatus.MESHING, 80, "Generating 3D meshes...")

        def mesh_progress(current, total, name):
            pct = 80 + int((current / max(total, 1)) * 15)
            asyncio.ensure_future(
                _update_progress(job, JobStatus.MESHING, pct, f"Meshing: {name}")
            )

        organs = await loop.run_in_executor(
            None,
            generate_all_meshes,
            seg_output,
            mesh_dir,
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
    """Run TotalSegmentator (blocking call, intended for use in executor)."""
    from totalsegmentator.python_api import totalsegmentator

    totalsegmentator(
        input=dicom_dir,
        output=output_path,
        ml=True,
        fast=fast,
        device="cpu",
        task="total",
    )
