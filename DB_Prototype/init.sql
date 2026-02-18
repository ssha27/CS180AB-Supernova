CREATE TABLE IF NOT EXISTS dicom_instances (
  id SERIAL PRIMARY KEY,

  -- required columns
  study_instance_uid TEXT NOT NULL,
  series_instance_uid TEXT NOT NULL,
  sop_instance_uid TEXT NOT NULL UNIQUE,

  -- defined columns to match ingest.py
  patient_id TEXT,
  modality TEXT,
  study_date DATE,

  -- uses metadata to index mongo
  mongo_file_id TEXT NOT NULL,

  -- more metadata
  upload_status TEXT NOT NULL DEFAULT 'pending',
  byte_length BIGINT,
  sha256 TEXT,
  filename TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);


ALTER TABLE dicom_instances
  ADD COLUMN IF NOT EXISTS upload_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE dicom_instances
  ADD COLUMN IF NOT EXISTS byte_length BIGINT;

ALTER TABLE dicom_instances
  ADD COLUMN IF NOT EXISTS sha256 TEXT;

ALTER TABLE dicom_instances
  ADD COLUMN IF NOT EXISTS filename TEXT;

ALTER TABLE dicom_instances
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

ALTER TABLE dicom_instances
  ALTER COLUMN study_instance_uid SET NOT NULL;

ALTER TABLE dicom_instances
  ALTER COLUMN series_instance_uid SET NOT NULL;

ALTER TABLE dicom_instances
  ALTER COLUMN sop_instance_uid SET NOT NULL;

ALTER TABLE dicom_instances
  ALTER COLUMN mongo_file_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_study_uid ON dicom_instances(study_instance_uid);
CREATE INDEX IF NOT EXISTS idx_series_uid ON dicom_instances(series_instance_uid);
CREATE INDEX IF NOT EXISTS idx_patient_id ON dicom_instances(patient_id);

CREATE INDEX IF NOT EXISTS idx_sop_uid ON dicom_instances(sop_instance_uid);
CREATE INDEX IF NOT EXISTS idx_sha256 ON dicom_instances(sha256);
