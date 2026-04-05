CREATE TABLE IF NOT EXISTS dicom_instances (
  id SERIAL PRIMARY KEY,

  -- -- store dicom uids
  -- study_instance_uid TEXT,
  -- series_instance_uid TEXT,
  -- sop_instance_uid TEXT UNIQUE,

  -- -- stores a few metadata values
  -- patient_id TEXT, -- id
  -- modality TEXT, -- type of scan
  -- study_date TEXT, -- date

-- require the main dicom variables
  ALTER TABLE dicom_instances
    ALTER COLUMN study_instance_uid SET NOT NULL,
    ALTER COLUMN series_instance_uid SET NOT NULL,
    ALTER COLUMN sop_instance_uid SET NOT NULL;

-- converting the study_date to an actual date type
  ALTER TABLE dicom_instances
    ALTER COLUMN study_date TYPE DATE
    USING CASE
      WHEN study_date IS NOT NULL
      AND study_date ~ '^\d{8}$'
        THEN to_date(study_date, 'YYYYMMDD')
      ELSE NULL
    END;

  ALTER TABLE dicom_instances
    ADD COLUMN IF NOT EXISTS upload_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS byte_length BIGINT,
    ADD COLUMN IF NOT EXISTS sha256 TEXT;

  -- uses metadata to index mongo
  mongo_file_id TEXT NOT NULL,

  -- more metadata upon creationg
  filename TEXT,
  created_at TIMESTAMP DEFAULT NOW()

  -- DO $$
  -- BEGIN
  --   IF NOT EXISTS (
  --     SELECT 1
  --     FROM pg_constraint
  --     WHERE conname = 'dicom_instances_mongo_file_id_objectid_chk'
  --   ) THEN
  --     ALTER TABLE dicom_instances
  --       ADD CONSTRAINT dicom_instances_mongo_file_id_objectid_chk
  --       CHECK (mongo_file_id ~ '^[0-9a-fA-F]{24}$');
  --   END IF;
  -- END $$;

);

CREATE INDEX IF NOT EXISTS idx_study_uid ON dicom_instances(study_instance_uid);
CREATE INDEX IF NOT EXISTS idx_series_uid ON dicom_instances(series_instance_uid);
CREATE INDEX IF NOT EXISTS idx_patient_id ON dicom_instances(patient_id);