import { formatOrganName } from '../utils/hoverDetails';
import {
  type SliceDistanceMeasurementSummary,
  type SliceInteractionMode,
  type SliceProbeSummary,
  type VisibilityPresetId,
  VISIBILITY_PRESETS,
} from '../utils/viewerTools';
import type { ViewerMode } from './ViewerControls';

interface ViewerToolPanelProps {
  viewMode: ViewerMode;
  sliceAvailable: boolean;
  visibilityPresetId: VisibilityPresetId;
  anatomyLabelsEnabled: boolean;
  interactionMode: SliceInteractionMode;
  latestDistance: SliceDistanceMeasurementSummary | null;
  latestProbe: SliceProbeSummary | null;
  onCollapse: () => void;
  onVisibilityPresetChange: (id: VisibilityPresetId) => void;
  onAnatomyLabelsEnabledChange: (enabled: boolean) => void;
  onInteractionModeChange: (mode: SliceInteractionMode) => void;
}

const INTERACTION_MODES: Array<{ id: SliceInteractionMode; label: string }> = [
  { id: 'navigate', label: 'Navigate' },
  { id: 'distance', label: 'Distance' },
  { id: 'probe', label: 'HU Probe' },
];

export default function ViewerToolPanel({
  viewMode,
  sliceAvailable,
  visibilityPresetId,
  anatomyLabelsEnabled,
  interactionMode,
  latestDistance,
  latestProbe,
  onCollapse,
  onVisibilityPresetChange,
  onAnatomyLabelsEnabledChange,
  onInteractionModeChange,
}: ViewerToolPanelProps) {
  const sliceToolsEnabled = sliceAvailable;

  return (
    <div className="w-[min(22rem,calc(100vw-2rem))] rounded-[1.6rem] border border-white/10 bg-slate-950/88 p-4 text-slate-100 shadow-[0_20px_45px_rgba(2,6,23,0.42)] backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            Reader Tools
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            Filters, measurements, and labels
          </p>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="min-w-[6.5rem] rounded-full border border-slate-700/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-200 transition-colors hover:border-sky-300/40 hover:text-sky-100"
          data-testid="viewer-tool-panel-collapse"
        >
          Hide Panel
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-white/8 bg-slate-900/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Visibility Preset
            </p>
            <p className="mt-1 text-xs text-slate-300">
              Limit the viewer and organ list to all anatomy, bones, organs, or muscles.
            </p>
          </div>
        </div>
        <select
          value={visibilityPresetId}
          onChange={(event) => onVisibilityPresetChange(event.target.value as VisibilityPresetId)}
          className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="visibility-preset-select"
        >
          {VISIBILITY_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          {VISIBILITY_PRESETS.find((preset) => preset.id === visibilityPresetId)?.description}
        </p>
      </div>

      <div className="mt-3 rounded-2xl border border-white/8 bg-slate-900/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Slice Interaction
            </p>
            <p className="mt-1 text-xs text-slate-300">
              Use slice panes for navigation, distance, and HU sampling.
            </p>
          </div>
          {!sliceToolsEnabled && (
            <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-100">
              Volume Required
            </span>
          )}
        </div>

        {sliceAvailable && viewMode === 'model' && (
          <p className="mt-3 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-[11px] leading-5 text-sky-100">
            Selecting a slice tool will switch the viewer into slice mode automatically.
          </p>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2">
          {INTERACTION_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => onInteractionModeChange(mode.id)}
              disabled={!sliceToolsEnabled}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                interactionMode === mode.id
                  ? 'border-sky-300/45 bg-sky-400/15 text-sky-50'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
              }`}
              data-testid={`viewer-tool-${mode.id}`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <label className="mt-3 flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <input
            type="checkbox"
            checked={anatomyLabelsEnabled}
            disabled={!sliceToolsEnabled}
            onChange={(event) => onAnatomyLabelsEnabledChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500 disabled:opacity-50"
            data-testid="anatomy-labels-toggle"
          />
          <div>
            <p className="text-sm font-medium text-slate-100">Anatomy labels</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Overlay visible organ names on the active orthogonal slices.
            </p>
          </div>
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/8 bg-slate-900/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Distance
          </p>
          {latestDistance ? (
            <>
              <p className="mt-2 text-lg font-semibold text-white">
                {latestDistance.distanceMm.toFixed(1)} mm
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                {latestDistance.plane}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-400">
              Select the distance tool and click two points in a slice pane.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-white/8 bg-slate-900/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            HU Probe
          </p>
          {latestProbe ? (
            <>
              <p className="mt-2 text-lg font-semibold text-white">
                {latestProbe.intensity} HU
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                {latestProbe.organName ? formatOrganName(latestProbe.organName) : latestProbe.plane}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-400">
              Select the HU probe tool and click a voxel in any slice pane.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}