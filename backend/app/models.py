"""Pydantic models for API request/response schemas."""
from pydantic import BaseModel, Field
from enum import Enum


class SegmentationQuality(str, Enum):
    FAST = "fast"
    FULL = "full"


class VolumeQuality(str, Enum):
    STANDARD = "standard"
    HIGH = "high"


class UploadConfig(BaseModel):
    segmentation_quality: SegmentationQuality = SegmentationQuality.FAST
    volume_quality: VolumeQuality = VolumeQuality.STANDARD


class JobStatus(str, Enum):
    PENDING = "pending"
    VALIDATING = "validating"
    SEGMENTING = "segmenting"
    MESHING = "meshing"
    VOLUME_PREP = "volume_prep"
    COMPLETED = "completed"
    FAILED = "failed"


class ProgressUpdate(BaseModel):
    job_id: str
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    message: str = ""
    elapsed_seconds: float = 0.0


class OrganInfo(BaseModel):
    id: int
    name: str
    color: list[int] = Field(min_length=3, max_length=4)
    file: str
    vertex_count: int = 0
    category: str = ""


class JobResult(BaseModel):
    job_id: str
    organs: list[OrganInfo] = []
    volume_file: str = ""
    total_organs: int = 0


class MemoryWarning(BaseModel):
    available_gb: float
    required_gb: float
    sufficient: bool
    message: str = ""


class ErrorResponse(BaseModel):
    error: str
    detail: str = ""
