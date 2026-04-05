"""
Organ segmentation via TotalSegmentator.

Converts the stacked numpy volume to NIfTI format, runs TotalSegmentator,
and returns a label map + structure manifest.  Supports GPU (CUDA) with
automatic CPU fallback.
"""

import logging
import os
import tempfile
from typing import Optional

import nibabel as nib
import numpy as np

logger = logging.getLogger(__name__)
_DEVICE_ENV = os.environ.get("TOTALSEG_DEVICE", "auto")


def _resolve_device() -> str:
    """Determine whether to use GPU or CPU for inference."""
    if _DEVICE_ENV == "gpu":
        return "gpu"
    if _DEVICE_ENV == "cpu":
        return "cpu"

    # Auto-detect
    try:
        import torch
        if torch.cuda.is_available():
            return "gpu"
    except ImportError:
        pass
    return "cpu"


def _volume_to_nifti_path(
    volume: np.ndarray,
    spacing: list[float],
    origin: list[float],
    tmp_dir: str,
) -> str:
    """
    Write a numpy volume (Z, Y, X) to a NIfTI file that TotalSegmentator
    can consume.

    Returns the path to the temporary .nii.gz file.
    """
    data = np.transpose(volume, (2, 1, 0)).astype(np.float32)

    affine = np.eye(4)
    affine[0, 0] = spacing[0]
    affine[1, 1] = spacing[1]
    affine[2, 2] = spacing[2]
    affine[0, 3] = origin[0]
    affine[1, 3] = origin[1]
    affine[2, 3] = origin[2]

    nii = nib.Nifti1Image(data, affine)
    nii_path = os.path.join(tmp_dir, "input.nii.gz")
    nib.save(nii, nii_path)
    return nii_path


def run_segmentation(
    volume: np.ndarray,
    spacing: list[float],
    origin: list[float],
    output_dir: str,
    on_progress: Optional[callable] = None,
) -> dict:
    """
    Run TotalSegmentator on the given volume.

    Parameters
    ----------
    volume : np.ndarray
        3-D array in (Z, Y, X) order with HU values.
    spacing : list[float]
        Voxel spacing [dx, dy, dz].
    origin : list[float]
        Volume origin [ox, oy, oz].
    output_dir : str
        Job directory — segmentation masks are saved under ``output_dir/segments/``.
    on_progress : callable, optional
        ``fn(int)`` called with percentage updates.

    Returns
    -------
    dict
        ``{"structures": {"name": label_int, ...}, "label_volume_path": str}``
        Empty ``structures`` dict if segmentation fails gracefully.
    """
    segments_dir = os.path.join(output_dir, "segments")
    os.makedirs(segments_dir, exist_ok=True)

    device = _resolve_device()
    logger.info("TotalSegmentator device: %s", device)

    if on_progress:
        on_progress(5)

    try:
        from totalsegmentator.python_api import totalsegmentator
    except ImportError:
        logger.warning(
            "TotalSegmentator not installed — skipping organ segmentation."
        )
        return {"structures": {}, "label_volume_path": None}

    with tempfile.TemporaryDirectory() as tmp_dir:
        nii_input = _volume_to_nifti_path(volume, spacing, origin, tmp_dir)
        nii_output = os.path.join(tmp_dir, "segmentation.nii.gz")

        if on_progress:
            on_progress(15)

        # Run TotalSegmentator
        try:
            totalsegmentator(
                input=nii_input,
                output=nii_output,
                device=device,
                fast=False,
                ml=True,    
            )
        except RuntimeError as exc:
            # GPU OOM — retry on CPU
            if "CUDA" in str(exc) or "out of memory" in str(exc):
                logger.warning("GPU OOM — retrying segmentation on CPU")
                totalsegmentator(
                    input=nii_input,
                    output=nii_output,
                    device="cpu",
                    fast=False,
                    ml=True,
                )
            else:
                raise

        if on_progress:
            on_progress(70)

        # Load segmentation result
        seg_nii = nib.load(nii_output)
        seg_data = np.asarray(seg_nii.dataobj, dtype=np.int16)

        # Transpose back to (Z, Y, X) to match our volume convention
        label_volume = np.transpose(seg_data, (2, 1, 0))

    # Get unique labels
    unique_labels = [int(l) for l in np.unique(label_volume) if l != 0]

    if not unique_labels:
        logger.info("TotalSegmentator found no structures in this scan.")
        return {"structures": {}, "label_volume_path": None}
    
    label_to_name = _get_label_name_map()

    raw_structures = {}
    for label_int in unique_labels:
        name = label_to_name.get(label_int, f"structure_{label_int}")
        raw_structures[name] = label_int

    # ── False-positive filtering (4 layers) ────────────────────────
    from app.segment_filter import detect_scan_region, filter_structures

    regions = detect_scan_region(volume, spacing)
    structures = filter_structures(
        raw_structures, label_volume, spacing, regions
    )

    # Save the label volume as a compressed numpy file for mesh generation
    label_path = os.path.join(segments_dir, "labels.npz")
    np.savez_compressed(label_path, labels=label_volume)

    if on_progress:
        on_progress(90)

    logger.info(
        "Segmentation complete: %d structures detected", len(structures)
    )
    return {"structures": structures, "label_volume_path": label_path}


