"""Tests for Pydantic models."""
import pytest
from pydantic import ValidationError
from app.models import (
    SegmentationQuality,
    VolumeQuality,
    UploadConfig,
    JobStatus,
    ProgressUpdate,
    OrganInfo,
    JobResult,
    MemoryWarning,
    ErrorResponse,
)


class TestUploadConfig:
    def test_defaults(self):
        config = UploadConfig()
        assert config.segmentation_quality == SegmentationQuality.FAST
        assert config.volume_quality == VolumeQuality.STANDARD

    def test_full_quality(self):
        config = UploadConfig(
            segmentation_quality=SegmentationQuality.FULL,
            volume_quality=VolumeQuality.HIGH,
        )
        assert config.segmentation_quality == SegmentationQuality.FULL
        assert config.volume_quality == VolumeQuality.HIGH

    def test_from_string(self):
        config = UploadConfig(segmentation_quality="full", volume_quality="high")
        assert config.segmentation_quality == SegmentationQuality.FULL


class TestProgressUpdate:
    def test_valid_progress(self):
        update = ProgressUpdate(
            job_id="test-123",
            status=JobStatus.SEGMENTING,
            progress=50,
            message="Running model...",
        )
        assert update.progress == 50

    def test_progress_bounds(self):
        with pytest.raises(ValidationError):
            ProgressUpdate(
                job_id="test", status=JobStatus.PENDING, progress=-1
            )
        with pytest.raises(ValidationError):
            ProgressUpdate(
                job_id="test", status=JobStatus.PENDING, progress=101
            )

    def test_serialization(self):
        update = ProgressUpdate(
            job_id="test-123",
            status=JobStatus.COMPLETED,
            progress=100,
            elapsed_seconds=42.5,
        )
        data = update.model_dump()
        assert data["job_id"] == "test-123"
        assert data["status"] == "completed"
        assert data["progress"] == 100


class TestOrganInfo:
    def test_valid_organ(self):
        organ = OrganInfo(
            id=5, name="liver", color=[221, 130, 101], file="liver.stl", category="organs"
        )
        assert organ.name == "liver"

    def test_color_must_have_3_values(self):
        with pytest.raises(ValidationError):
            OrganInfo(id=1, name="test", color=[255, 0], file="test.stl")

    def test_color_allows_4_values_rgba(self):
        organ = OrganInfo(id=1, name="test", color=[255, 0, 0, 128], file="test.glb")
        assert len(organ.color) == 4


class TestJobResult:
    def test_empty_result(self):
        result = JobResult(job_id="test-123")
        assert result.organs == []
        assert result.total_organs == 0

    def test_with_organs(self):
        organs = [
            OrganInfo(id=5, name="liver", color=[221, 130, 101], file="liver.glb"),
            OrganInfo(id=1, name="spleen", color=[157, 108, 162], file="spleen.glb"),
        ]
        result = JobResult(job_id="test-123", organs=organs, total_organs=2)
        assert result.total_organs == 2


class TestMemoryWarning:
    def test_sufficient_memory(self):
        warn = MemoryWarning(
            available_gb=32.0, required_gb=12.0, sufficient=True
        )
        assert warn.sufficient is True

    def test_insufficient_memory(self):
        warn = MemoryWarning(
            available_gb=8.0,
            required_gb=12.0,
            sufficient=False,
            message="Insufficient RAM: 8.0 GB available, 12.0 GB required",
        )
        assert warn.sufficient is False


class TestErrorResponse:
    def test_basic_error(self):
        err = ErrorResponse(error="Invalid file format")
        assert err.error == "Invalid file format"
        assert err.detail == ""
