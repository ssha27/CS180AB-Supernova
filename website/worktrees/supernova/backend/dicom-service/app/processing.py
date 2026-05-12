"""
DICOM processing pipeline.

Workflow:
1. Discover and parse DICOM files from input directory
2. Strip PII metadata (anonymize)
3. Stack 2D slices into 3D volume
4. Generate volume data for volume rendering
5. Generate surface mesh via Marching Cubes for surface rendering
6. Save artifacts to job directory
"""

import json
import os
import struct
import traceback
import zipfile

import numpy as np
import pydicom

from .anonymize import strip_pii
from .job_store import set_job_status, update_job_progress
from .segmentation import run_segmentation
from .organ_meshes import generate_organ_meshes

# Minimum number of slices required for 3D reconstruction
MIN_SLICES_FOR_3D = 10


def process_dicom_job(job_id: str, input_dir: str) -> None:
    """
    Main entry point — runs the full DICOM processing pipeline.
    Called as a background task.
    """
    try:
        update_job_progress(job_id, 5)

        # Step 1: Extract zips if present
        _extract_zips(input_dir)
        update_job_progress(job_id, 10)

        # Step 2: Discover and parse DICOM files
        dcm_datasets = _load_dicom_files(input_dir)
        update_job_progress(job_id, 25)

        if not dcm_datasets:
            set_job_status(job_id, {
                "status": "failed",
                "error": "No valid DICOM files found in the upload.",
            })
            return

        # Step 3: Anonymize all datasets
        for ds in dcm_datasets:
            strip_pii(ds)
        update_job_progress(job_id, 30)

        # Step 4: Extract metadata
        metadata = _extract_metadata(dcm_datasets[0], len(dcm_datasets))
        _save_json(os.path.join(input_dir, "metadata.json"), metadata)

        # Step 5: Check if we have enough slices for 3D
        if len(dcm_datasets) < MIN_SLICES_FOR_3D:
            # 2D fallback
            _save_2d_fallback(job_id, input_dir, dcm_datasets, metadata)
            return

        update_job_progress(job_id, 35)

        # Step 6: Stack slices into 3D volume
        volume, spacing, origin = _stack_slices(dcm_datasets)
        update_job_progress(job_id, 45)

        # Step 7: Generate volume rendering data
        _save_volume_data(input_dir, volume, spacing, origin)
        update_job_progress(job_id, 55)

        # Step 8: Generate surface mesh via Marching Cubes
        _save_surface_mesh(input_dir, volume, spacing, origin)
        update_job_progress(job_id, 65)

        # Step 9: Organ segmentation via TotalSegmentator
        segments_available = False
        segment_count = 0
        is_ct = False  # TODO: re-enable with `float(volume.min()) < -500` when GPU available
        if is_ct:
            try:
                seg_result = run_segmentation(
                    volume, spacing, origin, input_dir,
                    on_progress=lambda p: update_job_progress(
                        job_id, 65 + int(p * 0.15)  # 65→80%
                    ),
                )
                update_job_progress(job_id, 80)

                # Step 10: Generate per-organ meshes
                if seg_result["structures"] and seg_result["label_volume_path"]:
                    manifest = generate_organ_meshes(
                        seg_result["label_volume_path"],
                        seg_result["structures"],
                        spacing, origin, input_dir,
                        on_progress=lambda p: update_job_progress(
                            job_id, 80 + int(p * 0.15)  # 80→95%
                        ),
                    )
                    segments_available = len(manifest) > 0
                    segment_count = len(manifest)
            except Exception as seg_err:
                # Segmentation failure is non-fatal — log and continue
                import traceback as tb
                tb.print_exc()
                print(f"Segmentation skipped: {seg_err}")
        else:
            print("Non-CT data — skipping organ segmentation")

        update_job_progress(job_id, 95)

        # Done
        set_job_status(job_id, {
            "status": "completed",
            "progress": 100,
            "result": {
                "totalSlices": len(dcm_datasets),
                "dimensions": list(volume.shape),
                "spacing": list(spacing),
                "is2DFallback": False,
                "metadata": metadata,
                "segmentsAvailable": segments_available,
                "segmentCount": segment_count,
            },
        })

    except Exception as e:
        traceback.print_exc()
        set_job_status(job_id, {
            "status": "failed",
            "error": str(e),
        })


def _extract_zips(input_dir: str) -> None:
    """Extract any .zip files in the input directory."""
    for fname in os.listdir(input_dir):
        if fname.lower().endswith(".zip"):
            zip_path = os.path.join(input_dir, fname)
            try:
                with zipfile.ZipFile(zip_path, "r") as zf:
                    zf.extractall(input_dir)
                os.remove(zip_path)
            except zipfile.BadZipFile:
                pass  # Skip corrupt zips


