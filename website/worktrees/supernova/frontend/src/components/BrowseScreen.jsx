import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchStudies, fetchStudySeries, viewSeries } from '../services/api'
import './BrowseScreen.css'

export default function BrowseScreen() {
  const navigate = useNavigate()
  const [studies, setStudies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [patientFilter, setPatientFilter] = useState('')
  const [modalityFilter, setModalityFilter] = useState('')

  // Expanded study → series
  const [expandedStudy, setExpandedStudy] = useState(null)
  const [seriesList, setSeriesList] = useState([])
  const [seriesLoading, setSeriesLoading] = useState(false)

  // View processing
  const [viewingSeriesId, setViewingSeriesId] = useState(null)

  const loadStudies = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const filters = {}
      if (patientFilter.trim()) filters.patient_id = patientFilter.trim()
      if (modalityFilter.trim()) filters.modality = modalityFilter.trim()
      const data = await fetchStudies(filters)
      setStudies(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [patientFilter, modalityFilter])

  useEffect(() => {
    loadStudies()
  }, [loadStudies])

  const handleExpandStudy = async (studyUid) => {
    if (expandedStudy === studyUid) {
      setExpandedStudy(null)
      setSeriesList([])
      return
    }
    setExpandedStudy(studyUid)
    setSeriesLoading(true)
    try {
      const data = await fetchStudySeries(studyUid)
      setSeriesList(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSeriesLoading(false)
    }
  }

  const handleView3D = async (studyUid, seriesUid) => {
    setViewingSeriesId(seriesUid)
    try {
      const result = await viewSeries(studyUid, seriesUid)
      navigate(`/viewer/${result.jobId}`)
    } catch (err) {
      setError(err.message)
      setViewingSeriesId(null)
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString()
  }

  const formatBytes = (bytes) => {
    if (!bytes) return '—'
    const mb = bytes / (1024 * 1024)
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
    return `${mb.toFixed(1)} MB`
  }

  const truncateUid = (uid) => {
    if (!uid || uid.length <= 24) return uid
    return `...${uid.slice(-20)}`
  }

  return (
    <div className="browse-screen">
      <div className="browse-header">
        <h2>DICOM Studies</h2>
        <div className="browse-filters">
          <input
            type="text"
            placeholder="Filter by Patient ID..."
            value={patientFilter}
            onChange={(e) => setPatientFilter(e.target.value)}
            className="filter-input"
          />
          <input
            type="text"
            placeholder="Filter by Modality (CT, MRI...)"
            value={modalityFilter}
            onChange={(e) => setModalityFilter(e.target.value)}
            className="filter-input"
          />
          <button className="refresh-btn" onClick={loadStudies} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="browse-error">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="browse-loading">Loading studies...</div>
      ) : studies.length === 0 ? (
        <div className="browse-empty">
          <p>No studies found in the database.</p>
          <p className="browse-empty-hint">
            Upload DICOM files from the <a href="/upload">Upload</a> page to get started.
          </p>
        </div>
      ) : (
        <div className="studies-table-container">
          <table className="studies-table">
            <thead>
              <tr>
                <th></th>
                <th>Patient ID</th>
                <th>Modality</th>
                <th>Study Date</th>
                <th>Series</th>
                <th>Instances</th>
                <th>Study UID</th>
              </tr>
            </thead>
            <tbody>
              {studies.map((study) => (
                <>
                  <tr
                    key={study.study_instance_uid}
                    className={`study-row ${expandedStudy === study.study_instance_uid ? 'expanded' : ''}`}
                    onClick={() => handleExpandStudy(study.study_instance_uid)}
                  >
                    <td className="expand-cell">
                      {expandedStudy === study.study_instance_uid ? '▾' : '▸'}
                    </td>
                    <td>{study.patient_id || '—'}</td>
                    <td><span className="modality-badge">{study.modality || '—'}</span></td>
                    <td>{formatDate(study.study_date)}</td>
                    <td>{study.series_count}</td>
                    <td>{study.instance_count}</td>
                    <td className="uid-cell" title={study.study_instance_uid}>
                      {truncateUid(study.study_instance_uid)}
                    </td>
                  </tr>
                  {expandedStudy === study.study_instance_uid && (
                    <tr key={`${study.study_instance_uid}-series`} className="series-row">
                      <td colSpan="7">
                        {seriesLoading ? (
                          <div className="series-loading">Loading series...</div>
                        ) : seriesList.length === 0 ? (
                          <div className="series-empty">No series found.</div>
                        ) : (
                          <table className="series-table">
                            <thead>
                              <tr>
                                <th>Series UID</th>
                                <th>Modality</th>
                                <th>Instances</th>
                                <th>Size</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {seriesList.map((series) => (
                                <tr key={series.series_instance_uid}>
                                  <td className="uid-cell" title={series.series_instance_uid}>
                                    {truncateUid(series.series_instance_uid)}
                                  </td>
                                  <td>{series.modality || '—'}</td>
                                  <td>{series.instance_count}</td>
                                  <td>{formatBytes(series.total_bytes)}</td>
                                  <td>
                                    <button
                                      className="view-3d-btn"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleView3D(study.study_instance_uid, series.series_instance_uid)
                                      }}
                                      disabled={viewingSeriesId === series.series_instance_uid}
                                    >
                                      {viewingSeriesId === series.series_instance_uid
                                        ? 'Loading...'
                                        : 'View 3D'}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