def _get_label_name_map() -> dict[int, str]:
    """
    Return TotalSegmentator's label-integer → structure-name mapping.

    Tries the official API first; falls back to a hardcoded subset of the
    most common structures.
    """
    try:
        from totalsegmentator.map_to_binary import class_map
        mapping = class_map.get("total", {})
        return {int(k): v for k, v in mapping.items()}
    except (ImportError, AttributeError):
        pass

    # Fallback to hardcoded mapping
    return {
        1: "spleen", 2: "kidney_right", 3: "kidney_left",
        4: "gallbladder", 5: "liver", 6: "stomach",
        7: "pancreas", 8: "adrenal_gland_right", 9: "adrenal_gland_left",
        10: "lung_upper_lobe_left", 11: "lung_lower_lobe_left",
        12: "lung_upper_lobe_right", 13: "lung_middle_lobe_right",
        14: "lung_lower_lobe_right", 15: "esophagus",
        16: "trachea", 17: "thyroid_gland",
        18: "small_bowel", 19: "duodenum",
        20: "colon", 21: "urinary_bladder",
        22: "prostate", 23: "kidney_cyst_left", 24: "kidney_cyst_right",
        25: "sacrum",
        26: "vertebrae_S1", 27: "vertebrae_L5", 28: "vertebrae_L4",
        29: "vertebrae_L3", 30: "vertebrae_L2", 31: "vertebrae_L1",
        32: "vertebrae_T12", 33: "vertebrae_T11", 34: "vertebrae_T10",
        35: "vertebrae_T9", 36: "vertebrae_T8", 37: "vertebrae_T7",
        38: "vertebrae_T6", 39: "vertebrae_T5", 40: "vertebrae_T4",
        41: "vertebrae_T3", 42: "vertebrae_T2", 43: "vertebrae_T1",
        44: "vertebrae_C7", 45: "vertebrae_C6", 46: "vertebrae_C5",
        47: "vertebrae_C4", 48: "vertebrae_C3", 49: "vertebrae_C2",
        50: "vertebrae_C1",
        51: "heart",
        52: "aorta",
        53: "pulmonary_vein",
        54: "brachiocephalic_trunk",
        55: "subclavian_artery_right", 56: "subclavian_artery_left",
        57: "common_carotid_artery_right", 58: "common_carotid_artery_left",
        59: "brachiocephalic_vein_left", 60: "brachiocephalic_vein_right",
        61: "atrial_appendage_left",
        62: "superior_vena_cava",
        63: "inferior_vena_cava",
        64: "portal_vein_and_splenic_vein",
        65: "iliac_artery_left", 66: "iliac_artery_right",
        67: "iliac_vena_left", 68: "iliac_vena_right",
        69: "humerus_left", 70: "humerus_right",
        71: "scapula_left", 72: "scapula_right",
        73: "clavicula_left", 74: "clavicula_right",
        75: "femur_left", 76: "femur_right",
        77: "hip_left", 78: "hip_right",
        79: "spinal_cord",
        80: "gluteus_maximus_left", 81: "gluteus_maximus_right",
        82: "gluteus_medius_left", 83: "gluteus_medius_right",
        84: "gluteus_minimus_left", 85: "gluteus_minimus_right",
        86: "autochthon_left", 87: "autochthon_right",
        88: "iliopsoas_left", 89: "iliopsoas_right",
        90: "brain",
        91: "skull",
        92: "rib_left_1", 93: "rib_left_2", 94: "rib_left_3",
        95: "rib_left_4", 96: "rib_left_5", 97: "rib_left_6",
        98: "rib_left_7", 99: "rib_left_8", 100: "rib_left_9",
        101: "rib_left_10", 102: "rib_left_11", 103: "rib_left_12",
        104: "rib_right_1", 105: "rib_right_2", 106: "rib_right_3",
        107: "rib_right_4", 108: "rib_right_5", 109: "rib_right_6",
        110: "rib_right_7", 111: "rib_right_8", 112: "rib_right_9",
        113: "rib_right_10", 114: "rib_right_11", 115: "rib_right_12",
        116: "sternum", 117: "costal_cartilages",
    }
