"""
Simple in-memory job status store.
Phase 1 only — replace with Redis or DB for production.
"""

_jobs: dict[str, dict] = {}


def set_job_status(job_id: str, status: dict) -> None:
    _jobs[job_id] = status


def get_job_status(job_id: str) -> dict | None:
    return _jobs.get(job_id)


def update_job_progress(job_id: str, progress: int) -> None:
    if job_id in _jobs:
        _jobs[job_id]["progress"] = progress


def clear_all() -> None:
    """For testing only."""
    _jobs.clear()
