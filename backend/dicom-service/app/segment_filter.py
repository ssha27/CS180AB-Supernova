"""
False-positive filtering for TotalSegmentator organ segmentation.

Four complementary layers:
  A. Global voxel-count threshold — removes trivially small detections
  B. Anatomical minimum-volume table — per-organ minimum cm³ size
  C. Connected-component analysis — keeps only the largest blob,
     removing scattered noise voxels
  D. Scan-region detection — infers which body region the scan covers
     and rejects anatomically implausible structures
"""

import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

MIN_VOXEL_COUNT = 500  # absolute minimum voxel count for any structure

ANATOMICAL_MIN_VOLUME_CM3: dict[str, float] = {
    # Head / CNS
    "skull":        40.0,
    "brain":        80.0,

    # Thoracic organs
    "heart":        40.0,
    "lung_upper_lobe_left":  30.0,
    "lung_lower_lobe_left":  30.0,
    "lung_upper_lobe_right": 30.0,
    "lung_middle_lobe_right": 15.0,
    "lung_lower_lobe_right": 30.0,
    "trachea":       3.0,
    "esophagus":     2.0,
    "thyroid_gland": 3.0,
    "sternum":       8.0,

    # Abdominal organs
    "liver":         80.0,
    "spleen":        15.0,
    "stomach":       15.0,
    "pancreas":       8.0,
    "gallbladder":    3.0,
    "kidney_right":  15.0,
    "kidney_left":   15.0,
    "adrenal_gland_right": 1.0,
    "adrenal_gland_left":  1.0,
    "small_bowel":    8.0,
    "duodenum":       3.0,
    "colon":          8.0,
    "urinary_bladder": 5.0,
    "prostate":       3.0,

    # Vasculature — long thin vessels can be legitimately small
    "aorta":          5.0,
    "pulmonary_vein": 2.0,
    "superior_vena_cava": 2.0,
    "inferior_vena_cava": 3.0,
    "portal_vein_and_splenic_vein": 1.5,
    "brachiocephalic_trunk": 1.0,
    "common_carotid_artery_right": 0.8,
    "common_carotid_artery_left":  0.8,
    "brachiocephalic_vein_left":   0.8,
    "brachiocephalic_vein_right":  0.8,
    "subclavian_artery_right": 0.8,
    "subclavian_artery_left":  0.8,
    "iliac_artery_left":  1.0,
    "iliac_artery_right": 1.0,
    "iliac_vena_left":  1.0,
    "iliac_vena_right": 1.0,
    "atrial_appendage_left": 1.0,

    # Skeletal
    "humerus_left":   20.0,
    "humerus_right":  20.0,
    "scapula_left":   15.0,
    "scapula_right":  15.0,
    "clavicula_left":  5.0,
    "clavicula_right": 5.0,
    "femur_left":     30.0,
    "femur_right":    30.0,
    "hip_left":       20.0,
    "hip_right":      20.0,
    "sacrum":         15.0,

    # Spine & cord
    "spinal_cord":    2.0,

    # Muscles
    "gluteus_maximus_left":  20.0,
    "gluteus_maximus_right": 20.0,
    "gluteus_medius_left":   10.0,
    "gluteus_medius_right":  10.0,
    "gluteus_minimus_left":   5.0,
    "gluteus_minimus_right":  5.0,
    "autochthon_left":   4.0,
    "autochthon_right":  4.0,
    "iliopsoas_left":    5.0,
    "iliopsoas_right":   5.0,
}

# Default for structures not in the table (individual vertebrae, ribs, etc.)
_DEFAULT_MIN_VOLUME_CM3 = 1.5

_HEAD_STRUCTURES = {
    "skull", "brain", "spinal_cord",
    "vertebrae_C1", "vertebrae_C2", "vertebrae_C3", "vertebrae_C4",
    "vertebrae_C5", "vertebrae_C6", "vertebrae_C7",
    "thyroid_gland", "trachea", "esophagus",
    "common_carotid_artery_left", "common_carotid_artery_right",
}

