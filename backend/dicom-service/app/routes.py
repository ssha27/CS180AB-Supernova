import json
import os

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .processing import process_dicom_job
from .job_store import get_job_status, set_job_status

router = APIRouter()


class ProcessRequest(BaseModel):
    jobId: str
    inputDir: str


@router.post("/process")
async def process(request: ProcessRequest, background_tasks: BackgroundTasks):
    """
    Accept a processing request from the API gateway.
    Starts DICOM processing as a background task.
    """
    if not os.path.isdir(request.inputDir):
        raise HTTPException(status_code=400, detail="Input directory does not exist.")

    # Initialize job status
    set_job_status(request.jobId, {
        "status": "processing",
        "progress": 0,
    })

    # Process in the background
    background_tasks.add_task(process_dicom_job, request.jobId, request.inputDir)

    return {"jobId": request.jobId, "status": "accepted"}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str):
    """
    Get the current processing status for a job.
    """
    status = get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return status


@router.get("/jobs/{job_id}/segments")
async def list_segments(job_id: str):
    """
    Return the segment manifest (list of available organ meshes).
    """
    # Resolve the job's upload directory from the status store
    status = get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    # Find the manifest on disk — the upload dir is passed during job creation
    # and segments are stored under <upload_dir>/segments/manifest.json.
    # We need to locate it via the shared upload volume.
    upload_base = os.environ.get("UPLOAD_DIR", "/app/uploads")
    manifest_path = os.path.join(upload_base, job_id, "segments", "manifest.json")

    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail="No segment data available.")

    with open(manifest_path, "r") as f:
        manifest = json.load(f)

    return manifest


@router.get("/jobs/{job_id}/segments/{structure_name}")
async def get_segment_mesh(job_id: str, structure_name: str):
    """
    Stream a per-organ .vtp mesh file.
    """
    upload_base = os.environ.get("UPLOAD_DIR", "/app/uploads")
    vtp_path = os.path.join(
        upload_base, job_id, "segments", f"{structure_name}.vtp"
    )

    if not os.path.isfile(vtp_path):
        raise HTTPException(status_code=404, detail=f"Segment '{structure_name}' not found.")

    return FileResponse(
        vtp_path,
        media_type="application/octet-stream",
        filename=f"{structure_name}.vtp",
    )
