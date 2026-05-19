"""Tests for volume export module."""
import os
import json
import tempfile
import pytest
import numpy as np
import nibabel as nib

from app.volume_export import (
    align_segmentation_to_volume_grid,
    build_volume_affine,
    downsample_volume,
    export_segmentation_volume,
    export_volume_bundle,
    export_volume,
    DEFAULT_MAX_DIM,
    HIGH_QUALITY_MAX_DIM,
)


class TestDownsampleVolume:
    def test_no_downsample_if_already_small(self):
        vol = np.zeros((100, 100, 100), dtype=np.int16)
        result, scales = downsample_volume(vol, max_dim=256)
        assert result.shape == (100, 100, 100)
        assert scales == [1.0, 1.0, 1.0]

    def test_downsamples_large_volume(self):
        vol = np.random.randint(-1000, 1000, (512, 512, 300), dtype=np.int16)
        result, scales = downsample_volume(vol, max_dim=256)
        assert max(result.shape) <= 260  # Allow small rounding tolerance
        assert all(s < 1.0 for s in scales)

    def test_preserves_dtype(self):
        vol = np.ones((512, 512, 512), dtype=np.int16) * 100
        result, _ = downsample_volume(vol, max_dim=128)
        assert result.dtype == np.int16

    def test_scale_factors_are_correct(self):
        vol = np.zeros((512, 256, 256), dtype=np.int16)
        result, scales = downsample_volume(vol, max_dim=256)
        expected_scale = 256 / 512
        assert abs(scales[0] - expected_scale) < 0.01


