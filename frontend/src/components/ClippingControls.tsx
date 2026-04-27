export interface ClippingState {
  axial: { enabled: boolean; value: number };
  coronal: { enabled: boolean; value: number };
  sagittal: { enabled: boolean; value: number };
}

interface ClippingControlsProps {
  clipping: ClippingState;
  onChange: (state: ClippingState) => void;
}

const PLANES = [
  { key: 'axial' as const, label: 'Axial', color: 'bg-blue-500' },
  { key: 'coronal' as const, label: 'Coronal', color: 'bg-green-500' },
  { key: 'sagittal' as const, label: 'Sagittal', color: 'bg-red-500' },
];

export default function ClippingControls({ clipping, onChange }: ClippingControlsProps) {
  const updatePlane = (plane: keyof ClippingState, nextState: Partial<ClippingState[keyof ClippingState]>) => {
    onChange({
      ...clipping,
      [plane]: { ...clipping[plane], ...nextState },
    });
  };

  const togglePlane = (plane: keyof ClippingState) => {
    updatePlane(plane, { enabled: !clipping[plane].enabled });
  };

  const setPlaneValue = (plane: keyof ClippingState, value: number) => {
    updatePlane(plane, { enabled: true, value });
  };

  return (
    <div className="flex gap-6 items-center justify-center">
      <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">
        Clipping
      </span>
      {PLANES.map(({ key, label, color }) => (
        <div key={key} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => togglePlane(key)}
            className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
              clipping[key].enabled
                ? `${color} text-white`
                : 'bg-gray-800 text-gray-500'
            }`}
            title={`Toggle ${label} clipping plane`}
            aria-pressed={clipping[key].enabled}
            data-testid={`clip-toggle-${key}`}
          >
            {label[0]}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={clipping[key].value}
            onChange={(e) => setPlaneValue(key, parseFloat(e.target.value))}
            aria-label={`${label} clipping position`}
            className={`w-24 cursor-pointer accent-blue-500 ${
              clipping[key].enabled ? '' : 'opacity-80'
            }`}
            data-testid={`clip-slider-${key}`}
          />
        </div>
      ))}
    </div>
  );
}
