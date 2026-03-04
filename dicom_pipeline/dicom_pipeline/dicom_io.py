"""
DICOM IO utilities:
- reading datasets
- determining if ds contains image pixels
- grouping into series
- sorting slices
"""

import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pydicom


def safe_float(x, default=None):
    try:
        return float(x)
    except Exception:
        return default


def read_ds(path: Path, stop_before_pixels: bool = False):
    return pydicom.dcmread(str(path), force=True, stop_before_pixels=stop_before_pixels)


def is_image_dicom(ds) -> bool:
    """
    Check: pixel data + dimensions present
    This filters out many non-image DICOM objects
    """
    rows = getattr(ds, "Rows", None)
    cols = getattr(ds, "Columns", None)
    return rows is not None and cols is not None

def get_modality(ds) -> Optional[str]:
    v = getattr(ds, "Modality", None)
    return str(v) if v is not None else None


def get_transfer_syntax(ds) -> Optional[str]:
    fm = getattr(ds, "file_meta", None)
    if fm is None:
        return None
    v = getattr(fm, "TransferSyntaxUID", None)
    return str(v) if v is not None else None


def get_pixel_spacing(ds) -> Optional[Tuple[float, float]]:
    ps = getattr(ds, "PixelSpacing", None)
    if ps is None or len(ps) < 2:
        return None
    r = safe_float(ps[0])
    c = safe_float(ps[1])
    if r is None or c is None:
        return None
    return (r, c)


def get_slice_spacing(ds) -> Optional[float]:
    """
    Prefer SpacingBetweenSlices if present, else fallback to SliceThickness.
    """
    sbs = getattr(ds, "SpacingBetweenSlices", None)
    if sbs is not None:
        v = safe_float(sbs)
        if v is not None:
            return v

    st = getattr(ds, "SliceThickness", None)
    if st is not None:
        v = safe_float(st)
        if v is not None:
            return v

    return None


def series_sort_key(ds):
    """
    Sort preference:
    1) If ImagePositionPatient exists, use its z-component (baseline)
    2) Fallback to InstanceNumber
    """
    inst = getattr(ds, "InstanceNumber", None)
    inst_i = int(inst) if inst is not None else 0

    ipp = getattr(ds, "ImagePositionPatient", None)
    z = safe_float(ipp[2], default=math.nan) if ipp is not None and len(ipp) == 3 else math.nan

    return (0 if not math.isnan(z) else 1, z if not math.isnan(z) else 0.0, inst_i)


def discover_image_dicoms_in_folder(folder: Path) -> List[Path]:
    """
    Walk the folder and keep files that parse as DICOM and contain image pixels
    Reads headers only for speed
    """
    out: List[Path] = []
    for p in folder.rglob("*"):
        if not p.is_file():
            continue
        try:
            ds = read_ds(p, stop_before_pixels=True)
            if is_image_dicom(ds):
                out.append(p)
        except Exception:
            continue
    return out


def group_by_series_uid(paths: List[Path]) -> Dict[str, List[Path]]:
    """
    Groups file paths by SeriesInstanceUID (raw)
    NOTE: raw UID must not be persisted — caller should hash it for output naming
    """
    groups: Dict[str, List[Path]] = {}
    for p in paths:
        try:
            ds = read_ds(p, stop_before_pixels=True)
        except Exception:
            continue
        uid = getattr(ds, "SeriesInstanceUID", None)
        key = str(uid) if uid is not None else "UNKNOWN_SERIES"
        groups.setdefault(key, []).append(p)
    return groups