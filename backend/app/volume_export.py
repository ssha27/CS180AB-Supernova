"""Convert DICOM series to aligned CT and segmentation volumes for web rendering.

The exported CT intensity volume and segmentation label volume share the same
downsampled grid so orthogonal slice panes can render overlays and resolve hover
labels without additional client-side registration work.
"""
import json
import logging
import os
from pathlib import Path

import nibabel as nib
import numpy as np
import pydicom
from scipy.ndimage import affine_transform, zoom

logger = logging.getLogger(__name__)

DEFAULT_MAX_DIM = 256  # Max dimension for standard quality
HIGH_QUALITY_MAX_DIM = 512
RAS_TO_LPS = np.diag([-1.0, -1.0, 1.0, 1.0]).astype(np.float64)


def _normalize_vector(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm == 0:
        return vector
    return vector / norm


def build_volume_affine(metadata: dict) -> np.ndarray:
    """Build a voxel-to-world affine for CT arrays indexed as [z, row, column].

    DICOM ImageOrientationPatient stores the direction of the image rows first
    and the direction of the image columns second. For a NumPy array with axes
    [slice, row, column], the row index advances along the DICOM column vector
    using PixelSpacing[0], while the column index advances along the DICOM row
    vector using PixelSpacing[1].
    """
    if "affine" in metadata:
        return np.asarray(metadata["affine"], dtype=np.float64)

    direction = metadata.get("direction", {})
    slice_dir = _normalize_vector(np.asarray(direction.get("slice", [0.0, 0.0, 1.0]), dtype=np.float64))
    row_dir = _normalize_vector(np.asarray(direction.get("row", [1.0, 0.0, 0.0]), dtype=np.float64))
    column_dir = _normalize_vector(np.asarray(direction.get("column", [0.0, 1.0, 0.0]), dtype=np.float64))

    spacing = metadata["spacing"]
    origin = np.asarray(metadata["origin"], dtype=np.float64)

    affine = np.eye(4, dtype=np.float64)
    affine[:3, 0] = slice_dir * float(spacing[0])
    affine[:3, 1] = column_dir * float(spacing[1])
    affine[:3, 2] = row_dir * float(spacing[2])
    affine[:3, 3] = origin
    return affine


def build_downsampled_affine(affine: np.ndarray, scale_factors: list[float]) -> np.ndarray:
    """Adjust an affine after uniform or anisotropic downsampling."""
    scaling = np.eye(4, dtype=np.float64)
    scaling[0, 0] = 1.0 / float(scale_factors[0])
    scaling[1, 1] = 1.0 / float(scale_factors[1])
    scaling[2, 2] = 1.0 / float(scale_factors[2])
    return affine @ scaling


def convert_nifti_affine_to_lps(affine: np.ndarray) -> np.ndarray:
    """Convert a nibabel NIfTI affine from RAS world coordinates into DICOM LPS."""
    return RAS_TO_LPS @ np.asarray(affine, dtype=np.float64)


def load_dicom_series(dicom_dir: str) -> tuple[np.ndarray, dict]:
    """Load a DICOM series from a directory, returning the 3D volume and metadata.

    Returns:
        (volume_data, metadata_dict) where volume_data is HU-valued int16 array
        and metadata has spacing, orientation, origin, affine, and value range.
    """
    dcm_files = sorted(Path(dicom_dir).glob("*.dcm"))
    if not dcm_files:
        dcm_files = sorted(
            [
                f
                for f in Path(dicom_dir).iterdir()
                if f.is_file() and not f.name.startswith(".")
            ]
        )

    if not dcm_files:
        raise ValueError(f"No DICOM files found in {dicom_dir}")

    slices = []
    for file_path in dcm_files:
        try:
            ds = pydicom.dcmread(str(file_path))
            if hasattr(ds, "ImagePositionPatient") and hasattr(ds, "pixel_array"):
                slices.append(ds)
        except Exception:
            continue

    if not slices:
        raise ValueError("No valid DICOM slices with image data found")

    slices.sort(key=lambda s: tuple(float(value) for value in s.ImagePositionPatient))

    pixel_arrays = []
    for dicom_slice in slices:
        arr = dicom_slice.pixel_array.astype(np.float32)
        slope = float(getattr(dicom_slice, "RescaleSlope", 1.0))
        intercept = float(getattr(dicom_slice, "RescaleIntercept", 0.0))
        arr = arr * slope + intercept
        pixel_arrays.append(arr)

    volume = np.stack(pixel_arrays, axis=0).astype(np.int16)

    orientation = getattr(slices[0], "ImageOrientationPatient", None)
    if orientation and len(orientation) >= 6:
        row_dir = _normalize_vector(np.asarray(orientation[:3], dtype=np.float64))
        column_dir = _normalize_vector(np.asarray(orientation[3:6], dtype=np.float64))
    else:
        row_dir = np.asarray([1.0, 0.0, 0.0], dtype=np.float64)
        column_dir = np.asarray([0.0, 1.0, 0.0], dtype=np.float64)

    pixel_spacing = [float(value) for value in slices[0].PixelSpacing]
    origin = np.asarray(slices[0].ImagePositionPatient, dtype=np.float64)

    if len(slices) > 1:
        next_origin = np.asarray(slices[1].ImagePositionPatient, dtype=np.float64)
        slice_step = next_origin - origin
        slice_thickness = float(np.linalg.norm(slice_step))
        if slice_thickness > 0:
            slice_dir = slice_step / slice_thickness
        else:
            slice_dir = _normalize_vector(np.cross(row_dir, column_dir))
            slice_thickness = float(getattr(slices[0], "SliceThickness", 1.0))
    else:
        slice_dir = _normalize_vector(np.cross(row_dir, column_dir))
        slice_thickness = float(getattr(slices[0], "SliceThickness", 1.0))

    metadata = {
        "dimensions": list(volume.shape),
        "spacing": [slice_thickness, pixel_spacing[0], pixel_spacing[1]],
        "origin": origin.tolist(),
        "direction": {
            "slice": slice_dir.tolist(),
            "row": row_dir.tolist(),
            "column": column_dir.tolist(),
        },
        "affine": build_volume_affine(
            {
                "spacing": [slice_thickness, pixel_spacing[0], pixel_spacing[1]],
                "origin": origin.tolist(),
                "direction": {
                    "slice": slice_dir.tolist(),
                    "row": row_dir.tolist(),
                    "column": column_dir.tolist(),
                },
            }
        ).tolist(),
        "dtype": "int16",
        "min_hu": int(volume.min()),
        "max_hu": int(volume.max()),
    }

    return volume, metadata


def resample_volume(volume: np.ndarray, scale_factors: list[float], order: int) -> np.ndarray:
    """Resample a volume with explicit scale factors and interpolation order."""
    if all(abs(scale - 1.0) < 1e-6 for scale in scale_factors):
        return volume

    source = volume if order == 0 else volume.astype(np.float32)
    resampled = zoom(source, scale_factors, order=order, prefilter=order > 1)
    return resampled.astype(volume.dtype)


def downsample_volume(
    volume: np.ndarray,
    max_dim: int = DEFAULT_MAX_DIM,
    order: int = 1,
) -> tuple[np.ndarray, list[float]]:
    """Downsample volume so largest dimension <= max_dim.

    Returns:
        (downsampled_volume, scale_factors)
    """
    current_max = max(volume.shape)
    if current_max <= max_dim:
        return volume, [1.0, 1.0, 1.0]

    scale = max_dim / current_max
    scale_factors = [scale, scale, scale]
    return resample_volume(volume, scale_factors, order=order), scale_factors


def load_segmentation_labels(segmentation_path: str) -> tuple[np.ndarray, dict]:
    """Load the TotalSegmentator multilabel segmentation volume."""
    seg_img = nib.load(segmentation_path)
    seg_data = np.asarray(seg_img.dataobj).astype(np.uint16)
    metadata = {
        "dimensions": list(seg_data.shape),
        "dtype": "uint16",
        "affine": seg_img.affine.tolist(),
    }
    return seg_data, metadata


def align_segmentation_to_volume_grid(
    segmentation: np.ndarray,
    segmentation_affine: np.ndarray,
    volume_shape: tuple[int, int, int],
    volume_affine: np.ndarray,
) -> np.ndarray:
    """Resample a NIfTI segmentation into the DICOM-derived CT grid.

    nibabel reports NIfTI affines in RAS world coordinates, while the viewer's
    CT affine is constructed from DICOM metadata in LPS coordinates. Convert the
    segmentation affine into LPS first so both transforms describe the same world
    space before deriving the output-to-input sampling transform.
    """
    segmentation_affine_lps = convert_nifti_affine_to_lps(segmentation_affine)
    transform = np.linalg.inv(segmentation_affine_lps) @ volume_affine
    aligned = affine_transform(
        segmentation,
        matrix=transform[:3, :3],
        offset=transform[:3, 3],
        output_shape=volume_shape,
        order=0,
        mode="constant",
        cval=0,
        prefilter=False,
    )
    return aligned.astype(np.uint16)


def _prepare_export_metadata(
    metadata: dict,
    downsampled_shape: tuple[int, ...],
    scale_factors: list[float],
    file_name: str,
    dtype: str,
    high_quality: bool,
) -> dict:
    """Build metadata for a downsampled raw volume export."""
    original_affine = build_volume_affine(metadata)
    adjusted_spacing = [
        float(spacing) / float(scale)
        for spacing, scale in zip(metadata["spacing"], scale_factors)
    ]

    export_metadata = {
        key: value
        for key, value in metadata.items()
        if key not in {"dimensions", "file", "dtype", "byte_order", "high_quality"}
    }
    export_metadata.update(
        {
            "dimensions": list(downsampled_shape),
            "spacing": adjusted_spacing,
            "file": file_name,
            "dtype": dtype,
            "byte_order": "little",
            "high_quality": high_quality,
            "affine": build_downsampled_affine(original_affine, scale_factors).tolist(),
        }
    )
    return export_metadata


def _write_volume_files(volume: np.ndarray, metadata: dict, output_dir: str, metadata_name: str) -> str:
    """Write raw volume bytes plus matching metadata JSON."""
    os.makedirs(output_dir, exist_ok=True)

    raw_path = os.path.join(output_dir, metadata["file"])
    volume.tofile(raw_path)

    meta_path = os.path.join(output_dir, metadata_name)
    with open(meta_path, "w") as file_handle:
        json.dump(metadata, file_handle, indent=2)

    return meta_path


def export_volume(
    volume: np.ndarray,
    metadata: dict,
    output_dir: str,
    high_quality: bool = False,
) -> str:
    """Export CT intensity volume as raw binary + metadata JSON for the viewer.

    Returns path to the metadata JSON file.
    """
    max_dim = HIGH_QUALITY_MAX_DIM if high_quality else DEFAULT_MAX_DIM
    downsampled, scale_factors = downsample_volume(volume, max_dim=max_dim, order=1)
    vol_metadata = _prepare_export_metadata(
        metadata,
        downsampled.shape,
        scale_factors,
        file_name="volume.raw",
        dtype="int16",
        high_quality=high_quality,
    )
    return _write_volume_files(downsampled.astype(np.int16), vol_metadata, output_dir, "volume_meta.json")


def export_segmentation_volume(
    segmentation: np.ndarray,
    metadata: dict,
    output_dir: str,
    scale_factors: list[float],
    high_quality: bool = False,
) -> str:
    """Export a segmentation label volume aligned to the CT volume grid."""
    downsampled = resample_volume(segmentation.astype(np.uint16), scale_factors, order=0)
    seg_metadata = _prepare_export_metadata(
        metadata,
        downsampled.shape,
        scale_factors,
        file_name="segmentation.raw",
        dtype="uint16",
        high_quality=high_quality,
    )
    seg_metadata["min_label"] = int(downsampled.min())
    seg_metadata["max_label"] = int(downsampled.max())
    return _write_volume_files(downsampled.astype(np.uint16), seg_metadata, output_dir, "segmentation_meta.json")


def export_volume_bundle(
    volume: np.ndarray,
    metadata: dict,
    segmentation_path: str,
    output_dir: str,
    high_quality: bool = False,
) -> dict:
    """Export aligned CT intensity and segmentation label volumes.

    Returns a metadata bundle for both exported assets.
    """
    os.makedirs(output_dir, exist_ok=True)

    max_dim = HIGH_QUALITY_MAX_DIM if high_quality else DEFAULT_MAX_DIM
    downsampled_volume, scale_factors = downsample_volume(volume, max_dim=max_dim, order=1)
    intensity_metadata = _prepare_export_metadata(
        metadata,
        downsampled_volume.shape,
        scale_factors,
        file_name="volume.raw",
        dtype="int16",
        high_quality=high_quality,
    )
    _write_volume_files(
        downsampled_volume.astype(np.int16),
        intensity_metadata,
        output_dir,
        "volume_meta.json",
    )

    segmentation, segmentation_metadata = load_segmentation_labels(segmentation_path)
    aligned_segmentation = align_segmentation_to_volume_grid(
        segmentation,
        np.asarray(segmentation_metadata["affine"], dtype=np.float64),
        tuple(volume.shape),
        build_volume_affine(metadata),
    )
    export_segmentation_volume(
        aligned_segmentation,
        metadata,
        output_dir,
        scale_factors,
        high_quality=high_quality,
    )

    with open(os.path.join(output_dir, "segmentation_meta.json")) as file_handle:
        exported_segmentation_metadata = json.load(file_handle)

    return {
        "intensity": intensity_metadata,
        "segmentation": exported_segmentation_metadata,
    }
