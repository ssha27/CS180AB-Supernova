# DICOM Pipeline (De-identified)

This pipeline ingests:
- a single DICOM file (single-frame or multi-frame), OR
- a folder containing DICOM files (multiple series)

Outputs per detected series:
- image.npy      : (1, D, H, W) float32 normalized (ML-ready)
- preview.png    : middle-slice sanity check
- meta.json      : safe metadata only (NO PHI, NO raw UIDs)
- deid_report.json : reports which sensitive fields were detected/excluded (values never written)

## Install
pip install -r requirements.txt

## Run
export DICOM_DEID_SALT="a-long-private-random-string"
python run_ingest.py --input /path/to/dicom_or_folder --output out
python run_ingest.py --input /path/to/folder --output out --all_series