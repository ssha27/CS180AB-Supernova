import fetch from 'node-fetch'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'

const DICOM_SERVICE_URL = process.env.DICOM_SERVICE_URL || 'http://localhost:5001'

// In-memory job status cache
const jobCache = new Map()

/**
 * Forward uploaded files to the Python DICOM processing service.
 */
export async function forwardToDicomService(jobId, jobDir) {
  try {
    const res = await fetch(`${DICOM_SERVICE_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        inputDir: jobDir,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`DICOM service error (${res.status}): ${body}`)
    }

    const result = await res.json()
    jobCache.set(jobId, {
      status: 'processing',
      progress: 0,
      startedAt: Date.now(),
    })

    return result
  } catch (err) {
    jobCache.set(jobId, {
      status: 'failed',
      error: err.message,
    })
    throw err
  }
}

/**
 * Get job status — first check local cache, then ask the DICOM service.
 */
export async function getJob(jobId) {
  try {
    const res = await fetch(`${DICOM_SERVICE_URL}/jobs/${jobId}`)

    if (res.status === 404) {
      const err = new Error('Job not found')
      err.status = 404
      throw err
    }

    if (!res.ok) {
      throw new Error(`DICOM service error (${res.status})`)
    }

    const status = await res.json()
    jobCache.set(jobId, status)
    return status
  } catch (err) {
    // Fall back to cache if service is unreachable
    if (jobCache.has(jobId)) {
      return jobCache.get(jobId)
    }
    throw err
  }
}
