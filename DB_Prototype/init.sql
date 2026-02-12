CREATE TABLE IF NOT EXISTS dicom_instances (
  id SERIAL PRIMARY KEY,

  -- store dicom uids
  study_instance_uid TEXT,
  series_instance_uid TEXT,
  sop_instance_uid TEXT UNIQUE,

  -- stores a few metadata values
  patient_id TEXT, -- id
  modality TEXT, -- type of scan
  study_date TEXT, -- date

  -- uses metadata to index mongo
  mongo_file_id TEXT NOT NULL,

  -- more metadata upon creationg
  filename TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_uid ON dicom_instances(study_instance_uid);
CREATE INDEX IF NOT EXISTS idx_series_uid ON dicom_instances(series_instance_uid);
CREATE INDEX IF NOT EXISTS idx_patient_id ON dicom_instances(patient_id);