import json
import os
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .processing import process_dicom_job
from .job_store import get_job_status, set_job_status
from .db import ingest_dicom_to_db, load_series_from_db

router = APIRouter()


class ProcessRequest(BaseModel):
    jobId: str
    inputDir: str


class IngestRequest(BaseModel):
    jobDir: str


class ProcessFromDBRequest(BaseModel):
    studyUid: str
    seriesUid: str


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

    upload_base = os.path.abspath(os.environ.get("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "uploads")))
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
    upload_base = os.path.abspath(os.environ.get("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "uploads")))
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


@router.post("/ingest")
async def ingest(request: IngestRequest, background_tasks: BackgroundTasks):
    """
    Ingest DICOM files from a job directory into the database (GridFS + PostgreSQL).
    Runs in the background so it doesn't block the upload response.
    """
    if not os.path.isdir(request.jobDir):
        raise HTTPException(status_code=400, detail="Job directory does not exist.")

    def _do_ingest(job_dir: str):
        ingested = 0
        errors = 0
        for root, _, files in os.walk(job_dir):
            for fname in files:
                if not fname.lower().endswith(".dcm"):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    ingest_dicom_to_db(fpath)
                    ingested += 1
                except Exception as e:
                    errors += 1
                    print(f"Ingest error for {fname}: {e}")
        print(f"Ingest complete: {ingested} files ingested, {errors} errors")

    background_tasks.add_task(_do_ingest, request.jobDir)
    return {"status": "accepted"}


@router.post("/process-from-db")
async def process_from_db(request: ProcessFromDBRequest, background_tasks: BackgroundTasks):
    """
    Start processing a series that's already stored in the database.
    Downloads DICOMs from GridFS to a temp job directory, then runs the
    normal processing pipeline.
    """
    job_id = str(uuid.uuid4())
    # Use the same uploads dir as the Express gateway so output files are findable
    upload_base = os.environ.get("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))
    upload_base = os.path.abspath(upload_base)
    job_dir = os.path.join(upload_base, job_id)
    os.makedirs(job_dir, exist_ok=True)

    # Download files from DB
    count = load_series_from_db(request.studyUid, request.seriesUid, job_dir)
    if count == 0:
        raise HTTPException(
            status_code=404,
            detail=f"No DICOM files found for study={request.studyUid}, series={request.seriesUid}",
        )

    # Initialize job status and start processing
    set_job_status(job_id, {
        "status": "processing",
        "progress": 0,
    })
    background_tasks.add_task(process_dicom_job, job_id, job_dir)

    return {"jobId": job_id, "status": "accepted"}
