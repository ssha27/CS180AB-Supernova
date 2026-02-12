"""
DICOM PII anonymization module.

Strips all patient-identifiable metadata from DICOM datasets while preserving
imaging-relevant tags needed for 3D reconstruction.
"""

import pydicom

# DICOM tags containing PII that must be removed
PII_TAGS = [
    "PatientName",
    "PatientID",
    "PatientBirthDate",
    "PatientBirthTime",
    "PatientSex",
    "PatientAge",
    "PatientAddress",
    "PatientTelephoneNumbers",
    "PatientWeight",
    "PatientSize",
    "OtherPatientIDs",
    "OtherPatientNames",
    "EthnicGroup",
    "Occupation",
    "AdditionalPatientHistory",
    "PregnancyStatus",
    "PatientComments",
    # Referring physician / institution
    "ReferringPhysicianName",
    "ReferringPhysicianAddress",
    "ReferringPhysicianTelephoneNumbers",
    "InstitutionName",
    "InstitutionAddress",
    "InstitutionalDepartmentName",
    "StationName",
    "OperatorsName",
    "PerformingPhysicianName",
    "NameOfPhysiciansReadingStudy",
    "PhysiciansOfRecord",
    "RequestingPhysician",
    # Study / accession identifiers
    "AccessionNumber",
    "StudyID",
    "RequestedProcedureID",
    "ScheduledProcedureStepID",
    # Instance UIDs (re-identify risk)
    # Note: We keep SeriesInstanceUID and SOPInstanceUID for slice ordering,
    # but strip study-level identifiers
]

# Tags that we MUST keep for imaging
KEEP_TAGS = {
    "Modality",
    "Rows",
    "Columns",
    "BitsAllocated",
    "BitsStored",
    "HighBit",
    "PixelRepresentation",
    "SamplesPerPixel",
    "PhotometricInterpretation",
    "PixelSpacing",
    "SliceThickness",
    "SpacingBetweenSlices",
    "ImagePositionPatient",
    "ImageOrientationPatient",
    "InstanceNumber",
    "SliceLocation",
    "RescaleSlope",
    "RescaleIntercept",
    "WindowCenter",
    "WindowWidth",
    "PixelData",
    "NumberOfFrames",
    "SeriesInstanceUID",
    "SOPInstanceUID",
    "StudyDescription",
    "SeriesDescription",
    "TransferSyntaxUID",
}


def strip_pii(dataset: pydicom.Dataset) -> pydicom.Dataset:
    """
    Remove all PII tags from a DICOM dataset in-place.

    Args:
        dataset: A pydicom Dataset to anonymize.

    Returns:
        The same dataset with PII tags removed.
    """
    for tag_name in PII_TAGS:
        if hasattr(dataset, tag_name):
            try:
                delattr(dataset, tag_name)
            except Exception:
                pass  # Some tags may be read-only

    return dataset


def is_anonymized(dataset: pydicom.Dataset) -> bool:
    """
    Check whether a dataset has been anonymized (all PII tags removed).

    Args:
        dataset: A pydicom Dataset to check.

    Returns:
        True if no PII tags are present.
    """
    for tag_name in PII_TAGS:
        if hasattr(dataset, tag_name):
            val = getattr(dataset, tag_name, None)
            if val is not None and str(val).strip():
                return False
    return True
