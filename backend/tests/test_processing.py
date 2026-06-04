"""Tests for the processing pipeline (DICOM validation, job orchestration)."""
import asyncio
import os
import json
import tempfile
import zipfile
import pytest
import numpy as np
from unittest.mock import patch, MagicMock, AsyncMock
from pathlib import Path

from app.processing import (
    validate_zip_contains_dicom,
    extract_zip,
    create_job,
    get_job,
    get_output_base,
    get_job_output_dir,
    run_pipeline,
    _pipeline_lock,
    _run_pipeline_inner,
    JobState,
    profile_study,
    _resolve_segmentation_executable,
    _run_totalsegmentator,
    run_segmentation_for_study,
    select_segmentation_backend,
)
from app.models import JobStatus, SegmentationQuality, VolumeQuality


def _make_fake_dicom_bytes():
    """Create minimal bytes that look like a DICOM file (has the DICM magic at offset 128)."""
    header = b'\x00' * 128 + b'DICM'
    # Add a minimal data element so pydicom-like checks pass
    header += b'\x00' * 100
    return header


def _make_dicom_zip(tmp_path, num_files=3, include_non_dicom=False):
    """Create a ZIP file containing fake DICOM files."""
    zip_path = os.path.join(tmp_path, "test.zip")
    with zipfile.ZipFile(zip_path, "w") as zf:
        for i in range(num_files):
            zf.writestr(f"scan/slice_{i:04d}.dcm", _make_fake_dicom_bytes())
        if include_non_dicom:
            zf.writestr("readme.txt", b"not a dicom file")
    return zip_path


def _make_non_dicom_zip(tmp_path):
    """Create a ZIP with no DICOM files."""
    zip_path = os.path.join(tmp_path, "bad.zip")
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("data.csv", b"col1,col2\n1,2\n")
        zf.writestr("notes.txt", b"nothing here")
    return zip_path


class _ImmediateExecutorLoop:
    async def run_in_executor(self, _executor, func, *args):
        return func(*args)


class TestValidateZipContainsDicom:
    def test_valid_dicom_zip(self, tmp_path):
        zip_path = _make_dicom_zip(str(tmp_path))
        is_valid, message = validate_zip_contains_dicom(zip_path)
        assert is_valid is True
        assert "dcm" in message.lower() or "dicom" in message.lower() or "found" in message.lower()

    def test_no_dicom_files(self, tmp_path):
        zip_path = _make_non_dicom_zip(str(tmp_path))
        is_valid, message = validate_zip_contains_dicom(zip_path)
        assert is_valid is False
        assert "no" in message.lower() or "dicom" in message.lower()

    def test_mixed_files_still_valid(self, tmp_path):
        zip_path = _make_dicom_zip(str(tmp_path), include_non_dicom=True)
        is_valid, message = validate_zip_contains_dicom(zip_path)
        assert is_valid is True

    def test_nonexistent_file(self):
        is_valid, message = validate_zip_contains_dicom("/nonexistent/path.zip")
        assert is_valid is False

    def test_corrupt_zip(self, tmp_path):
        bad_path = os.path.join(str(tmp_path), "corrupt.zip")
        with open(bad_path, "wb") as f:
            f.write(b"this is not a zip file at all")
        is_valid, message = validate_zip_contains_dicom(bad_path)
        assert is_valid is False


class TestExtractZip:
    def test_extracts_files(self, tmp_path):
        zip_path = _make_dicom_zip(str(tmp_path))
        extract_dir = os.path.join(str(tmp_path), "extracted")
        extract_zip(zip_path, extract_dir)

        extracted_files = list(Path(extract_dir).rglob("*.dcm"))
        assert len(extracted_files) == 3

    def test_creates_output_dir(self, tmp_path):
        zip_path = _make_dicom_zip(str(tmp_path))
        extract_dir = os.path.join(str(tmp_path), "new_dir", "sub_dir")
        extract_zip(zip_path, extract_dir)
        assert os.path.isdir(extract_dir)


class TestJobManagement:
    def test_create_job_returns_id(self):
        job_id = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)
        assert isinstance(job_id, str)
        assert len(job_id) > 0

    def test_create_job_unique_ids(self):
        id1 = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)
        id2 = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)
        assert id1 != id2

    def test_get_job_returns_state(self):
        job_id = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)
        state = get_job(job_id)
        assert state is not None
        assert isinstance(state, JobState)
        assert state.status == JobStatus.PENDING
        assert state.seg_quality == SegmentationQuality.FAST

    def test_get_job_unknown_returns_none(self):
        state = get_job("nonexistent-job-id")
        assert state is None

    def test_job_output_dir(self):
        job_id = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)
        output_dir = get_job_output_dir(job_id)
        assert job_id in output_dir

    def test_output_base_uses_env_override(self, monkeypatch):
        monkeypatch.setenv("SUPERNOVA_OUTPUT_DIR", "/srv/supernova-data")

        assert get_output_base() == "/srv/supernova-data"
        assert get_job_output_dir("job-123") == os.path.join(
            "/srv/supernova-data",
            "job-123",
        )

    def test_job_initial_progress(self):
        job_id = create_job(SegmentationQuality.FULL, VolumeQuality.HIGH)
        state = get_job(job_id)
        assert state.progress == 0
        assert state.status == JobStatus.PENDING
        assert state.vol_quality == VolumeQuality.HIGH


