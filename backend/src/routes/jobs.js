import { Router } from 'express'
import { getJob } from '../services/dicomProxy.js'
import path from 'path'
import fs from 'fs'

const router = Router()

function getUploadDir() {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
}

/**
 * GET /api/jobs/:jobId
 * Get processing status for a job.
 */
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const status = await getJob(req.params.jobId)
    res.json(status)
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: 'Job not found.' })
    }
    console.error('Failed to get job status:', err)
    res.status(502).json({ error: 'Failed to reach processing service.' })
  }
})

/**
 * GET /api/jobs/:jobId/volume
 * Fetch processed volume data (binary).
 */
router.get('/jobs/:jobId/volume', async (req, res) => {
  try {
    const volumePath = path.join(getUploadDir(), req.params.jobId, 'volume.bin')
    if (!fs.existsSync(volumePath)) {
      return res.status(404).json({ error: 'Volume data not found.' })
    }
    res.setHeader('Content-Type', 'application/octet-stream')
    fs.createReadStream(volumePath).pipe(res)
  } catch (err) {
    console.error('Failed to fetch volume data:', err)
    res.status(500).json({ error: 'Failed to fetch volume data.' })
  }
})

/**
 * GET /api/jobs/:jobId/surface
 * Fetch processed surface mesh data (binary).
 */
router.get('/jobs/:jobId/surface', async (req, res) => {
  try {
    const surfacePath = path.join(getUploadDir(), req.params.jobId, 'surface.vtp')
    if (!fs.existsSync(surfacePath)) {
      return res.status(404).json({ error: 'Surface data not found.' })
    }
    res.setHeader('Content-Type', 'application/octet-stream')
    fs.createReadStream(surfacePath).pipe(res)
  } catch (err) {
    console.error('Failed to fetch surface data:', err)
    res.status(500).json({ error: 'Failed to fetch surface data.' })
  }
})

/**
 * GET /api/jobs/:jobId/volume-info
 * Fetch volume reconstruction info (dimensions, spacing, origin).
 */
router.get('/jobs/:jobId/volume-info', async (req, res) => {
  try {
    const infoPath = path.join(getUploadDir(), req.params.jobId, 'volume_info.json')
    if (!fs.existsSync(infoPath)) {
      return res.status(404).json({ error: 'Volume info not found.' })
    }
    const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'))
    res.json(info)
  } catch (err) {
    console.error('Failed to fetch volume info:', err)
    res.status(500).json({ error: 'Failed to fetch volume info.' })
  }
})

/**
 * GET /api/jobs/:jobId/metadata
 * Fetch DICOM metadata (JSON).
 */
router.get('/jobs/:jobId/metadata', async (req, res) => {
  try {
    const metaPath = path.join(getUploadDir(), req.params.jobId, 'metadata.json')
    if (!fs.existsSync(metaPath)) {
      return res.status(404).json({ error: 'Metadata not found.' })
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    res.json(meta)
  } catch (err) {
    console.error('Failed to fetch metadata:', err)
    res.status(500).json({ error: 'Failed to fetch metadata.' })
  }
})

/**
 * GET /api/jobs/:jobId/segments
 * Fetch the organ segment manifest (JSON list of available structures).
 */
router.get('/jobs/:jobId/segments', async (req, res) => {
  try {
    const manifestPath = path.join(getUploadDir(), req.params.jobId, 'segments', 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: 'No segment data available.' })
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    res.json(manifest)
  } catch (err) {
    console.error('Failed to fetch segment manifest:', err)
    res.status(500).json({ error: 'Failed to fetch segment manifest.' })
  }
})

/**
 * GET /api/jobs/:jobId/segments/:structureName
 * Stream a per-organ .vtp mesh file.
 */
router.get('/jobs/:jobId/segments/:structureName', async (req, res) => {
  try {
    const vtpPath = path.join(
      getUploadDir(), req.params.jobId, 'segments', `${req.params.structureName}.vtp`
    )
    if (!fs.existsSync(vtpPath)) {
      return res.status(404).json({ error: `Segment '${req.params.structureName}' not found.` })
    }
    res.setHeader('Content-Type', 'application/octet-stream')
    fs.createReadStream(vtpPath).pipe(res)
  } catch (err) {
    console.error('Failed to fetch segment mesh:', err)
    res.status(500).json({ error: 'Failed to fetch segment mesh.' })
  }
})

export { router as jobsRouter }
