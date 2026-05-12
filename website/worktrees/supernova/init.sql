CREATE TABLE IF NOT EXISTS dicom_instances (
  id                   SERIAL PRIMARY KEY,
  study_instance_uid   TEXT NOT NULL,
  series_instance_uid  TEXT NOT NULL,
  sop_instance_uid     TEXT NOT NULL UNIQUE,
  patient_id           TEXT,
  modality             TEXT,
  study_date           DATE,
  mongo_file_id        TEXT NOT NULL,
  filename             TEXT,
  byte_length          BIGINT,
  sha256               TEXT,
  upload_status        TEXT NOT NULL DEFAULT 'pending',
  created_at           TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_uid  ON dicom_instances(study_instance_uid);
CREATE INDEX IF NOT EXISTS idx_series_uid ON dicom_instances(series_instance_uid);
CREATE INDEX IF NOT EXISTS idx_patient_id ON dicom_instances(patient_id);