class TestPipelineConcurrency:
    """Verify only one pipeline runs at a time."""

    @pytest.mark.asyncio
    async def test_pipeline_lock_serializes_runs(self, tmp_path):
        """Two pipelines started concurrently should run sequentially, not in parallel."""
        execution_order = []

        async def fake_inner(job, zip_path):
            execution_order.append(("start", job.job_id))
            await asyncio.sleep(0.05)
            execution_order.append(("end", job.job_id))

        zip_path = _make_dicom_zip(str(tmp_path))
        id1 = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)
        id2 = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)

        with patch("app.processing._run_pipeline_inner", side_effect=fake_inner):
            await asyncio.gather(
                run_pipeline(id1, zip_path),
                run_pipeline(id2, zip_path),
            )

        # With serialization, the first pipeline must finish before the second starts
        assert execution_order[0][0] == "start"
        assert execution_order[1][0] == "end"
        assert execution_order[0][1] == execution_order[1][1]  # same job
        assert execution_order[2][0] == "start"
        assert execution_order[3][0] == "end"

    @pytest.mark.asyncio
    async def test_pipeline_nonexistent_job_skips(self):
        """run_pipeline should return immediately if job_id doesn't exist."""
        await run_pipeline("nonexistent-id", "/fake/path.zip")
        # Should not raise


class TestStudyProfiling:
    def test_selects_totalsegmentator_for_ct_studies(self):
        profile = profile_study(
            {
                "study": {
                    "modality": "CT",
                    "body_part_examined": "ABDOMEN",
                    "study_description": "CT Abdomen Pelvis",
                    "series_description": "Portal venous",
                }
            }
        )

        assert profile.modality == "CT"
        assert profile.is_supported is True
        assert select_segmentation_backend(profile) == "totalsegmentator"

    def test_selects_mrsegmentator_for_supported_mri_studies(self):
        profile = profile_study(
            {
                "study": {
                    "modality": "MR",
                    "body_part_examined": "ABDOMEN",
                    "study_description": "MRI Abdomen",
                    "series_description": "T2 Dixon",
                }
            }
        )

        assert profile.modality == "MR"
        assert profile.is_supported is True
        assert select_segmentation_backend(profile) == "mrsegmentator"

    def test_rejects_explicitly_unsupported_mri_studies(self):
        profile = profile_study(
            {
                "study": {
                    "modality": "MR",
                    "body_part_examined": "BRAIN",
                    "study_description": "MRI Brain",
                    "series_description": "T1",
                }
            }
        )

        assert profile.modality == "MR"
        assert profile.is_supported is False
        assert "torso" in profile.reason.lower()

    def test_rejects_dynamic_low_coverage_prostate_mri(self):
        profile = profile_study(
            {
                "study": {
                    "modality": "MR",
                    "body_part_examined": "PROSTATE",
                    "study_description": "MR prostaat kanker detectie WDS_mc MCAPRODETW",
                    "series_description": "tfl_dyn_fast_tra_1.5x1.5_t3.5sec",
                    "slice_count": 16,
                },
                "spacing": [3.0, 1.5, 1.5],
                "dimensions": [16, 128, 128],
            }
        )

        assert profile.modality == "MR"
        assert profile.is_supported is False
        assert "coverage" in profile.reason.lower() or "anatomical" in profile.reason.lower()


