"""
Tests for the FastAPI routes.
"""

import os
import json
import tempfile

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.job_store import set_job_status, clear_all


@pytest.fixture(autouse=True)
def clean_job_store():
    """Clear the job store before each test."""
    clear_all()
    yield
    clear_all()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class TestHealthEndpoint:
    async def test_health_returns_ok(self, client):
        res = await client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["service"] == "supernova-dicom-service"


class TestJobStatusEndpoint:
    async def test_returns_404_for_unknown_job(self, client):
        res = await client.get("/jobs/nonexistent-id")
        assert res.status_code == 404

    async def test_returns_status_for_known_job(self, client):
        set_job_status("test-job-1", {
            "status": "processing",
            "progress": 50,
        })

        res = await client.get("/jobs/test-job-1")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "processing"
        assert data["progress"] == 50

    async def test_returns_completed_status(self, client):
        set_job_status("test-job-2", {
            "status": "completed",
            "progress": 100,
            "result": {"totalSlices": 50},
        })

        res = await client.get("/jobs/test-job-2")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "completed"
        assert data["result"]["totalSlices"] == 50

    async def test_returns_failed_status(self, client):
        set_job_status("test-job-3", {
            "status": "failed",
            "error": "Invalid DICOM data",
        })

        res = await client.get("/jobs/test-job-3")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "failed"
        assert data["error"] == "Invalid DICOM data"


class TestProcessEndpoint:
    async def test_rejects_invalid_directory(self, client):
        res = await client.post("/process", json={
            "jobId": "test-1",
            "inputDir": "/nonexistent/path",
        })
        assert res.status_code == 400

    async def test_accepts_valid_directory(self, client):
        with tempfile.TemporaryDirectory() as d:
            res = await client.post("/process", json={
                "jobId": "test-2",
                "inputDir": d,
            })
            assert res.status_code == 200
            data = res.json()
            assert data["jobId"] == "test-2"
            assert data["status"] == "accepted"
