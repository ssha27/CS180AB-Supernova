import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { useAppStore, validateFiles, UPLOAD_STATES } from '../store/appStore'
import { uploadFiles, getJobStatus } from '../services/api'
import './UploadScreen.css'

const POLL_INTERVAL = 1500 // ms

export default function UploadScreen() {
  const navigate = useNavigate()
  const {
    uploadState,
    uploadProgress,
    processingProgress,
    errorMessage,
    setUploadState,
    setUploadProgress,
    setProcessingProgress,
    setFiles,
    setJobId,
    setError,
    reset,
  } = useAppStore()

  const pollJobStatus = useCallback(
    async (jobId) => {
      try {
        const status = await getJobStatus(jobId)

        if (status.status === 'completed') {
          // Navigate to the viewer — it will handle loading the data
          navigate(`/viewer/${jobId}`)
          return
        }

        if (status.status === 'failed') {
          setError(status.error || 'Processing failed')
          return
        }

        // Still processing
        if (status.progress) {
          setProcessingProgress(status.progress)
        }

        // Continue polling
        setTimeout(() => pollJobStatus(jobId), POLL_INTERVAL)
      } catch (err) {
        setError(err.message)
      }
    },
    [navigate, setError, setProcessingProgress]
  )

  const handleUpload = useCallback(
    async (acceptedFiles) => {
      const validation = validateFiles(acceptedFiles)
      if (!validation.valid) {
        setError(validation.errors.join('\n'))
        return
      }

      setFiles(acceptedFiles)
      setUploadState(UPLOAD_STATES.UPLOADING)
      setUploadProgress(0)

      try {
        const result = await uploadFiles(acceptedFiles, (progress) => {
          setUploadProgress(progress)
        })

        setJobId(result.jobId)
        setUploadState(UPLOAD_STATES.PROCESSING)
        setProcessingProgress(0)

        // Start polling for processing status
        pollJobStatus(result.jobId)
      } catch (err) {
        setError(err.message)
      }
    },
    [setFiles, setUploadState, setUploadProgress, setJobId, setError, setProcessingProgress, pollJobStatus]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleUpload,
    accept: {
      'application/dicom': ['.dcm'],
      'application/zip': ['.zip'],
    },
    disabled: uploadState === UPLOAD_STATES.UPLOADING || uploadState === UPLOAD_STATES.PROCESSING,
  })

  // Processing screen
  if (uploadState === UPLOAD_STATES.UPLOADING || uploadState === UPLOAD_STATES.PROCESSING) {
    return (
      <div className="upload-screen">
        <div className="processing-container">
          <div className="processing-icon">&#x23F3;</div>
          <h2>
            {uploadState === UPLOAD_STATES.UPLOADING ? 'Uploading...' : 'Processing DICOM data...'}
          </h2>
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{
                width: `${uploadState === UPLOAD_STATES.UPLOADING ? uploadProgress : processingProgress}%`,
              }}
            />
          </div>
          <p className="progress-text">
            {uploadState === UPLOAD_STATES.UPLOADING
              ? `${uploadProgress}% uploaded`
              : `${processingProgress}% processed`}
          </p>
        </div>
      </div>
    )
  }

  // Error screen
  if (uploadState === UPLOAD_STATES.ERROR) {
    return (
      <div className="upload-screen">
        <div className="error-container">
          <div className="error-icon">&#x26A0;&#xFE0F;</div>
          <h2>Something went wrong</h2>
          <p className="error-message">{errorMessage}</p>
          <button className="retry-button" onClick={reset}>
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // Upload / dropzone screen (idle state)
  return (
    <div className="upload-screen">
      <div {...getRootProps()} className={`dropzone ${isDragActive ? 'dropzone-active' : ''}`}>
        <input {...getInputProps()} data-testid="file-input" />
        <div className="dropzone-content">
          <div className="upload-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <h2>Upload DICOM Files</h2>
          <p className="dropzone-hint">
            Drag & drop <strong>.dcm</strong> files or a <strong>.zip</strong> archive here
          </p>
          <p className="dropzone-hint-secondary">or click to browse</p>
          <p className="dropzone-limits">Maximum total size: 5 GB</p>
        </div>
      </div>
    </div>
  )
}
