"""Tests for mesh generation module."""
import os
import json
import tempfile
import pytest
import numpy as np
import nibabel as nib
import trimesh

from app.mesh_generation import (
    extract_organ_mesh,
    decimate_mesh,
    smooth_mesh,
    export_organ_stl,
    generate_all_meshes,
    DEFAULT_DECIMATE_TARGET,
)


def _make_sphere_labelmap(shape=(64, 64, 64), label_id=5, radius=15):
    """Create a synthetic NIfTI with a sphere at the center assigned to label_id."""
    data = np.zeros(shape, dtype=np.int16)
    center = np.array(shape) // 2
    zz, yy, xx = np.mgrid[:shape[0], :shape[1], :shape[2]]
    dist = np.sqrt((zz - center[0])**2 + (yy - center[1])**2 + (xx - center[2])**2)
    data[dist <= radius] = label_id
    affine = np.diag([1.0, 1.0, 1.0, 1.0])
    return nib.Nifti1Image(data, affine)


def _make_two_organ_labelmap():
    """Create a NIfTI with two separate sphere organs (label 1=spleen, label 5=liver)."""
    data = np.zeros((64, 64, 64), dtype=np.int16)
    zz, yy, xx = np.mgrid[:64, :64, :64]

    # Spleen at (20, 32, 32)
    dist1 = np.sqrt((zz - 20)**2 + (yy - 32)**2 + (xx - 32)**2)
    data[dist1 <= 10] = 1

    # Liver at (44, 32, 32)
    dist2 = np.sqrt((zz - 44)**2 + (yy - 32)**2 + (xx - 32)**2)
    data[dist2 <= 10] = 5

    affine = np.diag([1.5, 1.5, 1.5, 1.0])
    return nib.Nifti1Image(data, affine)


class TestExtractOrganMesh:
    def test_extracts_mesh_from_sphere(self):
        img = _make_sphere_labelmap(label_id=5, radius=15)
        data = np.asarray(img.dataobj)
        mesh = extract_organ_mesh(data, 5, (1.0, 1.0, 1.0), img.affine)

        assert mesh is not None
        assert len(mesh.vertices) > 0
        assert len(mesh.faces) > 0

    def test_returns_none_for_missing_label(self):
        img = _make_sphere_labelmap(label_id=5)
        data = np.asarray(img.dataobj)
        mesh = extract_organ_mesh(data, 99, (1.0, 1.0, 1.0), img.affine)
        assert mesh is None

    def test_respects_voxel_spacing(self):
        img = _make_sphere_labelmap(label_id=5, radius=10)
        data = np.asarray(img.dataobj)

        mesh_1mm = extract_organ_mesh(data, 5, (1.0, 1.0, 1.0), np.eye(4))
        mesh_2mm = extract_organ_mesh(data, 5, (2.0, 2.0, 2.0), np.diag([2, 2, 2, 1]))

        # Affine with 2mm scaling should produce a mesh spanning double the physical space
        extent_1 = np.ptp(mesh_1mm.vertices, axis=0)
        extent_2 = np.ptp(mesh_2mm.vertices, axis=0)
        # Ratio should be approximately 2 (affine handles the scaling)
        ratio = extent_2.mean() / extent_1.mean()
        assert 1.8 < ratio < 2.2

    def test_affine_transform_applied(self):
        img = _make_sphere_labelmap(label_id=5, radius=10)
        data = np.asarray(img.dataobj)

        # Offset the origin by 100mm
        affine = np.eye(4)
        affine[:3, 3] = [100, 100, 100]
        mesh = extract_organ_mesh(data, 5, (1.0, 1.0, 1.0), affine)

        assert mesh is not None
        # All vertices should be offset to ~100+ range
        assert mesh.vertices.min() > 90


