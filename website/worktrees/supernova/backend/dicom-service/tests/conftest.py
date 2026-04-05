"""
Shared test fixtures for the DICOM processing service.
"""

import io
import os
import tempfile

import numpy as np
import pydicom
import pytest
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid


@pytest.fixture
def temp_dir():
    """Provide a temporary directory that is cleaned up after the test."""
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def sample_dicom_dataset():
    """
    Create a minimal valid DICOM dataset with pixel data.
    Includes PII fields to test anonymization.
    """
    def _make(
        rows=64,
        cols=64,
        instance_number=1,
        z_position=0.0,
        patient_name="DOE^JOHN",
    ):
        ds = Dataset()
        ds.file_meta = pydicom.dataset.FileMetaDataset()
        ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
        ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

        # Patient PII (should be stripped)
        ds.PatientName = patient_name
        ds.PatientID = "TEST-001"
        ds.PatientBirthDate = "19900101"
        ds.InstitutionName = "Test Hospital"
        ds.ReferringPhysicianName = "SMITH^DR"

        # Imaging metadata (should be kept)
        ds.Modality = "CT"
        ds.Rows = rows
        ds.Columns = cols
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 1
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.PixelSpacing = [0.5, 0.5]
        ds.SliceThickness = 1.0
        ds.ImagePositionPatient = [0.0, 0.0, z_position]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.InstanceNumber = instance_number
        ds.RescaleSlope = 1.0
        ds.RescaleIntercept = -1024.0

        # Generate synthetic pixel data
        np.random.seed(instance_number)
        pixel_data = np.random.randint(0, 4096, (rows, cols), dtype=np.int16)
        ds.PixelData = pixel_data.tobytes()

        return ds

    return _make


@pytest.fixture
def sample_dicom_file(sample_dicom_dataset, temp_dir):
    """Save a sample DICOM dataset to a file and return the path."""
    def _save(filename="test.dcm", **kwargs):
        ds = sample_dicom_dataset(**kwargs)
        filepath = os.path.join(temp_dir, filename)
        pydicom.dcmwrite(filepath, ds)
        return filepath, ds

    return _save


@pytest.fixture
def sample_dicom_series(sample_dicom_file):
    """Create a series of DICOM files (enough for 3D reconstruction)."""
    def _make(num_slices=15, rows=64, cols=64):
        paths = []
        datasets = []
        for i in range(num_slices):
            path, ds = sample_dicom_file(
                filename=f"slice_{i:04d}.dcm",
                instance_number=i + 1,
                z_position=float(i) * 1.0,
                rows=rows,
                cols=cols,
            )
            paths.append(path)
            datasets.append(ds)
        return paths, datasets

    return _make


@pytest.fixture
def synthetic_volume():
    """
    Create a synthetic 3D volume (sphere) for testing Marching Cubes
    without DICOM dependency.
    """
    def _make(shape=(32, 32, 32), radius=10, center=None):
        if center is None:
            center = [s // 2 for s in shape]

        z, y, x = np.ogrid[
            0:shape[0],
            0:shape[1],
            0:shape[2],
        ]
        dist = np.sqrt(
            (x - center[2]) ** 2 + (y - center[1]) ** 2 + (z - center[0]) ** 2
        )
        # Values inside sphere are high, outside are low
        volume = np.where(dist <= radius, 1000.0, -1000.0).astype(np.float32)
        return volume

    return _make
