"""
Per-organ mesh generation from TotalSegmentator label maps.

Reads the integer label volume produced by segmentation.py, isolates each
structure as a binary mask, runs VTK Marching Cubes, and saves individual
.vtp mesh files.  Also writes a manifest.json consumed by the frontend.
"""

import json
import logging
import os
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Anatomically-conventional RGB colours  (0-1 float range)
# ---------------------------------------------------------------------------
ORGAN_COLORS: dict[str, list[float]] = {
    # Major organs
    "heart":          [0.80, 0.12, 0.12],
    "liver":          [0.60, 0.30, 0.10],
    "spleen":         [0.50, 0.15, 0.25],
    "stomach":        [0.85, 0.65, 0.40],
    "pancreas":       [0.90, 0.75, 0.50],
    "gallbladder":    [0.30, 0.60, 0.30],

    # Kidneys
    "kidney_right":   [0.70, 0.22, 0.22],
    "kidney_left":    [0.70, 0.22, 0.22],

    # Lungs
    "lung_upper_lobe_left":   [0.65, 0.80, 0.95],
    "lung_lower_lobe_left":   [0.55, 0.70, 0.90],
    "lung_upper_lobe_right":  [0.65, 0.80, 0.95],
    "lung_middle_lobe_right": [0.60, 0.75, 0.92],
    "lung_lower_lobe_right":  [0.55, 0.70, 0.90],

    # Adrenals
    "adrenal_gland_right": [0.85, 0.70, 0.20],
    "adrenal_gland_left":  [0.85, 0.70, 0.20],

    # GI
    "esophagus":      [0.80, 0.55, 0.45],
    "trachea":        [0.50, 0.75, 0.85],
    "small_bowel":    [0.85, 0.60, 0.50],
    "duodenum":       [0.80, 0.55, 0.45],
    "colon":          [0.75, 0.50, 0.40],

    # Urogenital
    "urinary_bladder": [0.80, 0.75, 0.30],
    "prostate":        [0.70, 0.55, 0.45],

    # Vasculature
    "aorta":                       [0.90, 0.15, 0.15],
    "pulmonary_vein":              [0.40, 0.40, 0.85],
    "superior_vena_cava":          [0.25, 0.25, 0.75],
    "inferior_vena_cava":          [0.30, 0.30, 0.80],
    "portal_vein_and_splenic_vein": [0.35, 0.35, 0.70],
    "brachiocephalic_trunk":       [0.85, 0.20, 0.20],
    "atrial_appendage_left":       [0.75, 0.15, 0.20],

    # Skeletal (neutral bone tones)
    "skull":    [0.92, 0.88, 0.80],
    "sternum":  [0.90, 0.85, 0.78],
    "sacrum":   [0.88, 0.82, 0.75],

    # Brain / CNS
    "brain":       [0.90, 0.75, 0.75],
    "spinal_cord": [0.95, 0.90, 0.60],

    # Thyroid
    "thyroid_gland": [0.75, 0.30, 0.45],
}

# Fallback palette for structures without an explicit color
_FALLBACK_PALETTE = [
    [0.40, 0.76, 0.65],
    [0.99, 0.55, 0.38],
    [0.55, 0.63, 0.80],
    [0.91, 0.54, 0.76],
    [0.65, 0.85, 0.33],
    [1.00, 0.85, 0.18],
    [0.90, 0.77, 0.58],
    [0.70, 0.70, 0.70],
    [0.74, 0.50, 0.74],
    [0.60, 0.90, 0.90],
]


def _get_color(name: str, index: int) -> list[float]:
    """Return the RGB color for a structure, with palette fallback."""
    if name in ORGAN_COLORS:
        return ORGAN_COLORS[name]
    return _FALLBACK_PALETTE[index % len(_FALLBACK_PALETTE)]


def _pretty_name(raw_name: str) -> str:
    """Convert snake_case structure names to Title Case display names."""
    return raw_name.replace("_", " ").title()