class TestDecimateMesh:
    def test_reduces_face_count(self):
        img = _make_sphere_labelmap(label_id=5, radius=20)
        data = np.asarray(img.dataobj)
        mesh = extract_organ_mesh(data, 5, (1.0, 1.0, 1.0), np.eye(4))

        original_faces = len(mesh.faces)
        target = original_faces // 4
        decimated = decimate_mesh(mesh, target)

        assert len(decimated.faces) <= target * 1.2  # Allow 20% tolerance

    def test_no_decimation_if_below_target(self):
        img = _make_sphere_labelmap(label_id=5, radius=5)
        data = np.asarray(img.dataobj)
        mesh = extract_organ_mesh(data, 5, (1.0, 1.0, 1.0), np.eye(4))

        original_faces = len(mesh.faces)
        result = decimate_mesh(mesh, original_faces + 1000)
        assert len(result.faces) == original_faces


class TestSmoothMesh:
    def test_smoothing_does_not_crash(self):
        img = _make_sphere_labelmap(label_id=5, radius=10)
        data = np.asarray(img.dataobj)
        mesh = extract_organ_mesh(data, 5, (1.0, 1.0, 1.0), np.eye(4))

        smoothed = smooth_mesh(mesh, iterations=5)
        assert len(smoothed.vertices) > 0
        assert len(smoothed.faces) > 0


class TestExportOrganStl:
    def test_exports_valid_stl_file(self):
        img = _make_sphere_labelmap(label_id=5, radius=10)
        data = np.asarray(img.dataobj)
        mesh = extract_organ_mesh(data, 5, (1.0, 1.0, 1.0), np.eye(4))

        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as f:
            path = f.name

        try:
            vtx_count = export_organ_stl(mesh, path)
            assert os.path.exists(path)
            assert os.path.getsize(path) > 0
            assert vtx_count > 0

            # Verify it can be loaded back
            loaded = trimesh.load(path, file_type="stl", force="mesh")
            assert len(loaded.vertices) > 0
        finally:
            os.unlink(path)


class TestGenerateAllMeshes:
    def test_generates_meshes_for_two_organs(self):
        img = _make_two_organ_labelmap()

        with tempfile.TemporaryDirectory() as tmpdir:
            seg_path = os.path.join(tmpdir, "seg.nii.gz")
            nib.save(img, seg_path)

            output_dir = os.path.join(tmpdir, "meshes")
            organs = generate_all_meshes(seg_path, output_dir)

            assert len(organs) == 2
            names = {o.name for o in organs}
            assert "spleen" in names
            assert "liver" in names

            # Check files exist
            for organ in organs:
                stl_path = os.path.join(output_dir, organ.file)
                assert os.path.exists(stl_path)

            # Check metadata file
            meta_path = os.path.join(output_dir, "metadata.json")
            assert os.path.exists(meta_path)
            with open(meta_path) as f:
                meta = json.load(f)
            assert len(meta["organs"]) == 2

    def test_progress_callback_called(self):
        img = _make_two_organ_labelmap()
        calls = []

        def callback(current, total, name):
            calls.append((current, total, name))

        with tempfile.TemporaryDirectory() as tmpdir:
            seg_path = os.path.join(tmpdir, "seg.nii.gz")
            nib.save(img, seg_path)

            output_dir = os.path.join(tmpdir, "meshes")
            generate_all_meshes(seg_path, output_dir, progress_callback=callback)

        assert len(calls) == 2
        assert calls[0][1] == 2  # total = 2

    def test_skips_unknown_labels(self):
        # Label 999 is not in ORGAN_COLOR_MAP
        data = np.zeros((32, 32, 32), dtype=np.int16)
        zz, yy, xx = np.mgrid[:32, :32, :32]
        dist = np.sqrt((zz - 16)**2 + (yy - 16)**2 + (xx - 16)**2)
        data[dist <= 8] = 999
        img = nib.Nifti1Image(data, np.eye(4))

        with tempfile.TemporaryDirectory() as tmpdir:
            seg_path = os.path.join(tmpdir, "seg.nii.gz")
            nib.save(img, seg_path)

            output_dir = os.path.join(tmpdir, "meshes")
            organs = generate_all_meshes(seg_path, output_dir)

            assert len(organs) == 0
