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

/**
 * Fetch the organ segment manifest for a job.
 * Returns an array of available structures with names, colors, and file info.
 *
 * @param {string} jobId
 * @returns {Promise<Array<{name: string, displayName: string, color: number[], file: string, fileSize: number}>>}
 */
export async function fetchSegmentManifest(jobId) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/segments`)
  if (!res.ok) {
    throw new Error(`Failed to fetch segment manifest (${res.status})`)
  }
  return res.json()
}

/**
 * Fetch a per-organ .vtp mesh for a specific structure.
 *
 * @param {string} jobId
 * @param {string} structureName - The structure identifier (e.g., "heart", "liver")
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchSegmentMesh(jobId, structureName) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/segments/${structureName}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch segment mesh for ${structureName} (${res.status})`)
  }
  return res.arrayBuffer()
}

// --- Study browsing ---

export async function fetchStudies(filters = {}) {
  const params = new URLSearchParams()
  if (filters.patient_id) params.set('patient_id', filters.patient_id)
  if (filters.modality) params.set('modality', filters.modality)
  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)

  const qs = params.toString()
  const res = await fetch(`${API_BASE}/studies${qs ? '?' + qs : ''}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch studies (${res.status})`)
  }
  return res.json()
}

export async function fetchStudySeries(studyUid) {
  const res = await fetch(`${API_BASE}/studies/${encodeURIComponent(studyUid)}/series`)
  if (!res.ok) {
    throw new Error(`Failed to fetch series (${res.status})`)
  }
  return res.json()
}

export async function viewSeries(studyUid, seriesUid) {
  const res = await fetch(
    `${API_BASE}/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(seriesUid)}/view`,
    { method: 'POST' },
  )
  if (!res.ok) {
    throw new Error(`Failed to start viewer (${res.status})`)
  }
  return res.json()
}
