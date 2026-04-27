"""Tests for API routes."""
import os
import json
import zipfile
import tempfile
import shutil
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport

from app.routes import router
from app.processing import _jobs, JobState, get_job_output_dir
from app.models import JobStatus, SegmentationQuality, VolumeQuality

# Create a minimal FastAPI app for testing
from fastapi import FastAPI

app = FastAPI()
app.include_router(router)


def _make_dicom_zip(path):
    """Create a minimal DICOM ZIP for upload testing."""
    header = b'\x00' * 128 + b'DICM' + b'\x00' * 100
    with zipfile.ZipFile(path, "w") as zf:
        for i in range(3):
            zf.writestr(f"scan/slice_{i:04d}.dcm", header)
    return path


def _make_non_dicom_zip(path):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("readme.txt", b"hello world")
    return path


@pytest.fixture
def cleanup_jobs():
    """Clear the job store before and after each test."""
    _jobs.clear()
    yield
    _jobs.clear()


@pytest.fixture(autouse=True)
def isolate_output_base(tmp_path, monkeypatch):
    output_base = str(tmp_path / "supernova_jobs")
    monkeypatch.setattr("app.processing.OUTPUT_BASE", output_base)
    monkeypatch.setattr(
        "app.processing.RECENT_UPLOADS_PATH",
        os.path.join(output_base, "recent_uploads.json"),
    )


class TestUploadEndpoint:
    @pytest.mark.asyncio
    async def test_upload_valid_zip(self, tmp_path, cleanup_jobs):
        zip_path = _make_dicom_zip(str(tmp_path / "valid.zip"))

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            with open(zip_path, "rb") as f:
                with patch(
                    "app.routes.asyncio.create_task",
                    side_effect=lambda coro: coro.close(),
                ):
                    resp = await client.post(
                        "/api/upload",
                        files={"file": ("test.zip", f, "application/zip")},
                        data={"seg_quality": "fast", "vol_quality": "standard"},
                    )

            recent_resp = await client.get("/api/recent-uploads")
            assert recent_resp.status_code == 200
            recent_uploads = recent_resp.json()
            assert len(recent_uploads) == 1
            assert recent_uploads[0]["file_name"] == "test.zip"
            assert recent_uploads[0]["status"] == "pending"

        assert resp.status_code == 200
        data = resp.json()
        assert "job_id" in data
        assert len(data["job_id"]) > 0

    @pytest.mark.asyncio
    async def test_upload_invalid_zip(self, tmp_path, cleanup_jobs):
        zip_path = _make_non_dicom_zip(str(tmp_path / "invalid.zip"))

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            with open(zip_path, "rb") as f:
                resp = await client.post(
                    "/api/upload",
                    files={"file": ("bad.zip", f, "application/zip")},
                    data={"seg_quality": "fast", "vol_quality": "standard"},
                )

        assert resp.status_code == 400
        assert "dicom" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_upload_no_file(self, cleanup_jobs):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/upload")

        assert resp.status_code == 422  # Validation error


class TestResultsEndpoint:
    @pytest.mark.asyncio
    async def test_results_completed_job(self, tmp_path, cleanup_jobs):
        # Set up a completed job with metadata
        job_id = "test123"
        _jobs[job_id] = JobState(
            job_id=job_id,
            status=JobStatus.COMPLETED,
            progress=100,
            seg_quality=SegmentationQuality.FAST,
            vol_quality=VolumeQuality.STANDARD,
        )

        output_dir = get_job_output_dir(job_id)
        mesh_dir = os.path.join(output_dir, "meshes")
        volume_dir = os.path.join(output_dir, "volume")
        os.makedirs(mesh_dir, exist_ok=True)
        os.makedirs(volume_dir, exist_ok=True)

        metadata = {
            "organs": [
                {"id": 1, "name": "spleen", "color": [157, 108, 162], "file": "spleen.stl",
                 "vertex_count": 5000, "category": "organs"}
            ],
            "preload": ["spleen"],
        }
        with open(os.path.join(mesh_dir, "metadata.json"), "w") as f:
            json.dump(metadata, f)

        with open(os.path.join(volume_dir, "volume_meta.json"), "w") as f:
            json.dump(
                {
                    "file": "volume.raw",
                    "dimensions": [32, 32, 32],
                    "spacing": [1.0, 1.0, 1.0],
                    "origin": [0.0, 0.0, 0.0],
                    "dtype": "int16",
                    "byte_order": "little",
                    "high_quality": False,
                },
                f,
            )
        with open(os.path.join(volume_dir, "segmentation_meta.json"), "w") as f:
            json.dump(
                {
                    "file": "segmentation.raw",
                    "dimensions": [32, 32, 32],
                    "spacing": [1.0, 1.0, 1.0],
                    "origin": [0.0, 0.0, 0.0],
                    "dtype": "uint16",
                    "byte_order": "little",
                    "high_quality": False,
                },
                f,
            )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(f"/api/results/{job_id}")

        assert resp.status_code == 200
        data = resp.json()
        assert "organs" in data
        assert len(data["organs"]) == 1
        assert data["organs"][0]["name"] == "spleen"
        assert data["volume"]["intensity"]["file"] == "volume.raw"
        assert data["volume"]["segmentation"]["file"] == "segmentation.raw"

        # Cleanup
        shutil.rmtree(output_dir, ignore_errors=True)

    @pytest.mark.asyncio
    async def test_results_completed_job_from_disk_without_in_memory_state(self, cleanup_jobs):
        job_id = "cached456"

        output_dir = get_job_output_dir(job_id)
        mesh_dir = os.path.join(output_dir, "meshes")
        os.makedirs(mesh_dir, exist_ok=True)

        with open(os.path.join(mesh_dir, "metadata.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "organs": [
                        {
                            "id": 1,
                            "name": "liver",
                            "color": [220, 90, 70],
                            "file": "liver.stl",
                            "vertex_count": 1000,
                            "category": "organs",
                        }
                    ],
                    "preload": ["liver"],
                },
                f,
            )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(f"/api/results/{job_id}")

        assert resp.status_code == 200
        assert resp.json()["organs"][0]["name"] == "liver"

    @pytest.mark.asyncio
    async def test_results_unknown_job(self, cleanup_jobs):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/results/nonexistent")

        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_results_pending_job(self, cleanup_jobs):
        job_id = "pending456"
        _jobs[job_id] = JobState(
            job_id=job_id,
            status=JobStatus.SEGMENTING,
            progress=50,
            seg_quality=SegmentationQuality.FAST,
            vol_quality=VolumeQuality.STANDARD,
        )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(f"/api/results/{job_id}")

        assert resp.status_code == 202
        data = resp.json()
        assert data["status"] == "segmenting"