def _load_dicom_files(input_dir: str) -> list:
    """
    Recursively discover and parse all DICOM files in a directory.
    Returns a list of pydicom Dataset objects.
    """
    datasets = []
    for root, _, files in os.walk(input_dir):
        for fname in files:
            fpath = os.path.join(root, fname)
            # Skip non-DICOM artifacts
            if fname.endswith((".json", ".bin", ".vtp")):
                continue
            try:
                ds = pydicom.dcmread(fpath, force=True)
                # Must have pixel data to be useful
                if hasattr(ds, "pixel_array"):
                    datasets.append(ds)
            except Exception:
                continue  # Skip files that aren't valid DICOM
    return datasets


def _extract_metadata(ds, num_slices: int) -> dict:
    """Extract imaging-relevant metadata from a DICOM dataset (PII already stripped)."""
    return {
        "modality": getattr(ds, "Modality", "Unknown"),
        "studyDescription": getattr(ds, "StudyDescription", ""),
        "seriesDescription": getattr(ds, "SeriesDescription", ""),
        "rows": int(getattr(ds, "Rows", 0)),
        "columns": int(getattr(ds, "Columns", 0)),
        "sliceCount": num_slices,
        "pixelSpacing": [float(x) for x in getattr(ds, "PixelSpacing", [1.0, 1.0])],
        "sliceThickness": float(getattr(ds, "SliceThickness", 1.0)),
        "bitsAllocated": int(getattr(ds, "BitsAllocated", 16)),
        "photometricInterpretation": getattr(ds, "PhotometricInterpretation", "MONOCHROME2"),
    }


def _stack_slices(datasets: list) -> tuple:
    """
    Stack 2D DICOM slices into a 3D numpy volume.

    Returns:
        (volume, spacing, origin) where:
        - volume: np.ndarray of shape (Z, Y, X)
        - spacing: [sx, sy, sz]
        - origin: [ox, oy, oz]
    """
    # Sort by ImagePositionPatient[2] (Z position) if available, else by InstanceNumber
    def sort_key(ds):
        if hasattr(ds, "ImagePositionPatient"):
            return float(ds.ImagePositionPatient[2])
        if hasattr(ds, "InstanceNumber"):
            return int(ds.InstanceNumber)
        return 0

    datasets.sort(key=sort_key)

    # Extract pixel arrays
    slices = []
    for ds in datasets:
        try:
            arr = ds.pixel_array.astype(np.float32)
            # Apply rescale slope/intercept if present (Hounsfield units for CT)
            slope = float(getattr(ds, "RescaleSlope", 1))
            intercept = float(getattr(ds, "RescaleIntercept", 0))
            arr = arr * slope + intercept
            slices.append(arr)
        except Exception:
            continue

    if not slices:
        raise ValueError("No valid pixel data found in DICOM slices.")

    volume = np.stack(slices, axis=0)

    # Calculate spacing
    ds0 = datasets[0]
    pixel_spacing = [float(x) for x in getattr(ds0, "PixelSpacing", [1.0, 1.0])]
    # DICOM PixelSpacing = [row_spacing (dy), column_spacing (dx)]
    dx = pixel_spacing[1]  # column spacing = X direction
    dy = pixel_spacing[0]  # row spacing = Y direction
    slice_thickness = float(getattr(ds0, "SliceThickness", 1.0))

    # Try to compute actual Z spacing from positions
    if len(datasets) >= 2 and hasattr(datasets[0], "ImagePositionPatient"):
        z0 = float(datasets[0].ImagePositionPatient[2])
        z1 = float(datasets[1].ImagePositionPatient[2])
        z_spacing = abs(z1 - z0)
        if z_spacing > 0:
            slice_thickness = z_spacing

    # Spacing in [x, y, z] order for VTK
    spacing = [dx, dy, slice_thickness]

    origin = [0.0, 0.0, 0.0]
    if hasattr(ds0, "ImagePositionPatient"):
        origin = [float(x) for x in ds0.ImagePositionPatient]

    return volume, spacing, origin


def _save_volume_data(output_dir: str, volume: np.ndarray, spacing: list, origin: list) -> None:
    """
    Save volume data in a binary format consumable by vtk.js.

    Format: JSON header + raw float32 binary
    - metadata.json already saved separately
    - volume.bin: raw float32 array (Z × Y × X)
    - volume_info.json: dimensions, spacing, origin, data type info
    """
    # NumPy shape is (Z, Y, X) but vtk.js expects dimensions as [X, Y, Z]
    volume_info = {
        "dimensions": [int(volume.shape[2]), int(volume.shape[1]), int(volume.shape[0])],
        "spacing": spacing,  # already in [x, y, z] order
        "origin": origin,
        "dataType": "Float32",
        "min": float(volume.min()),
        "max": float(volume.max()),
    }

    _save_json(os.path.join(output_dir, "volume_info.json"), volume_info)

    # Save raw binary
    volume_path = os.path.join(output_dir, "volume.bin")
    volume.astype(np.float32).tofile(volume_path)


