const API_BASE = '/api'

/**
 * Upload DICOM files to the server.
 * Supports chunked upload progress tracking.
 *
 * @param {File[]} files - Array of .dcm or .zip files
 * @param {function} onProgress - Callback with progress (0-100)
 * @returns {Promise<{jobId: string}>}
 */
export async function uploadFiles(files, onProgress) {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/upload`)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.round((e.loaded / e.total) * 100)
        onProgress(pct)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Invalid response from server'))
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          reject(new Error(err.error || `Upload failed (${xhr.status})`))
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`))
        }
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

    xhr.send(formData)
  })
}

/**
 * Poll processing status for a given job.
 *
 * @param {string} jobId
 * @returns {Promise<{status: string, progress: number, result?: object}>}
 */
export async function getJobStatus(jobId) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`)
  if (!res.ok) {
    throw new Error(`Failed to get job status (${res.status})`)
  }
  return res.json()
}

/**
 * Fetch the processed volume data for rendering.
 *
 * @param {string} jobId
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchVolumeData(jobId) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/volume`)
  if (!res.ok) {
    throw new Error(`Failed to fetch volume data (${res.status})`)
  }
  return res.arrayBuffer()
}

/**
 * Fetch volume reconstruction info (dimensions, spacing, origin).
 *
 * @param {string} jobId
 * @returns {Promise<{dimensions: number[], spacing: number[], origin: number[], dataType: string, min: number, max: number}>}
 */
export async function fetchVolumeInfo(jobId) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/volume-info`)
  if (!res.ok) {
    throw new Error(`Failed to fetch volume info (${res.status})`)
  }
  return res.json()
}

/**
 * Fetch the processed surface mesh data for rendering.
 *
 * @param {string} jobId
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchSurfaceData(jobId) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/surface`)
  if (!res.ok) {
    throw new Error(`Failed to fetch surface data (${res.status})`)
  }
  return res.arrayBuffer()
}

/**
 * Fetch DICOM metadata for a job.
 *
 * @param {string} jobId
 * @returns {Promise<object>}
 */
export async function fetchMetadata(jobId) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/metadata`)
  if (!res.ok) {
    throw new Error(`Failed to fetch metadata (${res.status})`)
  }
  return res.json()
}
