import json
import os

from fastapi import APIRouter, BackgroundTasks, HTTPException
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