def _save_surface_mesh(output_dir: str, volume: np.ndarray, spacing: list, origin: list) -> None:
    """
    Generate a surface mesh from the 3D volume using VTK Marching Cubes.
    Saves as a VTP (VTK PolyData) file.
    """
    import vtk
    from vtk.util.numpy_support import numpy_to_vtk

    # Create VTK image data
    image_data = vtk.vtkImageData()
    dims = volume.shape  # (Z, Y, X)
    image_data.SetDimensions(dims[2], dims[1], dims[0])
    image_data.SetSpacing(spacing[0], spacing[1], spacing[2])
    image_data.SetOrigin(origin[0], origin[1], origin[2])

    # Flatten volume in Fortran order for VTK (X varies fastest)
    flat = volume.flatten(order="C")
    vtk_array = numpy_to_vtk(flat, deep=True, array_type=vtk.VTK_FLOAT)
    vtk_array.SetName("Scalars")
    image_data.GetPointData().SetScalars(vtk_array)

    # Compute a reasonable isosurface threshold based on data characteristics
    data_min = float(volume.min())
    data_max = float(volume.max())
    is_ct = data_min < -500  # CT data has air at ~-1000 HU

    if is_ct:
        # For CT data, use a skin-level threshold to show body contour
        # Air is ~-1000 HU, fat is ~-100 HU, water is 0 HU
        # A threshold of -200 HU captures the air/body boundary cleanly
        threshold = -200.0
    else:
        # For non-CT data (MRI, etc.), use Otsu-style thresholding
        # Exclude background voxels (below 10th percentile)
        p10 = float(np.percentile(volume, 10))
        foreground = volume[volume > p10]
        if foreground.size > 0:
            threshold = float(np.percentile(foreground, 60))
        else:
            threshold = float(volume.mean() + volume.std())

    # Marching Cubes
    mc = vtk.vtkMarchingCubes()
    mc.SetInputData(image_data)
    mc.SetValue(0, threshold)
    mc.ComputeNormalsOn()
    mc.Update()

    # Optional: smooth the mesh
    smoother = vtk.vtkWindowedSincPolyDataFilter()
    smoother.SetInputData(mc.GetOutput())
    smoother.SetNumberOfIterations(20)
    smoother.BoundarySmoothingOff()
    smoother.FeatureEdgeSmoothingOff()
    smoother.SetPassBand(0.1)
    smoother.NonManifoldSmoothingOn()
    smoother.NormalizeCoordinatesOn()
    smoother.Update()

    # Decimate for performance
    decimator = vtk.vtkDecimatePro()
    decimator.SetInputData(smoother.GetOutput())
    decimator.SetTargetReduction(0.5)  # Reduce to 50% of original faces
    decimator.PreserveTopologyOn()
    decimator.Update()

    # Save as VTP
    writer = vtk.vtkXMLPolyDataWriter()
    writer.SetFileName(os.path.join(output_dir, "surface.vtp"))
    writer.SetInputData(decimator.GetOutput())
    writer.SetDataModeToBinary()
    writer.Write()


def _save_2d_fallback(job_id: str, output_dir: str, datasets: list, metadata: dict) -> None:
    """Handle the case where there are too few slices for 3D."""
    message = (
        f"Too few slices for 3D reconstruction ({len(datasets)} found, "
        f"minimum {MIN_SLICES_FOR_3D} required). Displaying 2D view."
    )

    # Save the first slice as a simple 2D image array
    arr = datasets[0].pixel_array.astype(np.float32)
    slope = float(getattr(datasets[0], "RescaleSlope", 1))
    intercept = float(getattr(datasets[0], "RescaleIntercept", 0))
    arr = arr * slope + intercept
    arr.tofile(os.path.join(output_dir, "slice_2d.bin"))

    slice_info = {
        "dimensions": list(arr.shape),
        "dataType": "Float32",
        "min": float(arr.min()),
        "max": float(arr.max()),
    }
    _save_json(os.path.join(output_dir, "slice_2d_info.json"), slice_info)

    set_job_status(job_id, {
        "status": "completed",
        "progress": 100,
        "result": {
            "totalSlices": len(datasets),
            "is2DFallback": True,
            "fallbackMessage": message,
            "metadata": metadata,
        },
    })


def _save_json(path: str, data: dict) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
