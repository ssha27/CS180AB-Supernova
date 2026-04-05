"""
Tests for DICOM PII anonymization.
"""

import pydicom
import pytest

from app.anonymize import strip_pii, is_anonymized, PII_TAGS


class TestStripPII:
    """Test that strip_pii removes all patient-identifiable information."""

    def test_removes_patient_name(self, sample_dicom_dataset):
        ds = sample_dicom_dataset(patient_name="DOE^JOHN")
        assert ds.PatientName == "DOE^JOHN"

        strip_pii(ds)
        assert not hasattr(ds, "PatientName")

    def test_removes_patient_id(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        assert ds.PatientID == "TEST-001"

        strip_pii(ds)
        assert not hasattr(ds, "PatientID")

    def test_removes_patient_birth_date(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        assert ds.PatientBirthDate == "19900101"

        strip_pii(ds)
        assert not hasattr(ds, "PatientBirthDate")

    def test_removes_institution_name(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        assert ds.InstitutionName == "Test Hospital"

        strip_pii(ds)
        assert not hasattr(ds, "InstitutionName")

    def test_removes_referring_physician(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        assert ds.ReferringPhysicianName == "SMITH^DR"

        strip_pii(ds)
        assert not hasattr(ds, "ReferringPhysicianName")

    def test_preserves_modality(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        strip_pii(ds)
        assert ds.Modality == "CT"

    def test_preserves_pixel_spacing(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        strip_pii(ds)
        assert list(ds.PixelSpacing) == [0.5, 0.5]

    def test_preserves_image_position(self, sample_dicom_dataset):
        ds = sample_dicom_dataset(z_position=42.5)
        strip_pii(ds)
        assert float(ds.ImagePositionPatient[2]) == 42.5

    def test_preserves_pixel_data(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        original_pixels = ds.PixelData
        strip_pii(ds)
        assert ds.PixelData == original_pixels

    def test_preserves_rescale_values(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        strip_pii(ds)
        assert ds.RescaleSlope == 1.0
        assert ds.RescaleIntercept == -1024.0

    def test_all_pii_tags_removed(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        strip_pii(ds)

        for tag in PII_TAGS:
            assert not hasattr(ds, tag), f"PII tag '{tag}' was not removed"

    def test_returns_same_dataset(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        result = strip_pii(ds)
        assert result is ds

    def test_handles_missing_pii_tags_gracefully(self):
        """strip_pii should not crash if PII tags are already absent."""
        ds = pydicom.Dataset()
        ds.Modality = "MR"
        strip_pii(ds)  # Should not raise
        assert ds.Modality == "MR"


class TestIsAnonymized:
    """Test the anonymization check function."""

    def test_non_anonymized_dataset(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        assert is_anonymized(ds) is False

    def test_anonymized_dataset(self, sample_dicom_dataset):
        ds = sample_dicom_dataset()
        strip_pii(ds)
        assert is_anonymized(ds) is True

    def test_empty_dataset_is_anonymized(self):
        ds = pydicom.Dataset()
        assert is_anonymized(ds) is True
