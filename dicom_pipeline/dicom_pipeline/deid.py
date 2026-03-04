"""
De-identification helpers

Important behavior:
- Never write values for sensitive tags to disk
- Never write raw DICOM UIDs to disk
"""

import hashlib
import os
from typing import Dict, List, Optional

# Common PHI / sensitive fields
SENSITIVE_TAGS: List[str] = [
    "PatientName",
    "PatientID",
    "PatientBirthDate",
    "PatientBirthTime",
    "PatientSex",
    "PatientAddress",
    "PatientTelephoneNumbers",
    "OtherPatientIDs",
    "OtherPatientNames",
    "EthnicGroup",
    "IssuerOfPatientID",
    "AccessionNumber",
    "MedicalRecordLocator",
    "ReferringPhysicianName",
    "PerformingPhysicianName",
    "OperatorsName",
    "InstitutionName",
    "InstitutionAddress",
    "StationName",
    "StudyDate",
    "SeriesDate",
    "AcquisitionDate",
    "ContentDate",
    "AcquisitionDateTime",
    "StudyTime",
    "SeriesTime",
    "ContentTime",
    # Free-text fields that sometimes contain identifiers
    "StudyDescription",
    "SeriesDescription",
    "ProtocolName",
]

# Unique identifiers (not “names,” but linkable)
UID_TAGS: List[str] = [
    "StudyInstanceUID",
    "SeriesInstanceUID",
    "SOPInstanceUID",
    "FrameOfReferenceUID",
]


def get_salt(user_salt: Optional[str]) -> str:
    """
    Salt is required for non-reversible hashes.
    Use:
      - explicit --salt, OR
      - env var DICOM_DEID_SALT, OR
      - dev fallback (NOT for production)
    """
    return user_salt or os.environ.get("DICOM_DEID_SALT") or "DEV_ONLY_CHANGE_ME"


def stable_hash(value: str, salt: str, n_chars: int = 16) -> str:
    """
    Salted SHA-256 hash, truncated for readability.
    Still non-reversible assuming salt is secret.
    """
    h = hashlib.sha256()
    h.update((salt + "::" + value).encode("utf-8"))
    return h.hexdigest()[:n_chars]


def scan_sensitive_fields(ds) -> Dict[str, bool]:
    """
    Returns which sensitive/UID fields are present in the dataset
    NOTE: booleans only; do not record values
    """
    present = {}
    for k in SENSITIVE_TAGS + UID_TAGS:
        present[k] = hasattr(ds, k)
    return present


def hashed_uids(ds, salt: str) -> Dict[str, Optional[str]]:
    """
    Returns hashed forms of UID fields 
    """
    out: Dict[str, Optional[str]] = {}
    for tag in UID_TAGS:
        v = getattr(ds, tag, None)
        out[tag + "_hash"] = stable_hash(str(v), salt) if v is not None else None
    return out