class TestSegmentationRouting:
    @patch("app.processing._run_mrsegmentator")
    @patch("app.processing._run_totalsegmentator")
    def test_routes_ct_studies_to_totalsegmentator(self, mock_totalsegmentator, mock_mrsegmentator):
        run_segmentation_for_study(
            "dicom-dir",
            "segmentation.nii.gz",
            True,
            {
                "study": {
                    "modality": "CT",
                    "study_description": "CT Abdomen",
                }
            },
        )

        mock_totalsegmentator.assert_called_once_with("dicom-dir", "segmentation.nii.gz", True)
        mock_mrsegmentator.assert_not_called()

    @patch("app.processing._run_mrsegmentator")
    @patch("app.processing._run_totalsegmentator")
    def test_routes_supported_mri_studies_to_mrsegmentator(self, mock_totalsegmentator, mock_mrsegmentator):
        run_segmentation_for_study(
            "dicom-dir",
            "segmentation.nii.gz",
            False,
            {
                "study": {
                    "modality": "MR",
                    "study_description": "MRI Abdomen",
                }
            },
        )

        mock_mrsegmentator.assert_called_once_with("dicom-dir", "segmentation.nii.gz", False)
        mock_totalsegmentator.assert_not_called()

    @patch("app.processing._run_mrsegmentator")
    @patch("app.processing._run_totalsegmentator")
    def test_rejects_unsupported_mri_studies_before_segmentation(self, mock_totalsegmentator, mock_mrsegmentator):
        with pytest.raises(ValueError, match="torso"):
            run_segmentation_for_study(
                "dicom-dir",
                "segmentation.nii.gz",
                False,
                {
                    "study": {
                        "modality": "MR",
                        "study_description": "MRI Brain",
                    }
                },
            )

        mock_mrsegmentator.assert_not_called()
        mock_totalsegmentator.assert_not_called()


class TestSegmentationExecutables:
    def test_resolve_segmentation_executable_prefers_env_override(self, monkeypatch):
        monkeypatch.setenv("SUPERNOVA_TOTALSEGMENTATOR_COMMAND", "/opt/totalsegmentator/bin/TotalSegmentator")

        resolved = _resolve_segmentation_executable(
            "SUPERNOVA_TOTALSEGMENTATOR_COMMAND",
            "TotalSegmentator",
            "TotalSegmentator",
        )

        assert resolved == "/opt/totalsegmentator/bin/TotalSegmentator"

    def test_resolve_segmentation_executable_raises_when_missing(self, monkeypatch):
        monkeypatch.delenv("SUPERNOVA_MRSEGMENTATOR_COMMAND", raising=False)

        with patch("app.processing.shutil.which", return_value=None):
            with pytest.raises(RuntimeError, match="SUPERNOVA_MRSEGMENTATOR_COMMAND"):
                _resolve_segmentation_executable(
                    "SUPERNOVA_MRSEGMENTATOR_COMMAND",
                    "mrsegmentator",
                    "MRSegmentator",
                )

    def test_run_totalsegmentator_invokes_cli_command(self, monkeypatch):
        monkeypatch.setenv("SUPERNOVA_TOTALSEGMENTATOR_COMMAND", "/opt/totalsegmentator/bin/TotalSegmentator")

        with patch("app.processing.subprocess.run") as mock_run:
            _run_totalsegmentator("dicom-dir", "segmentation.nii.gz", True)

        mock_run.assert_called_once_with(
            [
                "/opt/totalsegmentator/bin/TotalSegmentator",
                "-i",
                "dicom-dir",
                "-o",
                "segmentation.nii.gz",
                "--ml",
                "--task",
                "total",
                "--device",
                "cpu",
                "--fast",
            ],
            check=True,
        )


