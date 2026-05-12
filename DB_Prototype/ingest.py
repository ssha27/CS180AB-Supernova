# going to use MongoDB GridFS
    # divides larger files into smaller chunks because MongoDB has a cap

import os
import hashlib
from datetime import datetime
import sys

import pydicom
from pymongo import MongoClient
import gridfs
from bson import ObjectId

import psycopg2

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
PG_DSN = os.getenv("PG_DSN", "dbname=dicom_meta user=dicom password=dicom host=localhost port=5432")

# reads file in 1 MB chunks and computes SHA-256
    # SHA-256: cryptographic hash function -> converts any size data into 256 bit unique hash
    # high level security hash function
# chunk reading because a huge DICOM file reading all into memory is tm
def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

# DICOM date format: YYYYMMDD
# SQL date format: YYYY-MM-DD
def dicom_date_to_sql_date(d: str):
    # DICOM DA is YYYYMMDD
    if not d or len(d) != 8 or not d.isdigit():
        return None
    return f"{d[0:4]}-{d[4:6]}-{d[6:8]}"

def ingest_one(path: str):

    # ds = parsed DICOM dataset
    ds = pydicom.dcmread(path, stop_before_pixels=False)

    # extracting the key identifiers
    study_uid = str(getattr(ds, "StudyInstanceUID", "")).strip()
    series_uid = str(getattr(ds, "SeriesInstanceUID", "")).strip()
    sop_uid = str(getattr(ds, "SOPInstanceUID", "")).strip()

    # extract the optional info
    patient_id = str(getattr(ds, "PatientID", "")).strip()
    modality = str(getattr(ds, "Modality", "")).strip()
    study_date_raw = str(getattr(ds, "StudyDate", "")).strip()
    study_date_sql = dicom_date_to_sql_date(study_date_raw)

    # if missing the required identifiers for SQL -> error
    if not (study_uid and series_uid and sop_uid):
        raise ValueError("Missing required DICOM UIDs (Study/Series/SOP).")

    # getting file size and hash
    size_bytes = os.path.getsize(path)
    digest = sha256_file(path)

    # setting up GridFS
    # GridFS bucket named "dicom"; contains:
        # dicom.files
        #dicom.chunks
    mongo = MongoClient(MONGO_URI)
    mdb = mongo["dicom"]
    bucket = gridfs.GridFSBucket(mdb, bucket_name="dicom")
    file_id = ObjectId()

    # reads file bytes in 1 MB and write into GridFS
    # GridFS will break into smaller chunks and store them
    try:
        with open(path, "rb") as f:
            with bucket.open_upload_stream_with_id(
                file_id,
                filename=os.path.basename(path),
                metadata={
                    "study_instance_uid": study_uid,
                    "series_instance_uid": series_uid,
                    "sop_instance_uid": sop_uid,
                    "sha256": digest,
                    "byte_length": size_bytes,
                },
            ) as up:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    up.write(chunk)
    except Exception:
        # if upload fails, nothing to clean in SQL
        raise

    # creating SQL connection
    # inserting metadata into SQL
    pg = psycopg2.connect(PG_DSN)
    try:
        with pg:
            with pg.cursor() as cur:
                # executing SQL queries
                cur.execute(
                    """
                    INSERT INTO dicom_instances
                    (study_instance_uid, series_instance_uid, sop_instance_uid,
                    patient_id, modality, study_date,
                    mongo_file_id, filename, created_at,
                    byte_length, sha256, upload_status)
                    VALUES
                    (%s,%s,%s,%s,%s,%s,%s,%s,NOW(),%s,%s,%s)
                    ON CONFLICT (sop_instance_uid)
                    DO UPDATE SET
                    study_instance_uid = EXCLUDED.study_instance_uid,
                    series_instance_uid = EXCLUDED.series_instance_uid,
                    patient_id = EXCLUDED.patient_id,
                    modality = EXCLUDED.modality,
                    study_date = EXCLUDED.study_date,
                    mongo_file_id = EXCLUDED.mongo_file_id,
                    filename = EXCLUDED.filename,
                    byte_length = EXCLUDED.byte_length,
                    sha256 = EXCLUDED.sha256,
                    upload_status = EXCLUDED.upload_status
                    ;
                    """,
                    (study_uid, series_uid, sop_uid,
                    patient_id, modality, study_date_sql,
                    str(file_id), os.path.basename(path),
                    size_bytes, digest, "complete")
                )
    # IF SQL INSERT FAILS, DELETE GRIDFS FILE
    except Exception as e:
        # cleanup GridFS blob to avoid orphaned file
        try:
            bucket.delete(file_id)
        except Exception:
            pass
        raise e
    finally:
        pg.close()
        mongo.close()

    return str(file_id)

if __name__ == "__main__":

    if len(sys.argv) < 2:
        print("Usage: python ingest.py path/to/file.dcm", file=sys.stderr)
        raise SystemExit(2)
    file_path = sys.argv[1]
    fid = ingest_one(file_path)
    print("Stored GridFS file_id:", fid)

    # python ingest.py path/to/file.dcm
