import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchStudies } from '../services/api'
import './HomeScreen.css'

export default function HomeScreen() {
  const navigate = useNavigate()
  const [studies, setStudies] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await fetchStudies({})
        if (!cancelled) setStudies(data)
      } catch {
        if (!cancelled) setStudies([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const stats = useMemo(() => {
    const totalSeries = studies.reduce((sum, s) => sum + (s.series_count || 0), 0)
    const totalInstances = studies.reduce((sum, s) => sum + (s.instance_count || 0), 0)
    const uniquePatients = new Set(studies.map(s => s.patient_id).filter(Boolean)).size
    const modalities = [...new Set(studies.map(s => s.modality).filter(Boolean))]
    return {
      studies: studies.length,
      series: totalSeries,
      instances: totalInstances,
      patients: uniquePatients,
      modalities,
    }
  }, [studies])

  const recentStudies = studies.slice(0, 4)

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="home-screen">
      <div className="home-container">
        {/* Hero */}
        <section className="hero">
          <div className="hero-bg" aria-hidden="true">
            <div className="hero-grid" />
            <div className="hero-orb hero-orb-1" />
            <div className="hero-orb hero-orb-2" />
          </div>

          <div className="hero-content">
            <div className="hero-eyebrow">
              <span className="hero-pulse" />
              SUPERNOVA · MEDICAL IMAGING PLATFORM
            </div>
            <h1 className="hero-title">
              Volumetric reconstruction<br />
              and analysis for <span className="hero-accent">DICOM imaging.</span>
            </h1>
            <p className="hero-subtitle">
              An end-to-end clinical research platform for ingesting DICOM studies,
              reconstructing 3D volumes, and rendering anatomical surfaces with
              automated organ segmentation.
            </p>
            <div className="hero-actions">
              <button className="btn btn-primary btn-lg" onClick={() => navigate('/browse')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                </svg>
                Browse Archive
              </button>
              <button className="btn btn-secondary btn-lg" onClick={() => navigate('/upload')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                Upload DICOM
              </button>
            </div>
          </div>

          <div className="hero-meta">
            <MetaItem label="System" value="Online" status="ok" />
            <MetaItem label="Storage" value="MongoDB · GridFS" />
            <MetaItem label="Index" value="PostgreSQL" />
            <MetaItem label="Pipeline" value="VTK · TotalSegmentator" />
          </div>
        </section>

        {/* Live stats */}
        <section className="section">
          <div className="section-header">
            <div>
              <div className="section-eyebrow">Archive Overview</div>
              <h2 className="section-title">Live database statistics</h2>
            </div>
            <div className={`live-badge ${loading ? 'loading' : ''}`}>
              <span className="live-dot" />
              {loading ? 'Syncing' : 'Synced'}
            </div>
          </div>
          <div className="stats-grid">
            <StatCard
              label="Studies"
              value={stats.studies}
              icon={<IconStudies />}
              accent="cyan"
            />
            <StatCard
              label="Series"
              value={stats.series}
              icon={<IconSeries />}
              accent="purple"
            />
            <StatCard
              label="Instances"
              value={stats.instances.toLocaleString()}
              icon={<IconInstances />}
              accent="amber"
            />
            <StatCard
              label="Patients"
              value={stats.patients}
              icon={<IconPatient />}
              accent="blue"
            />
          </div>
          {stats.modalities.length > 0 && (
            <div className="modality-strip">
              <span className="modality-strip-label">Active modalities</span>
              <div className="modality-strip-tags">
                {stats.modalities.map(m => (
                  <span key={m} className={`modality-badge mod-${m.toLowerCase()}`}>{m}</span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Capabilities */}
        <section className="section">
          <div className="section-header">
            <div>
              <div className="section-eyebrow">Platform Capabilities</div>
              <h2 className="section-title">Clinical-grade processing pipeline</h2>
            </div>
          </div>
          <div className="capabilities-grid">
            <CapabilityCard
              icon={<IconUpload />}
              title="DICOM Ingestion"
              description="Upload single files or zipped studies. Files are validated, anonymized, indexed, and stored in MongoDB GridFS with PostgreSQL metadata."
              tags={['CT', 'MR', 'US', 'X-Ray']}
            />
            <CapabilityCard
              icon={<IconVolume />}
              title="3D Volume Rendering"
              description="GPU-accelerated ray-cast volume rendering with Hounsfield-unit-aware tissue presets for skin, muscle, and bone visualization."
              tags={['VTK.js', 'WebGL']}
            />
            <CapabilityCard
              icon={<IconSurface />}
              title="Surface Reconstruction"
              description="Marching Cubes isosurface extraction with mesh smoothing and decimation for interactive 3D anatomical surface viewing."
              tags={['Marching Cubes', 'VTP']}
            />
            <CapabilityCard
              icon={<IconOrgan />}
              title="Organ Segmentation"
              description="Automated multi-organ segmentation across 117 anatomical structures using a deep-learning pipeline backed by TotalSegmentator."
              tags={['TotalSegmentator', 'PyTorch']}
            />
          </div>
        </section>

        {/* Recent studies */}
        {!loading && recentStudies.length > 0 && (
          <section className="section">
            <div className="section-header">
              <div>
                <div className="section-eyebrow">Recently Ingested</div>
                <h2 className="section-title">Latest studies in the archive</h2>
              </div>
              <button className="link-btn" onClick={() => navigate('/browse')}>
                View all
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </div>
            <div className="recent-grid">
              {recentStudies.map(s => (
                <div
                  key={s.study_instance_uid}
                  className="recent-card"
                  onClick={() => navigate('/browse')}
                >
                  <div className="recent-card-top">
                    <span className={`modality-badge mod-${(s.modality || 'unknown').toLowerCase()}`}>
                      {s.modality || '—'}
                    </span>
                    <span className="recent-card-date">{formatDate(s.study_date)}</span>
                  </div>
                  <div className="recent-card-patient">
                    <span className="avatar">{(s.patient_id || '?').slice(0, 2).toUpperCase()}</span>
                    <span className="patient-id">{s.patient_id || 'Unknown patient'}</span>
                  </div>
                  <div className="recent-card-stats">
                    <div>
                      <div className="recent-stat-value">{s.series_count}</div>
                      <div className="recent-stat-label">Series</div>
                    </div>
                    <div>
                      <div className="recent-stat-value">{s.instance_count}</div>
                      <div className="recent-stat-label">Instances</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Empty state CTA */}
        {!loading && studies.length === 0 && (
          <section className="section">
            <div className="empty-cta">
              <div className="empty-cta-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
              </div>
              <h3>The archive is empty</h3>
              <p>Upload your first DICOM study to begin building the imaging archive.</p>
              <button className="btn btn-primary btn-lg" onClick={() => navigate('/upload')}>
                Upload Your First Study
              </button>
            </div>
          </section>
        )}

        <footer className="home-footer">
          <span>SUPERNOVA · v0.1.0</span>
          <span className="footer-divider">·</span>
          <span>For research and educational use</span>
        </footer>
      </div>
    </div>
  )
}

/* ===== Sub-components ===== */
function MetaItem({ label, value, status }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className={`meta-value ${status === 'ok' ? 'ok' : ''}`}>
        {status === 'ok' && <span className="meta-pulse" />}
        {value}
      </span>
    </div>
  )
}

function StatCard({ label, value, icon, accent = 'cyan' }) {
  return (
    <div className={`stat-card-lg accent-${accent}`}>
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-body">
        <div className="stat-card-value">{value}</div>
        <div className="stat-card-label">{label}</div>
      </div>
    </div>
  )
}

function CapabilityCard({ icon, title, description, tags }) {
  return (
    <div className="capability-card">
      <div className="capability-icon">{icon}</div>
      <div className="capability-body">
        <h3 className="capability-title">{title}</h3>
        <p className="capability-description">{description}</p>
        <div className="capability-tags">
          {tags.map(t => <span key={t} className="capability-tag">{t}</span>)}
        </div>
      </div>
    </div>
  )
}

/* ===== Icons ===== */
const IconStudies = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
)
const IconSeries = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
)
const IconInstances = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 21V9" />
  </svg>
)
const IconPatient = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)
const IconUpload = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </svg>
)
const IconVolume = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
  </svg>
)
const IconSurface = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12c0-2 4-4 9-4s9 2 9 4M3 12c0 2 4 4 9 4s9-2 9-4M12 3c-2 3-3 6-3 9s1 6 3 9c2-3 3-6 3-9s-1-6-3-9z" />
  </svg>
)
const IconOrgan = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21.5C8 17 4 13 4 8.5a4.5 4.5 0 018-2.85A4.5 4.5 0 0120 8.5c0 4.5-4 8.5-8 13z" />
  </svg>
)
