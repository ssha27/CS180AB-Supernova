"""
Tests for per-organ mesh generation from label volumes.
"""

import json
import os
import tempfile

import numpy as np
import pytest


@pytest.fixture
def synthetic_label_volume():
    """
    Create a synthetic label volume with two distinct structures:
    label 5 (liver) = sphere in one corner,
    label 51 (heart) = sphere in opposite corner.
    """
    def _make(shape=(32, 32, 32)):
        labels = np.zeros(shape, dtype=np.int16)
        z, y, x = np.ogrid[0:shape[0], 0:shape[1], 0:shape[2]]

        # Liver sphere at (8, 8, 8), radius 5
        dist_liver = np.sqrt((z - 8)**2 + (y - 8)**2 + (x - 8)**2)
        labels[dist_liver <= 5] = 5

        # Heart sphere at (24, 24, 24), radius 5
        dist_heart = np.sqrt((z - 24)**2 + (y - 24)**2 + (x - 24)**2)
        labels[dist_heart <= 5] = 51

        return labels
    return _make


@pytest.fixture
def saved_label_volume(synthetic_label_volume, tmp_path):
    """Save the synthetic label volume as .npz and return path."""
    labels = synthetic_label_volume()
    path = os.path.join(str(tmp_path), "labels.npz")
    np.savez_compressed(path, labels=labels)
    return path


class TestGenerateOrganMeshes:
    """Test per-organ mesh generation."""

    def test_generates_vtp_files(self, saved_label_volume, tmp_path):
        from app.organ_meshes import generate_organ_meshes

        structures = {"liver": 5, "heart": 51}
        spacing = [1.0, 1.0, 1.0]
        origin = [0.0, 0.0, 0.0]

        manifest = generate_organ_meshes(
            saved_label_volume, structures, spacing, origin, str(tmp_path)
        )

        # Should generate meshes for both structures
        assert len(manifest) == 2

        # Check VTP files exist
        segments_dir = os.path.join(str(tmp_path), "segments")
        for entry in manifest:
            vtp_path = os.path.join(segments_dir, entry["file"])
            assert os.path.isfile(vtp_path), f"Missing VTP: {entry['file']}"
            assert os.path.getsize(vtp_path) > 0

    def test_manifest_schema(self, saved_label_volume, tmp_path):
        from app.organ_meshes import generate_organ_meshes

        structures = {"liver": 5, "heart": 51}
        manifest = generate_organ_meshes(
            saved_label_volume, structures, [1, 1, 1], [0, 0, 0], str(tmp_path)
        )

        for entry in manifest:
            assert "name" in entry
            assert "displayName" in entry
            assert "color" in entry
            assert "file" in entry
            assert "fileSize" in entry
            assert isinstance(entry["color"], list)
            assert len(entry["color"]) == 3
            assert entry["file"].endswith(".vtp")

    def test_manifest_json_file_written(self, saved_label_volume, tmp_path):
        from app.organ_meshes import generate_organ_meshes

        structures = {"liver": 5}
        generate_organ_meshes(
            saved_label_volume, structures, [1, 1, 1], [0, 0, 0], str(tmp_path)
        )

        manifest_path = os.path.join(str(tmp_path), "segments", "manifest.json")
        assert os.path.isfile(manifest_path)
        with open(manifest_path) as f:
            data = json.load(f)
        assert isinstance(data, list)

    def test_skips_empty_labels(self, tmp_path):
        from app.organ_meshes import generate_organ_meshes

        # Label volume with no matching voxels for label 99
        labels = np.zeros((16, 16, 16), dtype=np.int16)
        labels[5:10, 5:10, 5:10] = 5  # only liver
        path = os.path.join(str(tmp_path), "labels.npz")
        np.savez_compressed(path, labels=labels)

        structures = {"liver": 5, "nonexistent": 99}
        manifest = generate_organ_meshes(
            path, structures, [1, 1, 1], [0, 0, 0], str(tmp_path)
        )

        # Only liver should have a mesh
        names = [e["name"] for e in manifest]
        assert "liver" in names
        assert "nonexistent" not in names

    def test_progress_callback(self, saved_label_volume, tmp_path):
        from app.organ_meshes import generate_organ_meshes

        progress_values = []
        structures = {"liver": 5, "heart": 51}
        generate_organ_meshes(
            saved_label_volume, structures, [1, 1, 1], [0, 0, 0], str(tmp_path),
            on_progress=lambda p: progress_values.append(p),
        )

        assert len(progress_values) >= 2
        assert progress_values[-1] == 100


class TestOrganColors:
    """Test color assignment logic."""

    def test_known_structures_get_correct_colors(self):
        from app.organ_meshes import _get_color

        heart_color = _get_color("heart", 0)
        assert heart_color[0] > 0.5  # red-ish
        assert heart_color[1] < 0.3  # not green

        liver_color = _get_color("liver", 1)
        assert liver_color[0] > 0.4  # brown-ish

    def test_unknown_structures_get_fallback(self):
        from app.organ_meshes import _get_color

        color = _get_color("unknown_structure_xyz", 0)
        assert isinstance(color, list)
        assert len(color) == 3

    def test_fallback_is_deterministic(self):
        from app.organ_meshes import _get_color

        c1 = _get_color("mystery_organ", 3)
        c2 = _get_color("mystery_organ", 3)
        assert c1 == c2


class TestPrettyName:
    """Test display name conversion."""

    def test_snake_case_to_title(self):
        from app.organ_meshes import _pretty_name

        assert _pretty_name("kidney_left") == "Kidney Left"
        assert _pretty_name("lung_upper_lobe_right") == "Lung Upper Lobe Right"
        assert _pretty_name("heart") == "Heart"
        assert _pretty_name("vertebrae_L1") == "Vertebrae L1"
