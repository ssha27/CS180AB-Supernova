import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import path from 'path'
import fs from 'fs'
import os from 'os'

// Build a minimal test app with just the upload route
const { uploadRouter } = await import('../src/routes/upload.js')

// Mock the dicom proxy to avoid needing the Python service
vi.mock('../src/services/dicomProxy.js', () => ({
  forwardToDicomService: vi.fn().mockResolvedValue({ status: 'accepted' }),
}))

function createTestApp() {
  const app = express()
  app.use(express.json())

  // Override UPLOAD_DIR to a temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supernova-test-'))
  process.env.UPLOAD_DIR = tmpDir

  app.use('/api', uploadRouter)
  return { app, tmpDir }
}

describe('POST /api/upload', () => {
  let app, tmpDir

  beforeEach(() => {
    const setup = createTestApp()
    app = setup.app
    tmpDir = setup.tmpDir
  })

  it('returns 400 when no files are uploaded', async () => {
    const res = await request(app).post('/api/upload')
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('No files')
  })

  it('accepts a .dcm file and returns a jobId', async () => {
    // Create a small fake .dcm file
    const fakeFile = Buffer.alloc(128, 0)

    const res = await request(app)
      .post('/api/upload')
      .attach('files', fakeFile, 'scan.dcm')

    expect(res.status).toBe(202)
    expect(res.body.jobId).toBeDefined()
    expect(typeof res.body.jobId).toBe('string')
  })

  it('accepts a .zip file', async () => {
    const fakeZip = Buffer.alloc(128, 0)

    const res = await request(app)
      .post('/api/upload')
      .attach('files', fakeZip, 'scans.zip')

    expect(res.status).toBe(202)
    expect(res.body.jobId).toBeDefined()
  })

  it('rejects non-.dcm/.zip files', async () => {
    const fakeFile = Buffer.from('hello')

    const res = await request(app)
      .post('/api/upload')
      .attach('files', fakeFile, 'photo.jpg')

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Invalid file type')
  })

  it('accepts multiple .dcm files', async () => {
    const file1 = Buffer.alloc(64, 0)
    const file2 = Buffer.alloc(64, 0)

    const res = await request(app)
      .post('/api/upload')
      .attach('files', file1, 'slice_001.dcm')
      .attach('files', file2, 'slice_002.dcm')

    expect(res.status).toBe(202)
    expect(res.body.jobId).toBeDefined()
  })
})