def generate_organ_meshes(
    label_volume_path: str,
    structures: dict[str, int],
    spacing: list[float],
    origin: list[float],
    output_dir: str,
    on_progress: Optional[callable] = None,
) -> list[dict]:
    """
    Generate per-organ .vtp meshes and a manifest.json.

    Parameters
    ----------
    label_volume_path : str
        Path to the .npz file containing the ``labels`` array.
    structures : dict[str, int]
        Mapping of structure name → integer label value.
    spacing : list[float]
        Voxel spacing [dx, dy, dz].
    origin : list[float]
        Volume origin [ox, oy, oz].
    output_dir : str
        Job directory — meshes saved into ``output_dir/segments/``.
    on_progress : callable, optional
        ``fn(int)`` called with overall percentage (0..100 within this step).

    Returns
    -------
    list[dict]
        Manifest entries: ``[{name, displayName, color, file, fileSize}, ...]``
    """
    import vtk
    from vtk.util.numpy_support import numpy_to_vtk

    segments_dir = os.path.join(output_dir, "segments")
    os.makedirs(segments_dir, exist_ok=True)

    # Load label volume
    data = np.load(label_volume_path)
    label_volume = data["labels"]

    manifest = []
    total = len(structures)

    for idx, (name, label_val) in enumerate(sorted(structures.items())):
        try:
            # Isolate binary mask for this structure
            mask = (label_volume == label_val).astype(np.float32)

            # C. Connected-component filtering — keep only the largest blob
            from app.segment_filter import largest_connected_component
            mask = largest_connected_component(mask)

            # Skip if mask is essentially empty after cleanup
            voxel_count = int(mask.sum())
            if voxel_count < 50:
                logger.debug("Skipping %s — only %d voxels", name, voxel_count)
                continue

            # Build VTK image data from the binary mask
            image_data = vtk.vtkImageData()
            dims = mask.shape  # (Z, Y, X)
            image_data.SetDimensions(dims[2], dims[1], dims[0])
            image_data.SetSpacing(spacing[0], spacing[1], spacing[2])
            image_data.SetOrigin(origin[0], origin[1], origin[2])

            flat = mask.flatten(order="C")
            vtk_array = numpy_to_vtk(flat, deep=True, array_type=vtk.VTK_FLOAT)
            vtk_array.SetName("Scalars")
            image_data.GetPointData().SetScalars(vtk_array)

            gaussian = vtk.vtkImageGaussianSmooth()
            gaussian.SetInputData(image_data)
            gaussian.SetStandardDeviations(1.0, 1.0, 1.0)
            gaussian.SetRadiusFactors(2.0, 2.0, 2.0)
            gaussian.Update()

            # Marching cubes at 0.5 on the smoothed mask
            mc = vtk.vtkMarchingCubes()
            mc.SetInputData(gaussian.GetOutput())
            mc.SetValue(0, 0.5)
            mc.ComputeNormalsOn()
            mc.Update()

            poly = mc.GetOutput()
            if poly.GetNumberOfPoints() < 10:
                continue

            # Smooth
            smoother = vtk.vtkWindowedSincPolyDataFilter()
            smoother.SetInputData(poly)
            smoother.SetNumberOfIterations(30)
            smoother.BoundarySmoothingOff()
            smoother.FeatureEdgeSmoothingOff()
            smoother.SetPassBand(0.05)
            smoother.NonManifoldSmoothingOn()
            smoother.NormalizeCoordinatesOn()
            smoother.Update()

            # Decimate
            decimator = vtk.vtkDecimatePro()
            decimator.SetInputData(smoother.GetOutput())
            decimator.SetTargetReduction(0.4)
            decimator.PreserveTopologyOn()
            decimator.Update()

            # Recompute smooth normals after decimation for clean shading
            normals = vtk.vtkPolyDataNormals()
            normals.SetInputData(decimator.GetOutput())
            normals.ComputePointNormalsOn()
            normals.ComputeCellNormalsOff()
            normals.SplittingOff()
            normals.ConsistencyOn()
            normals.AutoOrientNormalsOn()
            normals.Update()

            # Write VTP
            vtp_filename = f"{name}.vtp"
            vtp_path = os.path.join(segments_dir, vtp_filename)

            writer = vtk.vtkXMLPolyDataWriter()
            writer.SetFileName(vtp_path)
            writer.SetInputData(normals.GetOutput())
            writer.SetDataModeToBinary()
            writer.Write()

            file_size = os.path.getsize(vtp_path)
            color = _get_color(name, idx)

            manifest.append({
                "name": name,
                "displayName": _pretty_name(name),
                "color": color,
                "file": vtp_filename,
                "fileSize": file_size,
                "voxelCount": voxel_count,
            })

            logger.info("Generated mesh for %s (%d voxels, %.1f KB)",
                         name, voxel_count, file_size / 1024)

        except Exception:
            logger.exception("Failed to generate mesh for %s", name)
            continue

        if on_progress and total > 0:
            on_progress(int((idx + 1) / total * 100))

    # Save manifest
    manifest_path = os.path.join(segments_dir, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    logger.info("Organ mesh generation complete: %d of %d structures meshed",
                len(manifest), total)

    return manifest
