"""
Pixel preprocessing:
- photometric inversion (MONOCHROME1)
- CT HU rescale slope/intercept
- deterministic normalization for ML
"""

from typing import Dict, Optional, Tuple

import numpy as np

from .config import PipelineConfig


def photometric_invert_if_needed(arr: np.ndarray, ds) -> np.ndarray:
    """
    MONOCHROME1 means: larger value -> darker in display.\
    Many pipelines invert to match MONOCHROME2
    """
    pi = getattr(ds, "PhotometricInterpretation", None)
    if str(pi) == "MONOCHROME1":
        a_min = float(np.min(arr))
        a_max = float(np.max(arr))
        return (a_max + a_min) - arr
    return arr


def apply_rescale(arr: np.ndarray, ds) -> Tuple[np.ndarray, Dict]:
    """
    Applies RescaleSlope/Intercept if present. Critical for CT HU.
    Returns (scaled_array, info_dict).
    """
    slope = getattr(ds, "RescaleSlope", None)
    intercept = getattr(ds, "RescaleIntercept", None)
    info = {"RescaleSlope": slope, "RescaleIntercept": intercept}

    if slope is not None and intercept is not None:
        try:
            s = float(slope)
            b = float(intercept)
            return arr * s + b, info
        except Exception:
            return arr, info

    return arr, info


def normalize_for_ml(arr: np.ndarray, modality: Optional[str], cfg: PipelineConfig) -> np.ndarray:
    """
    Deterministic baseline:
    - CT: clamp HU to [-1000, 1000], map to [0,1]
    - Else: percentile clip [1,99], map to [0,1]
    """
    arr = arr.astype(np.float32)

    if modality == "CT":
        lo = cfg.ct_norm.clamp_min_hu
        hi = cfg.ct_norm.clamp_max_hu
        arr = np.clip(arr, lo, hi)
        return (arr - lo) / (hi - lo + 1e-6)

    lo = float(np.percentile(arr, cfg.generic_norm.p_low))
    hi = float(np.percentile(arr, cfg.generic_norm.p_high))
    if hi <= lo:
        return np.zeros_like(arr, dtype=np.float32)

    arr = np.clip(arr, lo, hi)
    return (arr - lo) / (hi - lo + 1e-6)