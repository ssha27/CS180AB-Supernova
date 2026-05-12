"""
Database layer for DICOM storage.

Handles ingestion (DICOM → GridFS + PostgreSQL) and retrieval
(GridFS → local files for processing).
"""

import hashlib
import os

import pydicom
import psycopg2
from pymongo import MongoClient
from gridfs import GridFSBucket
from bson import ObjectId

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
PG_DSN = os.getenv("PG_DSN", "dbname=dicom_meta user=dicom password=dicom host=localhost port=5432")


def _get_mongo_bucket():
    client = MongoClient(MONGO_URI)
    db = client["dicom"]
    return client, GridFSBucket(db, bucket_name="dicom")


def _get_pg_connection():
    return psycopg2.connect(PG_DSN)


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _dicom_date_to_sql_date(d: str):
    if not d or len(d) != 8 or not d.isdigit():
        return None
    return f"{d[0:4]}-{d[4:6]}-{d[6:8]}"


def ingest_dicom_to_db(file_path: str) -> str:
    """
    Ingest a single DICOM file into GridFS + PostgreSQL.

    Returns the mongo_file_id as a string.
    """
    ds = pydicom.dcmread(file_path, stop_before_pixels=False)

    study_uid = str(getattr(ds, "StudyInstanceUID", "")).strip()
    series_uid = str(getattr(ds, "SeriesInstanceUID", "")).strip()
    sop_uid = str(getattr(ds, "SOPInstanceUID", "")).strip()

    patient_id = str(getattr(ds, "PatientID", "")).strip()
    modality = str(getattr(ds, "Modality", "")).strip()
    study_date_raw = str(getattr(ds, "StudyDate", "")).strip()
    study_date_sql = _dicom_date_to_sql_date(study_date_raw)

    if not (study_uid and series_uid and sop_uid):
        raise ValueError(f"Missing required DICOM UIDs in {file_path}")

    size_bytes = os.path.getsize(file_path)
    digest = _sha256_file(file_path)

    mongo_client, bucket = _get_mongo_bucket()
    file_id = ObjectId()

    try:
        with open(file_path, "rb") as f:
            with bucket.open_upload_stream_with_id(
                file_id,
                filename=os.path.basename(file_path),
                metadata={
                    "study_instance_uid": study_uid,
                    "series_instance_uid": series_uid,
                    "sop_instance_uid": sop_uid,
                    "sha256": digest,
                },
            ) as up:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    up.write(chunk)
    except Exception:
        mongo_client.close()
        raise

    pg = _get_pg_connection()
    try:
        with pg:
            with pg.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO dicom_instances
                      (study_instance_uid, series_instance_uid, sop_instance_uid,
                       patient_id, modality, study_date,
                       mongo_file_id, filename, byte_length, sha256,
                       upload_status, created_at)
                    VALUES
                      (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'completed',NOW())
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
                      upload_status = 'completed';
                    """,
                    (study_uid, series_uid, sop_uid,
                     patient_id, modality, study_date_sql,
                     str(file_id), os.path.basename(file_path),
                     size_bytes, digest),
                )
    except Exception as e:
        try:
            bucket.delete(file_id)
        except Exception:
            pass
        raise e
    finally:
        pg.close()
        mongo_client.close()

    return str(file_id)


def load_series_from_db(study_uid: str, series_uid: str, output_dir: str) -> int:
    """
    Retrieve all DICOM files for a series from GridFS and write them to output_dir.

    Returns the number of files written.
    """
    pg = _get_pg_connection()
    try:
        with pg.cursor() as cur:
            cur.execute(
                """
                SELECT mongo_file_id, filename
                FROM dicom_instances
                WHERE study_instance_uid = %s AND series_instance_uid = %s
                ORDER BY id
                """,
                (study_uid, series_uid),
            )
            rows = cur.fetchall()
    finally:
        pg.close()

    if not rows:
        return 0

    os.makedirs(output_dir, exist_ok=True)

    mongo_client, bucket = _get_mongo_bucket()
    count = 0
    try:
        for mongo_file_id_str, filename in rows:
            file_id = ObjectId(mongo_file_id_str)
            out_path = os.path.join(output_dir, filename or f"{mongo_file_id_str}.dcm")
            with open(out_path, "wb") as f:
                bucket.download_to_stream(file_id, f)
            count += 1
    finally:
        mongo_client.close()

    return count
