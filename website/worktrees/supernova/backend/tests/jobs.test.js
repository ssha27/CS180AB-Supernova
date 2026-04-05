import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import path from 'path'
import fs from 'fs'
import os from 'os'

const { jobsRouter } = await import('../src/routes/jobs.js')

// Mock the dicom proxy
vi.mock('../src/services/dicomProxy.js', () => ({
  getJob: vi.fn(),
}))

const { getJob } = await import('../src/services/dicomProxy.js')

function createTestApp() {
  const app = express()
  app.use(express.json())

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supernova-test-'))
  process.env.UPLOAD_DIR = tmpDir

  app.use('/api', jobsRouter)
  return { app, tmpDir }
}

describe('GET /api/jobs/:jobId', () => {
  let app, tmpDir

  beforeEach(() => {
    vi.clearAllMocks()
    const setup = createTestApp()
    app = setup.app
    tmpDir = setup.tmpDir
  })

  it('returns job status for a processing job', async () => {
    getJob.mockResolvedValue({ status: 'processing', progress: 45 })

    const res = await request(app).get('/api/jobs/test-job-1')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('processing')
    expect(res.body.progress).toBe(45)
  })

  it('returns 404 for unknown job', async () => {
    const err = new Error('Job not found')
    err.status = 404
    getJob.mockRejectedValue(err)

    const res = await request(app).get('/api/jobs/nonexistent')
    expect(res.status).toBe(404)
  })

  it('returns completed job with result', async () => {
    getJob.mockResolvedValue({
      status: 'completed',
      progress: 100,
      result: { totalSlices: 50 },
    })

    const res = await request(app).get('/api/jobs/done-job')
    expect(res.status).toBe(200)
    expect(res.body.result.totalSlices).toBe(50)
  })
})

describe('GET /api/jobs/:jobId/metadata', () => {
  let app, tmpDir

  beforeEach(() => {
    const setup = createTestApp()
    app = setup.app
    tmpDir = setup.tmpDir
  })

  it('returns 404 when metadata file does not exist', async () => {
    const res = await request(app).get('/api/jobs/no-such-job/metadata')
    expect(res.status).toBe(404)
  })

  it('returns metadata when file exists', async () => {
    const jobDir = path.join(tmpDir, 'meta-job')
    fs.mkdirSync(jobDir, { recursive: true })
    fs.writeFileSync(
      path.join(jobDir, 'metadata.json'),
      JSON.stringify({ modality: 'CT', rows: 512 })
    )

    const res = await request(app).get('/api/jobs/meta-job/metadata')
    expect(res.status).toBe(200)
    expect(res.body.modality).toBe('CT')
    expect(res.body.rows).toBe(512)
  })
})
