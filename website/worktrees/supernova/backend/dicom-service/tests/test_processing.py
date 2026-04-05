"""
Tests for the DICOM processing pipeline.
"""

import json
import os

import numpy as np
import pydicom
import pytest

from app.processing import (
    _load_dicom_files,
    _extract_metadata,
    _stack_slices,
    _save_volume_data,
    _extract_zips,
    MIN_SLICES_FOR_3D,
)


class TestLoadDicomFiles:
    """Test DICOM file discovery and parsing."""

    def test_loads_valid_dicom_files(self, sample_dicom_series, temp_dir):
        paths, _ = sample_dicom_series(num_slices=5)
        datasets = _load_dicom_files(temp_dir)
        assert len(datasets) == 5

    def test_skips_non_dicom_files(self, sample_dicom_file, temp_dir):
        sample_dicom_file(filename="valid.dcm")
        # Create a non-DICOM file
        with open(os.path.join(temp_dir, "readme.txt"), "w") as f:
            f.write("not a dicom file")

        datasets = _load_dicom_files(temp_dir)
        assert len(datasets) == 1

    def test_skips_json_artifacts(self, sample_dicom_file, temp_dir):
        sample_dicom_file(filename="valid.dcm")
        with open(os.path.join(temp_dir, "metadata.json"), "w") as f:
            json.dump({"test": True}, f)

        datasets = _load_dicom_files(temp_dir)
        assert len(datasets) == 1

    def test_returns_empty_for_empty_directory(self, temp_dir):
        datasets = _load_dicom_files(temp_dir)
        assert len(datasets) == 0

    def test_discovers_files_recursively(self, sample_dicom_dataset, temp_dir):
        # Create a subdirectory with DICOM files
        sub_dir = os.path.join(temp_dir, "subdir")
        os.makedirs(sub_dir)

        ds = sample_dicom_dataset()
        pydicom.dcmwrite(os.path.join(sub_dir, "nested.dcm"), ds)

        datasets = _load_dicom_files(temp_dir)
        assert len(datasets) == 1


class TestExtractMetadata:
    """Test metadata extraction from DICOM datasets."""

    def test_extracts_modality(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        meta = _extract_metadata(ds, 10)
        assert meta["modality"] == "CT"

    def test_extracts_dimensions(self, sample_dicom_dataset):
        ds = sample_dicom_dataset(rows=128, cols=256)
        meta = _extract_metadata(ds, 10)
        assert meta["rows"] == 128
        assert meta["columns"] == 256

    def test_extracts_pixel_spacing(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        meta = _extract_metadata(ds, 10)
        assert meta["pixelSpacing"] == [0.5, 0.5]

    def test_extracts_slice_count(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        meta = _extract_metadata(ds, 42)
        assert meta["sliceCount"] == 42

    def test_handles_missing_optional_fields(self):
        ds = pydicom.Dataset()
        ds.Modality = "CT"
        meta = _extract_metadata(ds, 1)
        assert meta["modality"] == "CT"
        assert meta["studyDescription"] == ""


class TestStackSlices:
    """Test 3D volume stacking from DICOM slices."""

    def test_stacks_correct_shape(self, sample_dicom_dataset):
        datasets = [
            sample_dicom_dataset(rows=64, cols=64, instance_number=i, z_position=float(i))
            for i in range(15)
        ]
        volume, spacing, origin = _stack_slices(datasets)
        assert volume.shape == (15, 64, 64)

    def test_sorts_by_z_position(self, sample_dicom_dataset):
        # Create slices in reverse order
        datasets = [
            sample_dicom_dataset(instance_number=i, z_position=float(14 - i))
            for i in range(15)
        ]
        volume, spacing, origin = _stack_slices(datasets)
        assert volume.shape[0] == 15

    def test_applies_rescale_slope_intercept(self, sample_dicom_dataset):
        ds = sample_dicom_dataset(rows=4, cols=4, instance_number=1)
        ds.RescaleSlope = 2.0
        ds.RescaleIntercept = -100.0

        volume, _, _ = _stack_slices([ds])
        # Pixel values should be transformed: val * 2.0 + (-100.0)
        assert volume.dtype == np.float32

    def test_calculates_spacing_from_positions(self, sample_dicom_dataset):
        datasets = [
            sample_dicom_dataset(instance_number=i, z_position=float(i) * 2.5)
            for i in range(15)
        ]
        volume, spacing, origin = _stack_slices(datasets)
        assert spacing[2] == pytest.approx(2.5, abs=0.01)

    def test_origin_from_first_slice(self, sample_dicom_dataset):
        datasets = [
            sample_dicom_dataset(instance_number=i, z_position=float(i) + 10.0)
            for i in range(15)
        ]
        volume, spacing, origin = _stack_slices(datasets)
        assert origin[2] == pytest.approx(10.0, abs=0.01)


class TestSaveVolumeData:
    """Test volume data serialization."""

    def test_saves_volume_binary(self, temp_dir, synthetic_volume):
        volume = synthetic_volume(shape=(10, 16, 16))
        _save_volume_data(temp_dir, volume, [1.0, 1.0, 1.0], [0.0, 0.0, 0.0])

        bin_path = os.path.join(temp_dir, "volume.bin")
        assert os.path.exists(bin_path)

        # Verify roundtrip
        loaded = np.fromfile(bin_path, dtype=np.float32).reshape(volume.shape)
        np.testing.assert_array_equal(loaded, volume)

    def test_saves_volume_info_json(self, temp_dir, synthetic_volume):
        volume = synthetic_volume(shape=(10, 16, 16))
        spacing = [0.5, 0.5, 1.0]
        origin = [1.0, 2.0, 3.0]
        _save_volume_data(temp_dir, volume, spacing, origin)

        info_path = os.path.join(temp_dir, "volume_info.json")
        assert os.path.exists(info_path)

        with open(info_path) as f:
            info = json.load(f)

        assert info["dimensions"] == [10, 16, 16]
        assert info["spacing"] == spacing
        assert info["origin"] == origin
        assert info["dataType"] == "Float32"


class TestExtractZips:
    """Test zip extraction."""

    def test_extracts_zip_contents(self, temp_dir, sample_dicom_dataset):
        import zipfile

        # Create a zip with a DICOM file
        ds = sample_dicom_dataset()
        dcm_path = os.path.join(temp_dir, "inner.dcm")
        pydicom.dcmwrite(dcm_path, ds)

        zip_path = os.path.join(temp_dir, "archive.zip")
        with zipfile.ZipFile(zip_path, "w") as zf:
            zf.write(dcm_path, "inner.dcm")

        os.remove(dcm_path)

        _extract_zips(temp_dir)

        # Zip should be removed, contents extracted
        assert not os.path.exists(zip_path)
        assert os.path.exists(os.path.join(temp_dir, "inner.dcm"))

    def test_handles_corrupt_zip(self, temp_dir):
        corrupt_path = os.path.join(temp_dir, "bad.zip")
        with open(corrupt_path, "wb") as f:
            f.write(b"not a zip file")

        _extract_zips(temp_dir)  # Should not raise


class TestMinSlicesConstant:
    """Verify the min slices threshold is reasonable."""

    def test_min_slices_is_at_least_5(self):
        assert MIN_SLICES_FOR_3D >= 5

    def test_min_slices_is_at_most_20(self):
        assert MIN_SLICES_FOR_3D <= 20