class TestExportVolume:
    def test_build_volume_affine_uses_dicom_row_and_column_axes(self):
        metadata = {
            "spacing": [2.5, 0.7, 0.9],
            "origin": [10.0, 20.0, 30.0],
            "direction": {
                "slice": [0.0, 0.0, 1.0],
                "row": [1.0, 0.0, 0.0],
                "column": [0.0, 1.0, 0.0],
            },
        }

        affine = build_volume_affine(metadata)

        np.testing.assert_allclose(affine[:3, 0], [0.0, 0.0, 2.5])
        np.testing.assert_allclose(affine[:3, 1], [0.0, 0.7, 0.0])
        np.testing.assert_allclose(affine[:3, 2], [0.9, 0.0, 0.0])
        np.testing.assert_allclose(affine[:3, 3], [10.0, 20.0, 30.0])

    def test_exports_raw_and_metadata(self):
        vol = np.random.randint(-500, 500, (64, 64, 64), dtype=np.int16)
        metadata = {
            "dimensions": [64, 64, 64],
            "spacing": [1.0, 1.0, 1.0],
            "origin": [0.0, 0.0, 0.0],
            "dtype": "int16",
            "min_hu": -500,
            "max_hu": 500,
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = os.path.join(tmpdir, "volume")
            meta_path = export_volume(vol, metadata, out_dir)

            assert os.path.exists(meta_path)
            raw_path = os.path.join(out_dir, "volume.raw")
            assert os.path.exists(raw_path)

            # Verify metadata
            with open(meta_path) as f:
                meta = json.load(f)
            assert meta["file"] == "volume.raw"
            assert meta["dtype"] == "int16"
            assert len(meta["dimensions"]) == 3

    def test_raw_file_size_matches_dimensions(self):
        vol = np.ones((64, 64, 64), dtype=np.int16)
        metadata = {
            "dimensions": [64, 64, 64],
            "spacing": [1.0, 1.0, 1.0],
            "origin": [0.0, 0.0, 0.0],
            "dtype": "int16",
            "min_hu": 0,
            "max_hu": 1,
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = os.path.join(tmpdir, "volume")
            export_volume(vol, metadata, out_dir)

            raw_path = os.path.join(out_dir, "volume.raw")
            expected_size = 64 * 64 * 64 * 2  # int16 = 2 bytes
            assert os.path.getsize(raw_path) == expected_size

    def test_high_quality_flag(self):
        vol = np.zeros((64, 64, 64), dtype=np.int16)
        metadata = {
            "dimensions": [64, 64, 64],
            "spacing": [1.0, 1.0, 1.0],
            "origin": [0.0, 0.0, 0.0],
            "dtype": "int16",
            "min_hu": 0,
            "max_hu": 0,
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = os.path.join(tmpdir, "volume")
            meta_path = export_volume(vol, metadata, out_dir, high_quality=True)

            with open(meta_path) as f:
                meta = json.load(f)
            assert meta["high_quality"] is True


class TestSegmentationExport:
    def test_aligns_segmentation_when_affines_match(self):
        segmentation = np.zeros((4, 4, 4), dtype=np.uint16)
        segmentation[1, 2, 3] = 11

        affine = np.eye(4, dtype=np.float64)
        volume_affine_lps = np.array(
            [
                [-1.0, 0.0, 0.0, 0.0],
                [0.0, -1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
            dtype=np.float64,
        )
        aligned = align_segmentation_to_volume_grid(
            segmentation,
            affine,
            segmentation.shape,
            volume_affine_lps,
        )

        assert np.array_equal(aligned, segmentation)

    def test_aligns_segmentation_from_ras_affine_into_lps_volume_grid(self):
        segmentation = np.zeros((4, 5, 6), dtype=np.uint16)
        segmentation[1, 2, 3] = 7

        segmentation_affine_ras = np.array(
            [
                [-1.0, 0.0, 0.0, 0.0],
                [0.0, -1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
            dtype=np.float64,
        )
        volume_affine_lps = np.array(
            [
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
            dtype=np.float64,
        )

        aligned = align_segmentation_to_volume_grid(
            segmentation,
            segmentation_affine_ras,
            (6, 5, 4),
            volume_affine_lps,
        )

        assert aligned[3, 2, 1] == 7
        assert np.count_nonzero(aligned == 7) == 1

    def test_exports_segmentation_volume(self):
        segmentation = np.zeros((32, 24, 16), dtype=np.uint16)
        segmentation[5:10, 7:12, 2:8] = 5
        metadata = {
            "dimensions": [32, 24, 16],
            "spacing": [1.5, 1.0, 0.8],
            "origin": [0.0, 0.0, 0.0],
            "direction": {
                "slice": [1.0, 0.0, 0.0],
                "row": [0.0, 1.0, 0.0],
                "column": [0.0, 0.0, 1.0],
            },
            "affine": np.eye(4).tolist(),
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = os.path.join(tmpdir, "volume")
            meta_path = export_segmentation_volume(
                segmentation,
                metadata,
                out_dir,
                [1.0, 1.0, 1.0],
                high_quality=True,
            )

            assert os.path.exists(meta_path)
            raw_path = os.path.join(out_dir, "segmentation.raw")
            assert os.path.exists(raw_path)

            with open(meta_path) as f:
                meta = json.load(f)

            assert meta["file"] == "segmentation.raw"
            assert meta["dtype"] == "uint16"
            assert meta["high_quality"] is True
            assert meta["dimensions"] == [32, 24, 16]

    def test_export_volume_bundle_writes_ct_and_segmentation_assets(self):
        volume = np.random.randint(-400, 400, (20, 18, 16), dtype=np.int16)
        metadata = {
            "dimensions": [20, 18, 16],
            "spacing": [1.2, 0.9, 0.9],
            "origin": [0.0, 0.0, 0.0],
            "direction": {
                "slice": [1.0, 0.0, 0.0],
                "row": [0.0, 1.0, 0.0],
                "column": [0.0, 0.0, 1.0],
            },
            "affine": np.eye(4).tolist(),
            "dtype": "int16",
            "min_hu": int(volume.min()),
            "max_hu": int(volume.max()),
        }
        segmentation = np.zeros((20, 18, 16), dtype=np.uint16)
        segmentation[3:9, 4:11, 5:12] = 5

        with tempfile.TemporaryDirectory() as tmpdir:
            seg_path = os.path.join(tmpdir, "segmentation.nii.gz")
            nib.save(nib.Nifti1Image(segmentation.astype(np.uint16), np.eye(4)), seg_path)

            out_dir = os.path.join(tmpdir, "volume")
            bundle = export_volume_bundle(volume, metadata, seg_path, out_dir)

            assert bundle["intensity"]["file"] == "volume.raw"
            assert bundle["segmentation"]["file"] == "segmentation.raw"
            assert bundle["intensity"]["dimensions"] == bundle["segmentation"]["dimensions"]
            assert os.path.exists(os.path.join(out_dir, "volume.raw"))
            assert os.path.exists(os.path.join(out_dir, "segmentation.raw"))
