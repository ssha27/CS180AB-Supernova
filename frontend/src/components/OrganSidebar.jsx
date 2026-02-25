import { useState } from 'react'
import { useAppStore, UPLOAD_STATES } from '../store/appStore'
import './OrganSidebar.css'

export default function OrganSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const {
    uploadState,
    is2DFallback,
    segmentsAvailable,
    segmentManifest,
    activeSegments,
    segmentLoadingSet,
    toggleSegment,
    showOnlySegment,
    showAllSegments,
    clearSegments,
  } = useAppStore()

  const isViewing =
    uploadState === UPLOAD_STATES.VIEWING || uploadState === UPLOAD_STATES.READY

  if (!isViewing || is2DFallback || !segmentsAvailable || segmentManifest.length === 0) {
    return null
  }

  const activeCount = activeSegments.size
  const totalCount = segmentManifest.length

  return (
    <div className={`organ-sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Toggle tab — always visible, sticks out from left edge */}
      <button
        className="sidebar-toggle"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Show organ panel' : 'Hide organ panel'}
      >
        <span className="sidebar-toggle-icon">
          {collapsed ? '‹' : '›'}
        </span>
      </button>

      <div className="sidebar-content">
        <div className="sidebar-header">
          <span className="sidebar-title">DETECTED ORGANS</span>
          <span className="sidebar-count">{activeCount}/{totalCount}</span>
        </div>

        <div className="sidebar-actions">
          <button
            className="sidebar-btn"
            onClick={showAllSegments}
            title="Show all detected organs"
          >
            Show All
          </button>
          <button
            className="sidebar-btn"
            onClick={clearSegments}
            title="Hide all organ meshes"
          >
            Hide All
          </button>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-organ-list">
          {segmentManifest.map((seg) => (
            <div key={seg.name} className="sidebar-organ-item">
              <span
                className="sidebar-organ-dot"
                style={{
                  backgroundColor: `rgb(${Math.round(seg.color[0] * 255)}, ${Math.round(seg.color[1] * 255)}, ${Math.round(seg.color[2] * 255)})`,
                }}
              />
              <label className="sidebar-organ-checkbox">
                <input
                  type="checkbox"
                  checked={activeSegments.has(seg.name)}
                  onChange={() => toggleSegment(seg.name)}
                />
                <span
                  className="sidebar-organ-name"
                  onClick={(e) => {
                    e.preventDefault()
                    showOnlySegment(seg.name)
                  }}
                  title={`Show only ${seg.displayName}`}
                >
                  {seg.displayName}
                </span>
              </label>
              {segmentLoadingSet.has(seg.name) && (
                <span className="sidebar-organ-loading">⏳</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
