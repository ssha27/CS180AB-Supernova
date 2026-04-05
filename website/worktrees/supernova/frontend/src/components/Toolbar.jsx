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
      setMinToolbarHeight(Math.ceil(maxH + 22))
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
    window.location.href = '/'
  }, [reset])

  const toolbarStyle = toolbarHeight != null
    ? { height: toolbarHeight, maxHeight: toolbarHeight, overflow: 'hidden' }
    : {}

  return (
    <div className="toolbar" ref={toolbarRef} style={toolbarStyle}>
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={handleBack} title="Back to Browse">
          ← Back
        </button>
      </div>

      {!is2DFallback && (
        <>
          {/* View mode toggle */}
          <div className="toolbar-group">
            <span className="toolbar-label">Mode</span>
            <button
              className={`toolbar-btn ${viewMode === VIEW_MODES.VOLUME ? 'active' : ''}`}
              onClick={() => setViewMode(VIEW_MODES.VOLUME)}
            >
              Volume
            </button>
            <button
              className={`toolbar-btn ${viewMode === VIEW_MODES.SURFACE ? 'active' : ''}`}
              onClick={() => setViewMode(VIEW_MODES.SURFACE)}
            >
              Surface
            </button>
          </div>

          {/* Opacity controls (only for volume mode) */}
          {viewMode === VIEW_MODES.VOLUME && (
            <div className="toolbar-group toolbar-group-opacity">
              <span className="toolbar-label">Opacity Preset</span>
              <div className="preset-buttons">
                {Object.values(OPACITY_PRESETS).map((preset) => (
                  <button
                    key={preset}
                    className={`toolbar-btn toolbar-btn-sm ${opacityPreset === preset ? 'active' : ''}`}
                    onClick={() => setOpacityPreset(preset)}
                  >
                    {preset.charAt(0).toUpperCase() + preset.slice(1)}
                  </button>
                ))}
              </div>
              <div className="opacity-slider-row">
                <span className="toolbar-label-sm">
                  Opacity {Math.round(opacityMultiplier * 100)}%
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
                  className="opacity-slider"
                />
              </div>
            </div>
          )}

          {/* Flip controls */}
          <div className="toolbar-group">
            <span className="toolbar-label">Flip</span>
            <button
              className={`toolbar-btn ${isFlippedH ? 'active' : ''}`}
              onClick={toggleFlipH}
              title="Flip Horizontal"
            >
              ↔ H
            </button>
            <button
              className={`toolbar-btn ${isFlippedV ? 'active' : ''}`}
              onClick={toggleFlipV}
              title="Flip Vertical"
            >
              ↕ V
            </button>
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
                  {plane.charAt(0).toUpperCase() + plane.slice(1)}
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
                    className="clip-slider"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Slice axis selector + scrollbar */}
          <div className="toolbar-group toolbar-group-slice">
            <span className="toolbar-label">Slice View</span>
            <select
              className="slice-axis-select"
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
                  {currentSliceIndex + 1}/{totalSlices}
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
                  className="slice-slider"
                />
              </>
            )}
          </div>

          {/* Detected Organs */}
          {segmentsAvailable && segmentManifest.length > 0 && (
            <div className="toolbar-group toolbar-group-organs">
              <span className="toolbar-label">Detected Organs</span>
              <div className="organ-actions">
                <button
                  className="toolbar-btn toolbar-btn-sm"
                  onClick={showAllSegments}
                  title="Show all detected organs"
                >
                  Show All
                </button>
                <button
                  className="toolbar-btn toolbar-btn-sm"
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
                      <span className="organ-loading">⏳</span>
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
