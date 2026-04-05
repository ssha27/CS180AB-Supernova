"""
Tests for Marching Cubes surface generation using synthetic volumes.
No DICOM dependency — pure math/algorithm tests.
"""

import os
import numpy as np
import pytest


class TestMarchingCubes:
    """Test surface mesh generation from synthetic 3D volumes."""

    def test_sphere_produces_mesh(self, synthetic_volume, temp_dir):
        """A sphere volume should produce a valid mesh with vertices and faces."""
        import vtk
        from vtk.util.numpy_support import numpy_to_vtk

        volume = synthetic_volume(shape=(32, 32, 32), radius=10)

        image_data = vtk.vtkImageData()
        image_data.SetDimensions(32, 32, 32)
        image_data.SetSpacing(1.0, 1.0, 1.0)

        flat = volume.flatten(order="C")
        vtk_array = numpy_to_vtk(flat, deep=True, array_type=vtk.VTK_FLOAT)
        image_data.GetPointData().SetScalars(vtk_array)

        mc = vtk.vtkMarchingCubes()
        mc.SetInputData(image_data)
        mc.SetValue(0, 0.0)  # Threshold at boundary
        mc.Update()

        output = mc.GetOutput()
        assert output.GetNumberOfPoints() > 0
        assert output.GetNumberOfCells() > 0

    def test_different_thresholds_produce_different_meshes(self, synthetic_volume):
        """Different isosurface thresholds should produce meshes with different vertex counts."""
        import vtk
        from vtk.util.numpy_support import numpy_to_vtk

        # Create a volume with a gradient (distance field)
        shape = (32, 32, 32)
        z, y, x = np.ogrid[0:shape[0], 0:shape[1], 0:shape[2]]
        center = [16, 16, 16]
        dist = np.sqrt((x - center[2])**2 + (y - center[1])**2 + (z - center[0])**2)
        volume = (20.0 - dist).astype(np.float32)  # Positive inside, negative outside

        image_data = vtk.vtkImageData()
        image_data.SetDimensions(32, 32, 32)
        image_data.SetSpacing(1.0, 1.0, 1.0)
        flat = volume.flatten(order="C")
        vtk_array = numpy_to_vtk(flat, deep=True, array_type=vtk.VTK_FLOAT)
        image_data.GetPointData().SetScalars(vtk_array)

        counts = []
        for threshold in [5.0, 10.0, 15.0]:
            mc = vtk.vtkMarchingCubes()
            mc.SetInputData(image_data)
            mc.SetValue(0, threshold)
            mc.Update()
            counts.append(mc.GetOutput().GetNumberOfPoints())

        # Each threshold should give a different mesh
        assert len(set(counts)) > 1

    def test_empty_volume_produces_no_mesh(self):
        """A uniform volume (no isosurface crossing) should produce an empty mesh."""
        import vtk
        from vtk.util.numpy_support import numpy_to_vtk

        volume = np.ones((16, 16, 16), dtype=np.float32) * 1000.0

        image_data = vtk.vtkImageData()
        image_data.SetDimensions(16, 16, 16)
        image_data.SetSpacing(1.0, 1.0, 1.0)
        flat = volume.flatten(order="C")
        vtk_array = numpy_to_vtk(flat, deep=True, array_type=vtk.VTK_FLOAT)
        image_data.GetPointData().SetScalars(vtk_array)

        mc = vtk.vtkMarchingCubes()
        mc.SetInputData(image_data)
        mc.SetValue(0, 5000.0)  # Threshold above all values
        mc.Update()

        assert mc.GetOutput().GetNumberOfPoints() == 0