_CHEST_STRUCTURES = {
    "heart", "aorta", "trachea", "esophagus", "thyroid_gland",
    "lung_upper_lobe_left", "lung_lower_lobe_left",
    "lung_upper_lobe_right", "lung_middle_lobe_right", "lung_lower_lobe_right",
    "pulmonary_vein", "superior_vena_cava", "inferior_vena_cava",
    "brachiocephalic_trunk", "brachiocephalic_vein_left", "brachiocephalic_vein_right",
    "subclavian_artery_left", "subclavian_artery_right",
    "common_carotid_artery_left", "common_carotid_artery_right",
    "atrial_appendage_left",
    "spinal_cord", "sternum", "costal_cartilages",
    "humerus_left", "humerus_right", "scapula_left", "scapula_right",
    "clavicula_left", "clavicula_right",
    "autochthon_left", "autochthon_right",
    *(f"rib_left_{i}" for i in range(1, 13)),
    *(f"rib_right_{i}" for i in range(1, 13)),
    *(f"vertebrae_T{i}" for i in range(1, 13)),
    "vertebrae_C5", "vertebrae_C6", "vertebrae_C7",
}

_ABDOMEN_STRUCTURES = {
    "liver", "spleen", "stomach", "pancreas", "gallbladder",
    "kidney_right", "kidney_left",
    "adrenal_gland_right", "adrenal_gland_left",
    "small_bowel", "duodenum", "colon",
    "aorta", "inferior_vena_cava",
    "portal_vein_and_splenic_vein",
    "spinal_cord", "costal_cartilages",
    "autochthon_left", "autochthon_right",
    *(f"rib_left_{i}" for i in range(7, 13)),
    *(f"rib_right_{i}" for i in range(7, 13)),
    *(f"vertebrae_T{i}" for i in range(9, 13)),
    *(f"vertebrae_L{i}" for i in range(1, 6)),
}

_PELVIS_STRUCTURES = {
    "urinary_bladder", "prostate", "colon", "small_bowel",
    "hip_left", "hip_right", "sacrum", "femur_left", "femur_right",
    "gluteus_maximus_left", "gluteus_maximus_right",
    "gluteus_medius_left", "gluteus_medius_right",
    "gluteus_minimus_left", "gluteus_minimus_right",
    "iliopsoas_left", "iliopsoas_right",
    "iliac_artery_left", "iliac_artery_right",
    "iliac_vena_left", "iliac_vena_right",
    "aorta", "inferior_vena_cava",
    "spinal_cord",
    "autochthon_left", "autochthon_right",
    *(f"vertebrae_L{i}" for i in range(1, 6)),
    "vertebrae_S1",
}


