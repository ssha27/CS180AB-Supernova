import { Router } from 'express'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import fetch from 'node-fetch'
import { forwardToDicomService } from '../services/dicomProxy.js'

const DICOM_SERVICE_URL = process.env.DICOM_SERVICE_URL || 'http://localhost:5001'

const router = Router()

// Configure multer for file uploads
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024 // 5 GB

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobId = req.jobId || uuidv4()
    req.jobId = jobId
    const jobDir = path.join(UPLOAD_DIR, jobId)
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true })
    }
    cb(null, jobDir)
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname)
  },
})

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  if (ext === '.dcm' || ext === '.zip') {
    cb(null, true)
  } else {
    cb(new Error(`Invalid file type: ${ext}. Only .dcm and .zip are accepted.`), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
})

/**
 * POST /api/upload
 * Accept DICOM file(s) or zip archives, forward to Python processing service.
 */
router.post('/upload', (req, res, next) => {
  upload.array('files', 500)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File size exceeds the 5 GB limit.' })
      }
      return res.status(400).json({ error: err.message })
    }
    if (err) {
      return res.status(400).json({ error: err.message })
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' })
    }

    // Forward to DICOM processing service + ingest to database
    const jobId = req.jobId
    const jobDir = path.join(UPLOAD_DIR, jobId)

    forwardToDicomService(jobId, jobDir)
      .then(() => {
        // Also ingest to database (fire-and-forget, don't block response)
        fetch(`${DICOM_SERVICE_URL}/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobDir }),
        }).catch((err) => {
          console.error('DB ingestion request failed (non-fatal):', err.message)
        })

        res.status(202).json({ jobId })
      })
      .catch((error) => {
        console.error('Failed to forward to DICOM service:', error)
        res.status(502).json({ error: 'DICOM processing service unavailable.' })
      })
  })
})

export { router as uploadRouter }
