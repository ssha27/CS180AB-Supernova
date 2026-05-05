import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore, VIEW_MODES, UPLOAD_STATES, SLICE_AXES, OPACITY_PRESETS } from '../store/appStore'
import './Toolbar.css'

export default function Toolbar() {
  const navigate = useNavigate()
  const {
    viewMode,
    setViewMode,
    toggleFlipH,
    toggleFlipV,
    isFlippedH,
    isFlippedV,
    clipPlanes,
    setClipPlane,
    currentSliceIndex,
    totalSlices,
    setCurrentSliceIndex,
    is2DFallback,
    uploadState,
    reset,
    sliceAxis,
    setSliceAxis,
    opacityPreset,
    setOpacityPreset,
    opacityMultiplier,
    setOpacityMultiplier,
    segmentsAvailable,
    segmentManifest,
    activeSegments,
    segmentLoadingSet,
    toggleSegment,
    showOnlySegment,
    showAllSegments,
    clearSegments,
  } = useAppStore()

  const toolbarRef = useRef(null)
  const [toolbarHeight, setToolbarHeight] = useState(null) // null = auto
  const [minToolbarHeight, setMinToolbarHeight] = useState(48)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

  // Measure the minimum height based on the tallest non-organ section
  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return

    const measure = () => {
      const groups = toolbar.querySelectorAll('.toolbar-group:not(.toolbar-group-organs)')
      let maxH = 48 // minimum fallback
      for (const g of groups) {
        const h = g.getBoundingClientRect().height
        if (h > maxH) maxH = h
      }
      // Add toolbar padding (top + bottom ~1.2rem ≈ ~20px) + border
      setMinToolbarHeight(Math.ceil(maxH + 24))
    }

    measure()
    const ro = new ResizeObserver(measure)
    for (const g of toolbar.querySelectorAll('.toolbar-group:not(.toolbar-group-organs)')) {
      ro.observe(g)
    }
    return () => ro.disconnect()
  }, [uploadState, viewMode, is2DFallback])

  // Drag handlers
  const onPointerDown = useCallback((e) => {
    e.preventDefault()
    isDragging.current = true
    dragStartY.current = e.clientY
    const toolbar = toolbarRef.current
    dragStartHeight.current = toolbar ? toolbar.getBoundingClientRect().height : 200
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onPointerMove = (e) => {
      if (!isDragging.current) return
      const delta = e.clientY - dragStartY.current
      const newH = Math.max(minToolbarHeight, dragStartHeight.current + delta)
      setToolbarHeight(newH)
    }
    const onPointerUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [minToolbarHeight])

  const handleBack = useCallback(() => {
    reset()
    // Full page reload to cleanly tear down VTK.js WebGL context
    window.location.href = '/browse'
  }, [reset])

  const toolbarStyle = toolbarHeight != null
    ? { height: toolbarHeight, maxHeight: toolbarHeight, overflow: 'hidden' }
    : {}

  return (
    <div className="toolbar" ref={toolbarRef} style={toolbarStyle}>
      <div className="toolbar-group toolbar-group-brand">
        <button className="toolbar-back" onClick={handleBack} title="Back to Browse">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back
        </button>
        <div className="toolbar-divider" />
        <div className="toolbar-brand">
          <div className="toolbar-brand-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3v18M3 12h18" />
              <circle cx="12" cy="12" r="3" fill="currentColor" />
            </svg>
          </div>
          <span className="toolbar-brand-text">3D Viewer</span>
        </div>
      </div>

      {!is2DFallback && (
        <>
          {/* View mode toggle */}
          <div className="toolbar-group">
            <span className="toolbar-label">Mode</span>
            <div className="segmented">
              <button
                className={`segmented-btn ${viewMode === VIEW_MODES.VOLUME ? 'active' : ''}`}
                onClick={() => setViewMode(VIEW_MODES.VOLUME)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                  <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
                </svg>
                Volume
              </button>
              <button
                className={`segmented-btn ${viewMode === VIEW_MODES.SURFACE ? 'active' : ''}`}
                onClick={() => setViewMode(VIEW_MODES.SURFACE)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12c0-2 4-4 9-4s9 2 9 4M3 12c0 2 4 4 9 4s9-2 9-4" />
                </svg>
                Surface
              </button>
            </div>
          </div>

          {/* Opacity controls (only for volume mode) */}
          {viewMode === VIEW_MODES.VOLUME && (
            <div className="toolbar-group toolbar-group-opacity">
              <span className="toolbar-label">Tissue Preset</span>
              <div className="preset-buttons">
                {Object.values(OPACITY_PRESETS).map((preset) => (
                  <button
                    key={preset}
                    className={`chip ${opacityPreset === preset ? 'active' : ''}`}
                    onClick={() => setOpacityPreset(preset)}
                  >
                    {preset.charAt(0).toUpperCase() + preset.slice(1)}
                  </button>
                ))}
              </div>
              <div className="opacity-slider-row">
                <span className="toolbar-label-sm">
                  Opacity <strong>{Math.round(opacityMultiplier * 100)}%</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(opacityMultiplier * 100)}
                  onChange={(e) =>
                    setOpacityMultiplier(parseInt(e.target.value, 10) / 100)
                  }
                  className="range-slider"
                />
              </div>
            </div>
          )}

          {/* Flip controls */}
          <div className="toolbar-group">
            <span className="toolbar-label">Flip</span>
            <div className="segmented">
              <button
                className={`segmented-btn ${isFlippedH ? 'active' : ''}`}
                onClick={toggleFlipH}
                title="Flip Horizontal"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v18M22 12l-5-5v3h-5v4h5v3l5-5zM2 12l5 5v-3h5v-4H7V7l-5 5z" />
                </svg>
                H
              </button>
              <button
                className={`segmented-btn ${isFlippedV ? 'active' : ''}`}
                onClick={toggleFlipV}
                title="Flip Vertical"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12h18M12 22l5-5h-3v-5h-4v5H7l5 5zM12 2L7 7h3v5h4V7h3l-5-5z" />
                </svg>
                V
              </button>
            </div>
          </div>

          {/* Clipping plane controls */}
          <div className="toolbar-group toolbar-group-clip">
            <span className="toolbar-label">Clip Planes</span>

            {['axial', 'sagittal', 'coronal'].map((plane) => (
              <div key={plane} className="clip-control">
                <label className="clip-checkbox">
                  <input
                    type="checkbox"
                    checked={clipPlanes[plane].enabled}
                    onChange={(e) =>
                      setClipPlane(plane, { enabled: e.target.checked })
                    }
                  />
                  <span>{plane.charAt(0).toUpperCase() + plane.slice(1)}</span>
                </label>
                {clipPlanes[plane].enabled && (
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={clipPlanes[plane].value}
                    onChange={(e) =>
                      setClipPlane(plane, { value: parseFloat(e.target.value) })
                    }
                    className="range-slider compact"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Slice axis selector + scrollbar */}
          <div className="toolbar-group toolbar-group-slice">
            <span className="toolbar-label">Slice View</span>
            <select
              className="select-input"
              value={sliceAxis}
              onChange={(e) => setSliceAxis(e.target.value)}
            >
              {Object.entries(SLICE_AXES).map(([key, value]) => (
                <option key={value} value={value}>
                  {key.charAt(0) + key.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
            {totalSlices > 1 && (
              <>
                <span className="toolbar-label-sm">
                  <strong>{currentSliceIndex + 1}</strong>/{totalSlices}
                </span>
                <input
                  type="range"
                  min="0"
                  max={totalSlices - 1}
                  step="1"
                  value={currentSliceIndex}
                  onChange={(e) =>
                    setCurrentSliceIndex(parseInt(e.target.value, 10))
                  }
                  className="range-slider wide"
                />
              </>
            )}
          </div>

          {/* Detected Organs */}
          {segmentsAvailable && segmentManifest.length > 0 && (
            <div className="toolbar-group toolbar-group-organs">
              <div className="organ-header">
                <span className="toolbar-label">Detected Organs</span>
                <span className="organ-count">{segmentManifest.length}</span>
              </div>
              <div className="organ-actions">
                <button
                  className="chip"
                  onClick={showAllSegments}
                  title="Show all detected organs"
                >
                  Show All
                </button>
                <button
                  className="chip"
                  onClick={clearSegments}
                  title="Hide all organ meshes"
                >
                  Hide All
                </button>
              </div>
              <div className="organ-list">
                {segmentManifest.map((seg) => (
                  <div key={seg.name} className="organ-item">
                    <span
                      className="organ-color-dot"
                      style={{
                        backgroundColor: `rgb(${Math.round(seg.color[0] * 255)}, ${Math.round(seg.color[1] * 255)}, ${Math.round(seg.color[2] * 255)})`,
                      }}
                    />
                    <label className="organ-checkbox">
                      <input
                        type="checkbox"
                        checked={activeSegments.has(seg.name)}
                        onChange={() => toggleSegment(seg.name)}
                      />
                      <span
                        className="organ-name"
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
                      <span className="organ-loading" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Drag handle for vertical resize */}
      <div
        className="toolbar-resize-handle"
        onPointerDown={onPointerDown}
        title="Drag to resize toolbar"
      />
    </div>
  )
}