class TestStatusEndpoint:
    @pytest.mark.asyncio
    async def test_status_existing_job(self, cleanup_jobs):
        job_id = "status789"
        _jobs[job_id] = JobState(
            job_id=job_id,
            status=JobStatus.MESHING,
            progress=85,
            message="Meshing: liver",
            seg_quality=SegmentationQuality.FAST,
            vol_quality=VolumeQuality.STANDARD,
        )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(f"/api/status/{job_id}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "meshing"
        assert data["progress"] == 85

    @pytest.mark.asyncio
    async def test_status_unknown_job(self, cleanup_jobs):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/status/unknown")

        assert resp.status_code == 404


class TestVolumeEndpoint:
    @pytest.mark.asyncio
    async def test_serves_segmentation_volume_file(self, cleanup_jobs):
        job_id = "volume123"
        volume_dir = os.path.join(get_job_output_dir(job_id), "volume")
        os.makedirs(volume_dir, exist_ok=True)

        raw_path = os.path.join(volume_dir, "segmentation.raw")
        expected_bytes = b"\x01\x00\x05\x00"
        with open(raw_path, "wb") as f:
            f.write(expected_bytes)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(f"/api/volume/{job_id}/segmentation.raw")

        assert resp.status_code == 200
        assert resp.content == expected_bytes

        shutil.rmtree(get_job_output_dir(job_id), ignore_errors=True)


class TestMemoryCheckEndpoint:
    @pytest.mark.asyncio
    async def test_memory_check(self, cleanup_jobs):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/memory-check?quality=fast")

        assert resp.status_code == 200
        data = resp.json()
        assert "sufficient" in data
        assert "available_gb" in data
        assert "required_gb" in data


class TestRecentUploadsEndpoint:
    @pytest.mark.asyncio
    async def test_recent_uploads_returns_latest_five(self, cleanup_jobs):
        output_base = os.path.dirname(get_job_output_dir("seed"))
        os.makedirs(output_base, exist_ok=True)

        catalog_path = os.path.join(output_base, "recent_uploads.json")
        entries = []
        for index in range(6):
            job_id = f"recent-{index}"
            entries.append(
                {
                    "job_id": job_id,
                    "user_id": "local-user",
                    "file_name": f"scan-{index}.zip",
                    "status": "completed",
                    "progress": 100,
                    "message": "Processing complete!",
                    "error": None,
                    "seg_quality": "fast",
                    "vol_quality": "standard",
                    "created_at": f"2026-04-27T00:00:0{index}+00:00",
                    "updated_at": f"2026-04-27T00:00:0{index}+00:00",
                }
            )

            mesh_dir = os.path.join(get_job_output_dir(job_id), "meshes")
            os.makedirs(mesh_dir, exist_ok=True)
            with open(os.path.join(mesh_dir, "metadata.json"), "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "organs": [
                            {
                                "id": 1,
                                "name": f"organ_{index}",
                                "color": [100, 100, 100],
                                "file": f"organ_{index}.stl",
                                "vertex_count": 100,
                                "category": "organs",
                            }
                        ],
                        "preload": [f"organ_{index}"],
                    },
                    f,
                )

        with open(catalog_path, "w", encoding="utf-8") as f:
            json.dump(entries, f)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/recent-uploads")

        assert resp.status_code == 200
        uploads = resp.json()
        assert len(uploads) == 5
        assert uploads[0]["job_id"] == "recent-5"
        assert uploads[-1]["job_id"] == "recent-1"
        assert uploads[0]["result_available"] is True
        assert uploads[0]["organ_count"] == 1