def detect_scan_region(
    volume: np.ndarray,
    spacing: list[float],
) -> list[str]:
    """
    Heuristically detect which body region(s) a CT scan covers based on
    the physical extent of non-air voxels along the Z (superior-inferior) axis.

    Returns a list of region names: "head", "chest", "abdomen", "pelvis".
    If the extent is large enough, multiple regions may be returned.

    Parameters
    ----------
    volume : np.ndarray
        3-D array in (Z, Y, X) order with HU values.
    spacing : list[float]
        Voxel spacing [dx, dy, dz] in mm.
    """
    num_slices = volume.shape[0]

    tissue_fraction = np.zeros(num_slices)
    for z in range(num_slices):
        sl = volume[z]
        tissue_fraction[z] = np.mean(sl > -300)

    # Find the z-extent that actually contains tissue
    tissue_mask = tissue_fraction > 0.05
    if not tissue_mask.any():
        return ["chest", "abdomen"]  # safe fallback

    z_indices = np.where(tissue_mask)[0]
    z_min, z_max = z_indices[0], z_indices[-1]
    tissue_extent_mm = (z_max - z_min + 1) * spacing[2]

    z_norm = np.linspace(0, 1, num_slices)
    weighted_centre = np.average(z_norm[z_indices],
                                 weights=tissue_fraction[z_indices])

    regions = []

    if tissue_extent_mm > 800:
        if weighted_centre > 0.6:
            regions.extend(["head", "chest"])
        if 0.3 < weighted_centre < 0.7:
            regions.append("chest")
        if 0.2 < weighted_centre < 0.6:
            regions.append("abdomen")
        if weighted_centre < 0.5:
            regions.append("pelvis")
        if tissue_extent_mm > 1200:
            regions = ["head", "chest", "abdomen", "pelvis"]
    else:
        air_fraction = np.zeros(num_slices)
        for z in range(z_min, z_max + 1):
            sl = volume[z]
            air_fraction[z] = np.mean((sl > -900) & (sl < -200))

        has_lungs = np.max(air_fraction) > 0.15

        if weighted_centre > 0.65:
            bone_upper = np.mean(volume[z_max - (z_max-z_min)//3 : z_max+1] > 300)
            if bone_upper > 0.05 and not has_lungs:
                regions.append("head")
            else:
                regions.append("chest")
                if has_lungs:
                    regions.append("chest")
        elif weighted_centre > 0.4:
            if has_lungs:
                regions.append("chest")
            else:
                regions.append("abdomen")
        else:
            if has_lungs:
                regions.append("chest")
            regions.append("abdomen")
            if weighted_centre < 0.35:
                regions.append("pelvis")

    # "Reasonable" regions that may be present in the scan
    if "chest" in regions and "abdomen" not in regions:
        regions.append("abdomen") 
    if "abdomen" in regions and "chest" not in regions:
        regions.append("chest")
    if "pelvis" in regions and "abdomen" not in regions:
        regions.append("abdomen")

    regions = list(set(regions))
    logger.info("Detected scan region(s): %s (extent=%.0fmm, centre=%.2f)",
                regions, tissue_extent_mm, weighted_centre)
    return regions


def get_plausible_structures(regions: list[str]) -> set[str]:
    """Return the set of structure names plausible for the given body regions."""
    region_map = {
        "head":    _HEAD_STRUCTURES,
        "chest":   _CHEST_STRUCTURES,
        "abdomen": _ABDOMEN_STRUCTURES,
        "pelvis":  _PELVIS_STRUCTURES,
    }
    plausible = set()
    for r in regions:
        plausible |= region_map.get(r, set())
    return plausible


def compute_volume_cm3(voxel_count: int, spacing: list[float]) -> float:
    """Convert a voxel count to physical volume in cm³."""
    voxel_vol_mm3 = spacing[0] * spacing[1] * spacing[2]
    return voxel_count * voxel_vol_mm3 / 1000.0


def get_min_volume_cm3(structure_name: str) -> float:
    """Return the anatomical minimum volume for a structure."""
    return ANATOMICAL_MIN_VOLUME_CM3.get(structure_name, _DEFAULT_MIN_VOLUME_CM3)


def largest_connected_component(mask: np.ndarray) -> np.ndarray:
    """
    Keep only the largest connected component in a 3-D binary mask.

    Uses scipy.ndimage for labelling.  Falls back to returning the
    original mask if scipy is unavailable.
    """
    try:
        from scipy import ndimage
    except ImportError:
        logger.warning("scipy not available — skipping connected-component filtering")
        return mask

    labelled, num_features = ndimage.label(mask)
    if num_features <= 1:
        return mask

    # Find the label with the most voxels (excluding background 0)
    component_sizes = ndimage.sum(mask, labelled, range(1, num_features + 1))
    largest_label = np.argmax(component_sizes) + 1  # labels are 1-indexed

    cleaned = (labelled == largest_label).astype(mask.dtype)

    removed = int(mask.sum()) - int(cleaned.sum())
    if removed > 0:
        logger.debug("Connected-component cleanup: removed %d scattered voxels "
                      "(%d components → 1)", removed, num_features)
    return cleaned


def filter_structures(
    structures: dict[str, int],
    label_volume: np.ndarray,
    spacing: list[float],
    regions: list[str],
) -> dict[str, int]:
    """
    Apply all four filtering layers to the raw structure dict.

    Returns the filtered dict containing only high-confidence structures.
    """
    plausible = get_plausible_structures(regions)
    filtered = {}
    rejected_reasons: dict[str, str] = {}

    for name, label_val in structures.items():
        # Count raw voxels
        voxel_count = int((label_volume == label_val).sum())

        # A. Global voxel threshold
        if voxel_count < MIN_VOXEL_COUNT:
            rejected_reasons[name] = f"too few voxels ({voxel_count} < {MIN_VOXEL_COUNT})"
            continue

        # B. Anatomical volume check
        vol_cm3 = compute_volume_cm3(voxel_count, spacing)
        min_vol = get_min_volume_cm3(name)
        if vol_cm3 < min_vol:
            rejected_reasons[name] = (
                f"volume {vol_cm3:.1f} cm³ < anatomical minimum {min_vol:.1f} cm³"
            )
            continue

        # D. Region plausibility
        if plausible and name not in plausible:
            if not name.startswith("structure_"):
                rejected_reasons[name] = (
                    f"not plausible for detected region(s) {regions}"
                )
                continue

        filtered[name] = label_val

    if rejected_reasons:
        logger.info("Filtered out %d false-positive structures:", len(rejected_reasons))
        for name, reason in sorted(rejected_reasons.items()):
            logger.info("  ✗ %s — %s", name, reason)

    logger.info("Keeping %d of %d structures after filtering",
                len(filtered), len(structures))
    return filtered
