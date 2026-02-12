import { useAppStore, VIEW_MODES, UPLOAD_STATES, SLICE_AXES, OPACITY_PRESETS } from '../store/appStore'
import './Toolbar.css'

export default function Toolbar() {
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
  } = useAppStore()

  const isViewing =
    uploadState === UPLOAD_STATES.VIEWING || uploadState === UPLOAD_STATES.READY

  if (!isViewing) return null

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={reset} title="New Upload">
          ← New
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
        </>
      )}
    </div>
  )
}
