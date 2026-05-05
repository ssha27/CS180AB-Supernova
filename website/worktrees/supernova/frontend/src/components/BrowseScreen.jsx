import { useEffect, useState, useCallback, useMemo } from 'react'
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
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatBytes = (bytes) => {
    if (!bytes) return '—'
    const mb = bytes / (1024 * 1024)
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
    return `${mb.toFixed(1)} MB`
  }

  const truncateUid = (uid) => {
    if (!uid || uid.length <= 24) return uid
    return `…${uid.slice(-20)}`
  }

  const stats = useMemo(() => {
    const totalSeries = studies.reduce((sum, s) => sum + (s.series_count || 0), 0)
    const totalInstances = studies.reduce((sum, s) => sum + (s.instance_count || 0), 0)
    const uniquePatients = new Set(studies.map(s => s.patient_id).filter(Boolean)).size
    const modalities = new Set(studies.map(s => s.modality).filter(Boolean))
    return {
      studies: studies.length,
      series: totalSeries,
      instances: totalInstances,
      patients: uniquePatients,
      modalities: modalities.size,
    }
  }, [studies])

  const hasFilters = patientFilter.trim() || modalityFilter.trim()
  const clearFilters = () => {
    setPatientFilter('')
    setModalityFilter('')
  }

  return (
    <div className="browse-screen">
      <div className="browse-container">
        {/* Page header */}
        <div className="page-header">
          <div className="page-header-left">
            <div className="page-eyebrow">DICOM Archive</div>
            <h1 className="page-title">Studies</h1>
            <p className="page-subtitle">
              Browse, filter, and visualize patient imaging studies stored in the archive.
            </p>
          </div>
          <div className="page-header-right">
            <button className="btn btn-secondary" onClick={loadStudies} disabled={loading}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/upload')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              Upload DICOM
            </button>
          </div>
        </div>

        {/* Stats overview */}
        <div className="stats-grid">
          <StatCard label="Total Studies" value={stats.studies} icon={<IconStudies />} />
          <StatCard label="Series" value={stats.series} icon={<IconSeries />} />
          <StatCard label="Instances" value={stats.instances.toLocaleString()} icon={<IconInstances />} />
          <StatCard label="Patients" value={stats.patients} icon={<IconPatient />} />
          <StatCard label="Modalities" value={stats.modalities} icon={<IconModality />} />
        </div>

        {/* Filter bar */}
        <div className="filter-bar">
          <div className="filter-group">
            <div className="filter-input-wrap">
              <svg className="filter-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Patient ID"
                value={patientFilter}
                onChange={(e) => setPatientFilter(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="filter-input-wrap">
              <svg className="filter-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              <input
                type="text"
                placeholder="Modality (CT, MR, US…)"
                value={modalityFilter}
                onChange={(e) => setModalityFilter(e.target.value)}
                className="filter-input"
              />
            </div>
            {hasFilters && (
              <button className="filter-clear" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
          <div className="filter-result-count">
            {!loading && (
              <>
                <strong>{studies.length}</strong> {studies.length === 1 ? 'study' : 'studies'}
                {hasFilters && ' matched'}
              </>
            )}
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="error-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="state-panel">
            <div className="loader" />
            <p className="state-text">Loading studies from archive…</p>
          </div>
        ) : studies.length === 0 ? (
          <div className="state-panel">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
            </div>
            <p className="state-text">
              {hasFilters ? 'No studies match the current filters.' : 'No studies in the archive yet.'}
            </p>
            <p className="state-hint">
              {hasFilters
                ? 'Try adjusting your filters or clearing them.'
                : 'Upload DICOM files to start building the archive.'}
            </p>
            {!hasFilters && (
              <button className="btn btn-primary" onClick={() => navigate('/upload')}>
                Upload DICOM Files
              </button>
            )}
          </div>
        ) : (
          <div className="studies-panel">
            <table className="studies-table">
              <thead>
                <tr>
                  <th className="col-expand"></th>
                  <th>Patient ID</th>
                  <th>Modality</th>
                  <th>Study Date</th>
                  <th className="col-num">Series</th>
                  <th className="col-num">Instances</th>
                  <th>Study UID</th>
                </tr>
              </thead>
              <tbody>
                {studies.map((study) => {
                  const isExpanded = expandedStudy === study.study_instance_uid
                  return (
                    <FragmentRow
                      key={study.study_instance_uid}
                      study={study}
                      isExpanded={isExpanded}
                      onToggle={() => handleExpandStudy(study.study_instance_uid)}
                      seriesLoading={seriesLoading}
                      seriesList={seriesList}
                      viewingSeriesId={viewingSeriesId}
                      onView3D={handleView3D}
                      formatDate={formatDate}
                      formatBytes={formatBytes}
                      truncateUid={truncateUid}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function FragmentRow({
  study,
  isExpanded,
  onToggle,
  seriesLoading,
  seriesList,
  viewingSeriesId,
  onView3D,
  formatDate,
  formatBytes,
  truncateUid,
}) {
  return (
    <>
      <tr
        className={`study-row ${isExpanded ? 'expanded' : ''}`}
        onClick={onToggle}
      >
        <td className="col-expand">
          <span className={`chevron ${isExpanded ? 'open' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </td>
        <td>
          <div className="cell-patient">
            <span className="avatar">{(study.patient_id || '?').slice(0, 2).toUpperCase()}</span>
            <span className="patient-id">{study.patient_id || 'Unknown'}</span>
          </div>
        </td>
        <td>
          <span className={`modality-badge mod-${(study.modality || 'unknown').toLowerCase()}`}>
            {study.modality || '—'}
          </span>
        </td>
        <td className="cell-date">{formatDate(study.study_date)}</td>
        <td className="col-num">{study.series_count}</td>
        <td className="col-num">{study.instance_count}</td>
        <td className="uid-cell" title={study.study_instance_uid}>
          {truncateUid(study.study_instance_uid)}
        </td>
      </tr>
      {isExpanded && (
        <tr className="series-row">
          <td colSpan="7">
            {seriesLoading ? (
              <div className="series-state"><div className="loader small" /> Loading series…</div>
            ) : seriesList.length === 0 ? (
              <div className="series-state">No series found in this study.</div>
            ) : (
              <div className="series-wrap">
                <div className="series-heading">Series in this study</div>
                <table className="series-table">
                  <thead>
                    <tr>
                      <th>Series UID</th>
                      <th>Modality</th>
                      <th className="col-num">Instances</th>
                      <th className="col-num">Size</th>
                      <th className="col-action"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {seriesList.map((series) => (
                      <tr key={series.series_instance_uid}>
                        <td className="uid-cell" title={series.series_instance_uid}>
                          {truncateUid(series.series_instance_uid)}
                        </td>
                        <td>
                          <span className={`modality-badge small mod-${(series.modality || 'unknown').toLowerCase()}`}>
                            {series.modality || '—'}
                          </span>
                        </td>
                        <td className="col-num">{series.instance_count}</td>
                        <td className="col-num">{formatBytes(series.total_bytes)}</td>
                        <td className="col-action">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              onView3D(study.study_instance_uid, series.series_instance_uid)
                            }}
                            disabled={viewingSeriesId === series.series_instance_uid}
                          >
                            {viewingSeriesId === series.series_instance_uid ? (
                              <>
                                <div className="loader tiny" />
                                Loading…
                              </>
                            ) : (
                              <>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                                  <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
                                </svg>
                                View 3D
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function StatCard({ label, value, icon }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}

const IconStudies = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
)
const IconSeries = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
)
const IconInstances = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 21V9" />
  </svg>
)
const IconPatient = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)
const IconModality = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
)
