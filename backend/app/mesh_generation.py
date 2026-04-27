"""Convert NIfTI segmentation labelmaps into 3D surface meshes (STL format)."""
import os
import json
import logging
import numpy as np
import nibabel as nib
from pathlib import Path
from skimage import measure
from scipy import ndimage
import trimesh
import fast_simplification

from app.color_map import ORGAN_COLOR_MAP, get_organ_color_normalized, is_preload_organ
from app.models import OrganInfo

logger = logging.getLogger(__name__)

DEFAULT_DECIMATE_TARGET = 50000  # faces per organ
SMOOTHING_ITERATIONS = 10
MIN_VOXEL_COUNT = 500  # organs smaller than this are noise artifacts

# Full 26-connectivity for 3D labeling (preserves thin diagonal structures like ribs)
CONNECTED_STRUCTURE = np.ones((3, 3, 3), dtype=np.uint8)

# Morphological closing kernel — bridges 1-2 voxel gaps in thin structures
CLOSING_STRUCTURE = ndimage.generate_binary_structure(3, 2)  # 18-connectivity


def extract_organ_mesh(
    seg_data: np.ndarray,
    label_id: int,
    voxel_spacing: tuple[float, float, float],
    affine: np.ndarray,
) -> trimesh.Trimesh | None:
    """Extract a surface mesh for a single organ label using marching cubes."""
    binary_mask = (seg_data == label_id).astype(np.uint8)

    if binary_mask.sum() < MIN_VOXEL_COUNT:
        return None

    # Morphological closing to bridge small gaps (1-2 voxels) in thin
    # structures like ribs before connected component analysis.
    binary_mask = ndimage.binary_closing(
        binary_mask, structure=CLOSING_STRUCTURE, iterations=2
    ).astype(np.uint8)

    # Keep only the largest connected component to remove floating fragments.
    # Use 26-connectivity so thin diagonal structures (ribs) stay connected.
    labeled_array, num_features = ndimage.label(binary_mask, structure=CONNECTED_STRUCTURE)
    if num_features > 1:
        component_sizes = ndimage.sum(binary_mask, labeled_array, range(1, num_features + 1))
        largest_component = int(np.argmax(component_sizes)) + 1
        binary_mask = (labeled_array == largest_component).astype(np.uint8)

    if binary_mask.sum() < MIN_VOXEL_COUNT:
        return None

    try:
        # Use unit spacing — the affine handles voxel-to-world scaling
        vertices, faces, normals, _ = measure.marching_cubes(
            binary_mask, level=0.5
        )
    except (RuntimeError, ValueError):
        logger.warning(f"Marching cubes failed for label {label_id}")
        return None

    # Apply affine transform to convert voxel indices to world coords
    vertices_world = (affine[:3, :3] @ vertices.T).T + affine[:3, 3]

    # Transform normals via inverse-transpose of the 3x3 affine submatrix
    # (required for correct lighting with anisotropic voxels or rotations)
    normal_matrix = np.linalg.inv(affine[:3, :3]).T
    normals_world = (normal_matrix @ normals.T).T
    norms = np.linalg.norm(normals_world, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    normals_world = normals_world / norms

    mesh = trimesh.Trimesh(
        vertices=vertices_world,
        faces=faces,
        vertex_normals=normals_world,
        process=False,
    )
    return mesh


def decimate_mesh(mesh: trimesh.Trimesh, target_faces: int) -> trimesh.Trimesh:
    """Reduce polygon count of a mesh to target number of faces."""
    if len(mesh.faces) <= target_faces:
        return mesh

    target_reduction = 1.0 - (target_faces / len(mesh.faces))
    try:
        points_out, faces_out = fast_simplification.simplify(
            mesh.vertices.view(np.ndarray),
            mesh.faces.view(np.ndarray),
            target_reduction=target_reduction,
        )
        if len(faces_out) > 0:
            return trimesh.Trimesh(vertices=points_out, faces=faces_out, process=False)
    except Exception:
        logger.warning("Quadric decimation failed, returning original mesh")

    return mesh


def smooth_mesh(mesh: trimesh.Trimesh, iterations: int = SMOOTHING_ITERATIONS) -> trimesh.Trimesh:
    """Apply Laplacian smoothing to a mesh."""
    try:
        trimesh.smoothing.filter_laplacian(mesh, iterations=iterations)
    except Exception:
        logger.warning("Smoothing failed, returning unsmoothed mesh")
    return mesh


def export_organ_stl(
    mesh: trimesh.Trimesh,
    output_path: str,
) -> int:
    """Export a mesh as a binary STL file. Returns vertex count."""
    mesh.export(output_path, file_type="stl")
    return len(mesh.vertices)


def generate_all_meshes(
    segmentation_path: str,
    output_dir: str,
    decimate_target: int = DEFAULT_DECIMATE_TARGET,
    progress_callback=None,
) -> list[OrganInfo]:
    """Generate STL mesh files for all organs found in a multilabel NIfTI segmentation.

    Args:
        segmentation_path: Path to the multilabel NIfTI (.nii.gz) file
        output_dir: Directory to write STL files into
        decimate_target: Target face count per organ mesh
        progress_callback: Optional callable(current, total, organ_name) for progress

    Returns:
        List of OrganInfo for each successfully generated mesh
    """
    os.makedirs(output_dir, exist_ok=True)

    seg_img = nib.load(segmentation_path)
    seg_data = np.asarray(seg_img.dataobj)
    affine = seg_img.affine
    voxel_spacing = tuple(float(s) for s in seg_img.header.get_zooms()[:3])

    # Find which labels are actually present
    unique_labels = set(np.unique(seg_data).astype(int)) - {0}
    valid_labels = sorted(unique_labels & set(ORGAN_COLOR_MAP.keys()))

    total = len(valid_labels)
    organs: list[OrganInfo] = []

    for i, label_id in enumerate(valid_labels):
        organ_info = ORGAN_COLOR_MAP[label_id]
        organ_name = organ_info["name"]

        if progress_callback:
            progress_callback(i, total, organ_name)

        mesh = extract_organ_mesh(seg_data, label_id, voxel_spacing, affine)
        if mesh is None:
            continue

        mesh = decimate_mesh(mesh, decimate_target)
        mesh = smooth_mesh(mesh)

        filename = f"{organ_name}.stl"
        output_path = os.path.join(output_dir, filename)
        vertex_count = export_organ_stl(mesh, output_path)

        organs.append(OrganInfo(
            id=label_id,
            name=organ_name,
            color=organ_info["color"],
            file=filename,
            vertex_count=vertex_count,
            category=organ_info["category"],
        ))

    # Write metadata
    metadata = {
        "organs": [o.model_dump() for o in organs],
        "preload": [o.name for o in organs if is_preload_organ(o.name)],
    }
    with open(os.path.join(output_dir, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    return organs
