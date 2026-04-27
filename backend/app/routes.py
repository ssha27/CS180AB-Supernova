"""FastAPI routes for the Supernova CT viewer API."""
import os
import json
import asyncio
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from app.models import (
    JobStatus,
    SegmentationQuality,
    VolumeQuality,
    ProgressUpdate,
)
from app.processing import (
    create_job,
    get_job,
    get_job_output_dir,
    list_recent_uploads,
    load_job_result_metadata,
    register_recent_upload,
    validate_zip_contains_dicom,
    run_pipeline,
)
from app.memory_check import check_memory
from app.websocket import manager

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024  # 2GB


@router.post("/api/upload")
async def upload_dicom(
    file: UploadFile = File(...),
    seg_quality: str = Form("fast"),
    vol_quality: str = Form("standard"),
):
    """Upload a DICOM ZIP file and start processing."""
    # Parse quality settings
    try:
        sq = SegmentationQuality(seg_quality.lower())
    except ValueError:
        sq = SegmentationQuality.FAST

    try:
        vq = VolumeQuality(vol_quality.lower())
    except ValueError:
        vq = VolumeQuality.STANDARD

    # Save uploaded file to temp location
    job_id = create_job(sq, vq)
    output_dir = get_job_output_dir(job_id)
    os.makedirs(output_dir, exist_ok=True)
    zip_path = os.path.join(output_dir, "upload.zip")

    try:
        with open(zip_path, "wb") as f:
            while chunk := await file.read(8192):
                f.write(chunk)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {str(e)}")

    # Validate ZIP contains DICOM
    is_valid, message = validate_zip_contains_dicom(zip_path)
    if not is_valid:
        # Cleanup
        try:
            os.remove(zip_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail=f"Invalid upload: {message}")

    register_recent_upload(
        job_id,
        file.filename or f"upload-{job_id}.zip",
        sq,
        vq,
    )

    # Start processing in background
    asyncio.create_task(run_pipeline(job_id, zip_path))

    return {"job_id": job_id, "message": message}


@router.get("/api/results/{job_id}")
async def get_results(job_id: str):
    """Get processing results for a job."""
    job = get_job(job_id)
    if job is not None and job.status != JobStatus.COMPLETED:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={
                "status": job.status.value,
                "progress": job.progress,
                "message": job.message,
            },
        )

    metadata = load_job_result_metadata(job_id)
    if metadata is None:
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        raise HTTPException(status_code=500, detail="Results metadata not found")

    return metadata


@router.get("/api/recent-uploads")
async def get_recent_uploads():
    """Return the latest cached uploads for the current user."""
    return list_recent_uploads()


@router.get("/api/status/{job_id}")
async def get_status(job_id: str):
    """Get current status of a processing job."""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    import time
    elapsed = time.time() - job.start_time

    return {
        "job_id": job.job_id,
        "status": job.status.value,
        "progress": job.progress,
        "message": job.message,
        "elapsed_seconds": elapsed,
        "error": job.error,
    }


@router.get("/api/memory-check")
async def memory_check(quality: str = "fast"):
    """Check if the system has enough memory for segmentation."""
    warning = check_memory(quality)
    return warning.model_dump()


@router.get("/api/meshes/{job_id}/{filename}")
async def serve_mesh(job_id: str, filename: str):
    """Serve a mesh file for a specific organ."""
    # Validate filename to prevent path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    mesh_path = os.path.join(get_job_output_dir(job_id), "meshes", filename)
    if not os.path.exists(mesh_path):
        raise HTTPException(status_code=404, detail="Mesh file not found")

    return FileResponse(mesh_path, media_type="application/octet-stream")


@router.get("/api/volume/{job_id}/{filename}")
async def serve_volume(job_id: str, filename: str):
    """Serve volume data files."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    volume_path = os.path.join(get_job_output_dir(job_id), "volume", filename)
    if not os.path.exists(volume_path):
        raise HTTPException(status_code=404, detail="Volume file not found")

    media_type = "application/octet-stream"
    if filename.endswith(".json"):
        media_type = "application/json"

    return FileResponse(volume_path, media_type=media_type)


@router.websocket("/api/progress/{job_id}")
async def websocket_progress(websocket: WebSocket, job_id: str):
    """WebSocket endpoint for real-time progress updates."""
    job = get_job(job_id)
    if job is None:
        await websocket.close(code=4004, reason="Job not found")
        return

    await manager.connect(job_id, websocket)

    try:
        # Send current status immediately
        import time
        elapsed = time.time() - job.start_time
        await websocket.send_json({
            "job_id": job.job_id,
            "status": job.status.value,
            "progress": job.progress,
            "message": job.message,
            "elapsed_seconds": elapsed,
        })

        # Keep connection alive, receive pings
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(job_id, websocket)
