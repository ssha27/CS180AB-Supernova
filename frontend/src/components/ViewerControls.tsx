import ClippingControls, { type ClippingState } from './ClippingControls';

export type ViewerMode = 'model' | 'slice';

interface ViewerControlsProps {
  viewMode: ViewerMode;
  sliceAvailable: boolean;
  clipping: ClippingState;
  onViewModeChange: (mode: ViewerMode) => void;
  onClippingChange: (state: ClippingState) => void;
}

export default function ViewerControls({
  viewMode,
  sliceAvailable,
  clipping,
  onViewModeChange,
  onClippingChange,
}: ViewerControlsProps) {
  const isSliceMode = viewMode === 'slice';

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6">
      <div className="flex items-center gap-3 rounded-full border border-gray-800 bg-gray-950/85 px-4 py-2 shadow-[0_10px_35px_rgba(2,6,23,0.25)]">
        <span
          className={`text-xs font-semibold uppercase tracking-[0.22em] transition-colors ${
            !isSliceMode ? 'text-gray-100' : 'text-gray-500'
          }`}
        >
          Model
        </span>
        <label className="relative inline-flex items-center">
          <input
            type="checkbox"
            checked={isSliceMode}
            disabled={!sliceAvailable}
            onChange={(event) => onViewModeChange(event.target.checked ? 'slice' : 'model')}
            className="peer sr-only"
            data-testid="view-mode-toggle"
          />
          <span
            className={`h-6 w-11 rounded-full border transition-colors ${
              sliceAvailable
                ? 'border-gray-700 bg-gray-800 peer-checked:border-sky-400/50 peer-checked:bg-sky-500/20'
                : 'border-gray-800 bg-gray-900 opacity-60'
            }`}
          />
          <span
            className={`pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              isSliceMode ? 'translate-x-5' : 'translate-x-0'
            } ${sliceAvailable ? '' : 'bg-gray-500'}`}
          />
        </label>
        <span
          className={`text-xs font-semibold uppercase tracking-[0.22em] transition-colors ${
            isSliceMode ? 'text-sky-100' : 'text-gray-500'
          } ${sliceAvailable ? '' : 'text-gray-600'}`}
        >
          Slice
        </span>
      </div>

      {viewMode === 'model' ? (
        <>
          <div className="hidden h-8 w-px bg-gray-800 md:block" />
          <ClippingControls clipping={clipping} onChange={onClippingChange} />
        </>
      ) : (
        <p className="rounded-full border border-gray-800 bg-gray-950/80 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
          Drag crosshair, hover overlays, wheel through slices.
        </p>
      )}
    </div>
  );
}