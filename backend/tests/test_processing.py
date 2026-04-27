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
    get_job_output_dir,
    run_pipeline,
    _pipeline_lock,
    JobState,
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