class TestPipelineSegmentationRouting:
    @pytest.mark.asyncio
    async def test_pipeline_routes_supported_mri_through_study_aware_dispatch(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SUPERNOVA_OUTPUT_DIR", str(tmp_path))
        job_id = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)
        job = get_job(job_id)
        assert job is not None

        dicom_dir = tmp_path / "dicom"
        dicom_dir.mkdir()

        def fake_segmentation(dicom_arg, output_arg, fast_arg, metadata_arg):
            Path(output_arg).write_bytes(b"seg")
            assert dicom_arg == str(dicom_dir)
            assert fast_arg is True
            assert metadata_arg["study"]["modality"] == "MR"

        with (
            patch("app.processing.validate_zip_contains_dicom", return_value=(True, "ok")),
            patch("app.processing.extract_zip"),
            patch("app.processing._find_dicom_dir", return_value=str(dicom_dir)),
            patch("app.processing.load_dicom_series", return_value=(
                np.zeros((2, 2, 2), dtype=np.int16),
                {"study": {"modality": "MR", "study_description": "MRI Abdomen"}},
            )),
            patch("app.processing.run_segmentation_for_study", side_effect=fake_segmentation) as mock_run_segmentation,
            patch("app.processing.generate_all_meshes", return_value=[]),
            patch("app.processing._prepare_volume", return_value={}),
            patch("app.processing.asyncio.get_event_loop", return_value=_ImmediateExecutorLoop()),
            patch("app.processing.update_recent_upload"),
            patch("app.processing.manager.send_progress", new_callable=AsyncMock),
        ):
            await _run_pipeline_inner(job, str(tmp_path / "upload.zip"))

        mock_run_segmentation.assert_called_once()
        assert job.status == JobStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_pipeline_fails_before_meshing_for_unsupported_mri(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SUPERNOVA_OUTPUT_DIR", str(tmp_path))
        job_id = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)
        job = get_job(job_id)
        assert job is not None

        dicom_dir = tmp_path / "dicom"
        dicom_dir.mkdir()

        with (
            patch("app.processing.validate_zip_contains_dicom", return_value=(True, "ok")),
            patch("app.processing.extract_zip"),
            patch("app.processing._find_dicom_dir", return_value=str(dicom_dir)),
            patch("app.processing.load_dicom_series", return_value=(
                np.zeros((2, 2, 2), dtype=np.int16),
                {"study": {"modality": "MR", "study_description": "MRI Brain"}},
            )),
            patch(
                "app.processing.run_segmentation_for_study",
                side_effect=ValueError("MRI uploads are currently supported only for torso studies."),
            ),
            patch("app.processing.generate_all_meshes", return_value=[]) as mock_generate_meshes,
            patch("app.processing._prepare_volume", return_value={}),
            patch("app.processing.asyncio.get_event_loop", return_value=_ImmediateExecutorLoop()),
            patch("app.processing.update_recent_upload"),
            patch("app.processing.manager.send_progress", new_callable=AsyncMock),
        ):
            await _run_pipeline_inner(job, str(tmp_path / "upload.zip"))

        mock_generate_meshes.assert_not_called()
        assert job.status == JobStatus.FAILED
        assert job.error is not None
        assert "torso" in job.error.lower()

    @pytest.mark.asyncio
    async def test_pipeline_passes_backend_label_schema_to_mesh_generation(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SUPERNOVA_OUTPUT_DIR", str(tmp_path))
        job_id = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)
        job = get_job(job_id)
        assert job is not None

        dicom_dir = tmp_path / "dicom"
        dicom_dir.mkdir()

        def fake_segmentation(_dicom_arg, output_arg, _fast_arg, _metadata_arg):
            Path(output_arg).write_bytes(b"seg")
            return "mrsegmentator"

        with (
            patch("app.processing.validate_zip_contains_dicom", return_value=(True, "ok")),
            patch("app.processing.extract_zip"),
            patch("app.processing._find_dicom_dir", return_value=str(dicom_dir)),
            patch("app.processing.load_dicom_series", return_value=(
                np.zeros((2, 2, 2), dtype=np.int16),
                {"study": {"modality": "MR", "study_description": "MRI Abdomen"}},
            )),
            patch("app.processing.run_segmentation_for_study", side_effect=fake_segmentation),
            patch("app.processing.generate_all_meshes", return_value=[]) as mock_generate_meshes,
            patch("app.processing._prepare_volume", return_value={}),
            patch("app.processing.asyncio.get_event_loop", return_value=_ImmediateExecutorLoop()),
            patch("app.processing.update_recent_upload"),
            patch("app.processing.manager.send_progress", new_callable=AsyncMock),
        ):
            await _run_pipeline_inner(job, str(tmp_path / "upload.zip"))

        assert mock_generate_meshes.call_args is not None
        assert mock_generate_meshes.call_args.kwargs["label_schema"] == "mrsegmentator"

    @pytest.mark.asyncio
    async def test_pipeline_schedules_mesh_progress_from_executor_thread(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SUPERNOVA_OUTPUT_DIR", str(tmp_path))
        job_id = create_job(SegmentationQuality.FAST, VolumeQuality.STANDARD)
        job = get_job(job_id)
        assert job is not None

        dicom_dir = tmp_path / "dicom"
        dicom_dir.mkdir()

        def fake_segmentation(_dicom_arg, output_arg, _fast_arg, _metadata_arg):
            Path(output_arg).write_bytes(b"seg")
            return "mrsegmentator"

        def fake_generate_meshes(_seg_output, _mesh_dir, progress_callback=None, **_kwargs):
            assert progress_callback is not None
            progress_callback(1, 1, "spleen")
            return []

        with (
            patch("app.processing.validate_zip_contains_dicom", return_value=(True, "ok")),
            patch("app.processing.extract_zip"),
            patch("app.processing._find_dicom_dir", return_value=str(dicom_dir)),
            patch("app.processing.load_dicom_series", return_value=(
                np.zeros((2, 2, 2), dtype=np.int16),
                {"study": {"modality": "MR", "study_description": "MRI Abdomen"}},
            )),
            patch("app.processing.run_segmentation_for_study", side_effect=fake_segmentation),
            patch("app.processing.generate_all_meshes", side_effect=fake_generate_meshes),
            patch("app.processing._prepare_volume", return_value={}),
            patch("app.processing.update_recent_upload"),
            patch("app.processing.manager.send_progress", new_callable=AsyncMock) as mock_send_progress,
        ):
            await _run_pipeline_inner(job, str(tmp_path / "upload.zip"))
            await asyncio.sleep(0)

        assert job.status == JobStatus.COMPLETED
        assert any(
            call.args[1].message == "Meshing: spleen"
            for call in mock_send_progress.await_args_list
        )
