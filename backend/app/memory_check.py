"""Preflight memory check before running TotalSegmentator."""
import psutil
from app.models import MemoryWarning

MEMORY_REQUIREMENTS_GB = {
    "fast": 12.0,
    "full": 32.0,
}


def check_memory(quality: str) -> MemoryWarning:
    """Check if the system has enough available RAM for segmentation."""
    required = MEMORY_REQUIREMENTS_GB.get(quality, MEMORY_REQUIREMENTS_GB["fast"])
    available_bytes = psutil.virtual_memory().available
    available_gb = available_bytes / (1024**3)
    sufficient = available_gb >= required

    message = ""
    if not sufficient:
        message = (
            f"Insufficient RAM: {available_gb:.1f} GB available, "
            f"{required:.1f} GB required for {quality} mode. "
            f"Processing may fail or be very slow."
        )

    return MemoryWarning(
        available_gb=round(available_gb, 2),
        required_gb=required,
        sufficient=sufficient,
        message=message,
    )
