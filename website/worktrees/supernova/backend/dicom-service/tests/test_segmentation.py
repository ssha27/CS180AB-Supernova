"""
Tests for the segmentation module.

TotalSegmentator is mocked to avoid requiring model weights in CI.
"""

import os
import tempfile
from unittest.mock import MagicMock, patch

import numpy as np
import pytest


class TestVolumeToNifti:
    """Test NIfTI conversion from numpy volume."""

    def test_creates_nifti_file(self):
        from app.segmentation import _volume_to_nifti_path

        volume = np.random.randn(20, 64, 64).astype(np.float32)
        spacing = [0.5, 0.5, 1.0]
        origin = [0.0, 0.0, 0.0]

        with tempfile.TemporaryDirectory() as tmp:
            path = _volume_to_nifti_path(volume, spacing, origin, tmp)
            assert os.path.isfile(path)
            assert path.endswith(".nii.gz")

    def test_nifti_has_correct_shape(self):
        import nibabel as nib
        from app.segmentation import _volume_to_nifti_path

        volume = np.zeros((10, 32, 48), dtype=np.float32)
        spacing = [1.0, 1.0, 2.0]
        origin = [10.0, 20.0, 30.0]

        with tempfile.TemporaryDirectory() as tmp:
            path = _volume_to_nifti_path(volume, spacing, origin, tmp)
            nii = nib.load(path)
            # NIfTI shape is (X, Y, Z) = transposed from (Z, Y, X)
            assert nii.shape == (48, 32, 10)

    def test_nifti_affine_encodes_spacing_and_origin(self):
        import nibabel as nib
        from app.segmentation import _volume_to_nifti_path

        volume = np.zeros((5, 8, 12), dtype=np.float32)
        spacing = [0.5, 0.75, 2.0]
        origin = [10.0, 20.0, 30.0]

        with tempfile.TemporaryDirectory() as tmp:
            path = _volume_to_nifti_path(volume, spacing, origin, tmp)
            nii = nib.load(path)
            affine = nii.affine
            assert affine[0, 0] == pytest.approx(0.5)
            assert affine[1, 1] == pytest.approx(0.75)
            assert affine[2, 2] == pytest.approx(2.0)
            assert affine[0, 3] == pytest.approx(10.0)
            assert affine[1, 3] == pytest.approx(20.0)
            assert affine[2, 3] == pytest.approx(30.0)


class TestResolveDevice:
    """Test GPU/CPU device resolution."""

    def test_cpu_when_env_set(self):
        from app.segmentation import _resolve_device
        with patch("app.segmentation._DEVICE_ENV", "cpu"):
            assert _resolve_device() == "cpu"

    def test_gpu_when_env_set(self):
        from app.segmentation import _resolve_device
        with patch("app.segmentation._DEVICE_ENV", "gpu"):
            assert _resolve_device() == "gpu"

    def test_auto_falls_back_to_cpu_without_torch(self):
        from app.segmentation import _resolve_device
        with patch("app.segmentation._DEVICE_ENV", "auto"):
            with patch.dict("sys.modules", {"torch": None}):
                assert _resolve_device() == "cpu"


class TestGetLabelNameMap:
    """Test label → name mapping fallback."""

    def test_fallback_map_has_common_structures(self):
        from app.segmentation import _get_label_name_map
        with patch.dict("sys.modules", {"totalsegmentator.map_to_binary": None}):
            mapping = _get_label_name_map()
            assert mapping[51] == "heart"
            assert mapping[5] == "liver"
            assert mapping[1] == "spleen"
            assert mapping[90] == "brain"
            assert isinstance(mapping, dict)
            assert len(mapping) > 40


class TestRunSegmentation:
    """Test segmentation pipeline with mocked TotalSegmentator."""

    @patch("app.segmentation.totalsegmentator")
    def test_returns_empty_when_totalseg_not_installed(self, _mock):
        from app.segmentation import run_segmentation
        # Simulate import failure
        with patch.dict("sys.modules", {"totalsegmentator.python_api": None}):
            with tempfile.TemporaryDirectory() as tmp:
                volume = np.random.randn(20, 64, 64).astype(np.float32)
                result = run_segmentation(volume, [1, 1, 1], [0, 0, 0], tmp)
                assert result["structures"] == {}
                assert result["label_volume_path"] is None

    def test_returns_structures_with_mock(self):
        """Mock TotalSegmentator to produce a synthetic label volume."""
        import nibabel as nib
        from app.segmentation import run_segmentation

        volume = np.random.randn(20, 64, 64).astype(np.float32)

        def fake_totalseg(input, output, device, fast, ml):
            # Create a fake segmentation output with labels 5 (liver) and 51 (heart)
            nii_in = nib.load(input)
            shape = nii_in.shape  # (X, Y, Z)
            labels = np.zeros(shape, dtype=np.int16)
            # Put label 5 in one quadrant, 51 in another
            labels[:shape[0]//2, :, :] = 5
            labels[shape[0]//2:, :shape[1]//2, :] = 51
            nii_out = nib.Nifti1Image(labels, nii_in.affine)
            nib.save(nii_out, output)

        mock_module = MagicMock()
        mock_module.totalsegmentator = fake_totalseg

        with patch.dict("sys.modules", {"totalsegmentator.python_api": mock_module}):
            with tempfile.TemporaryDirectory() as tmp:
                result = run_segmentation(volume, [1, 1, 1], [0, 0, 0], tmp)
                assert "liver" in result["structures"] or 5 in result["structures"].values()
                assert "heart" in result["structures"] or 51 in result["structures"].values()
                assert result["label_volume_path"] is not None
                assert os.path.isfile(result["label_volume_path"])

    def test_progress_callback_called(self):
        from app.segmentation import run_segmentation

        progress_values = []

        with patch.dict("sys.modules", {"totalsegmentator.python_api": None}):
            with tempfile.TemporaryDirectory() as tmp:
                volume = np.zeros((10, 32, 32), dtype=np.float32)
                run_segmentation(
                    volume, [1, 1, 1], [0, 0, 0], tmp,
                    on_progress=lambda p: progress_values.append(p),
                )
                # Should have called progress at least once (5%)
                assert len(progress_values) >= 1
