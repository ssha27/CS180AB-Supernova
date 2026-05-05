import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import VTKRenderer from './VTKRenderer';
import type { ClippingState } from './ClippingControls';
import { getVolumeUrl, type OrganInfo, type VolumeAsset, type VolumeBundle } from '../utils/api';
import {
  type SliceDistanceMeasurementSummary,
  type SliceInteractionMode,
  type SliceProbeSummary,
} from '../utils/viewerTools';
import type { HoverTarget } from '../utils/hoverDetails';
import { formatOrganName } from '../utils/hoverDetails';
import {
  buildSlicePixels,
  computeVoxelDistanceMm,
  fitSliceToViewport,
  getCrosshairCoordinates,
  getIntensityAtPlanePoint,
  getPlaneDisplayGeometry,
  getLabelAtPlanePoint,
  type SliceCursor,
  type SlicePoint,
  type SlicePlane,
  type VolumeSpacing,
  stepSliceCursor,
  updateCursorFromPlanePoint,
} from '../utils/sliceUtils';

interface SliceViewportProps {
  jobId: string;
  volume?: VolumeBundle;
  organs: OrganInfo[];
  requestedOrgans: Set<string>;
  displayedOrgans: Set<string>;
  activeHoverName: string | null;
  hoverDetailsEnabled: boolean;
  cursor: SliceCursor;
  windowCenter: number;
  windowWidth: number;
  anatomyLabelsEnabled: boolean;
  interactionMode: SliceInteractionMode;
  onCursorChange: (cursor: SliceCursor) => void;
  onHoverCandidateChange: (target: HoverTarget | null) => void;
  onDistanceMeasurementChange: (measurement: SliceDistanceMeasurementSummary | null) => void;
  onProbeChange: (probe: SliceProbeSummary | null) => void;
}

interface LoadedSliceVolume {
  intensityData: Int16Array;
  segmentationData: Uint16Array;
}

interface SlicePaneProps {
  plane: SlicePlane;
  title: string;
  accentColor: string;
  dimensions: [number, number, number];
  spacing: VolumeSpacing;
  intensityData: Int16Array;
  segmentationData: Uint16Array;
  organByLabel: Map<number, OrganInfo>;
  colorByLabel: Map<number, readonly [number, number, number]>;
  visibleLabels: Set<number>;
  focusedLabel: number | null;
  cursor: SliceCursor;
  hoverDetailsEnabled: boolean;
  windowCenter: number;
  windowWidth: number;
  anatomyLabelsEnabled: boolean;
  interactionMode: SliceInteractionMode;
  distanceMeasurement?: DistanceMeasurementState;
  probeSample?: PaneInteractionSample;
  onCursorChange: (cursor: SliceCursor) => void;
  onHoverCandidateChange: (target: HoverTarget | null) => void;
  onDistanceSample: (sample: PaneInteractionSample) => void;
  onProbeSample: (sample: PaneInteractionSample) => void;
}

interface PaneInteractionSample {
  plane: SlicePlane;
  planeX: number;
  planeY: number;
  point: SlicePoint;
  label: number;
  intensity: number;
  organName: string | null;
}

interface DistanceMeasurementState {
  start: PaneInteractionSample;
  end: PaneInteractionSample | null;
  distanceMm: number | null;
}

const DISABLED_CLIPPING: ClippingState = {
  axial: { enabled: false, value: 0.5 },
  coronal: { enabled: false, value: 0.5 },
  sagittal: { enabled: false, value: 0.5 },
};

const SLICE_VOLUME_CACHE = new Map<string, LoadedSliceVolume | Promise<LoadedSliceVolume>>();

function getVoxelCount(asset: VolumeAsset): number {
  return asset.dimensions[0] * asset.dimensions[1] * asset.dimensions[2];
}

function parseVolumeBuffer(buffer: ArrayBuffer, asset: VolumeAsset): Int16Array | Uint16Array {
  if (asset.byte_order !== 'little') {
    throw new Error(`Unsupported byte order: ${asset.byte_order}`);
  }

  if (asset.dtype === 'int16') {
    return new Int16Array(buffer);
  }

  if (asset.dtype === 'uint16') {
    return new Uint16Array(buffer);
  }

  throw new Error(`Unsupported volume dtype: ${asset.dtype}`);
}

async function fetchVolumeAsset(jobId: string, asset: VolumeAsset): Promise<Int16Array | Uint16Array> {
  const response = await fetch(getVolumeUrl(jobId, asset.file));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${asset.file}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const parsed = parseVolumeBuffer(arrayBuffer, asset);
  const expectedVoxelCount = getVoxelCount(asset);
  if (parsed.length !== expectedVoxelCount) {
    throw new Error(`Unexpected voxel count for ${asset.file}`);
  }

  return parsed;
}

async function loadSliceVolume(jobId: string, volume: VolumeBundle): Promise<LoadedSliceVolume> {
  const cacheKey = `${jobId}:${volume.intensity.file}:${volume.segmentation.file}`;
  const cached = SLICE_VOLUME_CACHE.get(cacheKey);
  if (cached) {
    return cached instanceof Promise ? cached : Promise.resolve(cached);
  }

  const pending = Promise.all([
    fetchVolumeAsset(jobId, volume.intensity),
    fetchVolumeAsset(jobId, volume.segmentation),
  ]).then(([intensityData, segmentationData]) => {
    const loaded = {
      intensityData: intensityData as Int16Array,
      segmentationData: segmentationData as Uint16Array,
    };
    SLICE_VOLUME_CACHE.set(cacheKey, loaded);
    return loaded;
  }).catch((error) => {
    SLICE_VOLUME_CACHE.delete(cacheKey);
    throw error;
  });

  SLICE_VOLUME_CACHE.set(cacheKey, pending);
  return pending;
}

function SlicePane({
  plane,
  title,
  accentColor,
  dimensions,
  spacing,
  intensityData,
  segmentationData,
  organByLabel,
  colorByLabel,
  visibleLabels,
  focusedLabel,
  cursor,
  hoverDetailsEnabled,
  windowCenter,
  windowWidth,
  anatomyLabelsEnabled,
  interactionMode,
  distanceMeasurement,
  probeSample,
  onCursorChange,
  onHoverCandidateChange,
  onDistanceSample,
  onProbeSample,
}: SlicePaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerDownRef = useRef(false);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });

  const planeGeometry = useMemo(
    () => getPlaneDisplayGeometry(plane, dimensions, spacing),
    [dimensions, plane, spacing],
  );

  const sliceRenderData = useMemo(
    () => buildSlicePixels({
      plane,
      cursor,
      dimensions,
      intensityData,
      segmentationData,
      visibleLabels,
      colorByLabel,
      focusedLabel,
      windowCenter,
      windowWidth,
      collectLabelAnchors: anatomyLabelsEnabled,
    }),
    [
      anatomyLabelsEnabled,
      colorByLabel,
      cursor,
      dimensions,
      focusedLabel,
      intensityData,
      plane,
      segmentationData,
      visibleLabels,
      windowCenter,
      windowWidth,
    ],
  );

  const fittedDisplay = useMemo(
    () => fitSliceToViewport(
      paneSize.width,
      paneSize.height,
      planeGeometry.displayWidth,
      planeGeometry.displayHeight,
    ),
    [paneSize.height, paneSize.width, planeGeometry.displayHeight, planeGeometry.displayWidth],
  );

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const node = containerRef.current;
    const updateSize = () => {
      setPaneSize({ width: node.clientWidth, height: node.clientHeight });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hoverDetailsEnabled) {
      onHoverCandidateChange(null);
    }
  }, [hoverDetailsEnabled, onHoverCandidateChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || paneSize.width <= 0 || paneSize.height <= 0) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(paneSize.width * dpr));
    canvas.height = Math.max(1, Math.round(paneSize.height * dpr));
    canvas.style.width = `${paneSize.width}px`;
    canvas.style.height = `${paneSize.height}px`;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.scale(dpr, dpr);
    context.imageSmoothingEnabled = false;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sliceRenderData.width;
    tempCanvas.height = sliceRenderData.height;
    const tempContext = tempCanvas.getContext('2d');
    if (!tempContext) {
      return;
    }

    tempContext.putImageData(
      new ImageData(new Uint8ClampedArray(sliceRenderData.pixels), sliceRenderData.width, sliceRenderData.height),
      0,
      0,
    );
    context.drawImage(
      tempCanvas,
      fittedDisplay.left,
      fittedDisplay.top,
      fittedDisplay.width,
      fittedDisplay.height,
    );

    const crosshair = getCrosshairCoordinates(plane, cursor);
    const crosshairX = fittedDisplay.left + ((crosshair.x + 0.5) / sliceRenderData.width) * fittedDisplay.width;
    const crosshairY = fittedDisplay.top + ((crosshair.y + 0.5) / sliceRenderData.height) * fittedDisplay.height;

    context.save();
    context.strokeStyle = accentColor;
    context.globalAlpha = 0.95;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(crosshairX, fittedDisplay.top);
    context.lineTo(crosshairX, fittedDisplay.top + fittedDisplay.height);
    context.moveTo(fittedDisplay.left, crosshairY);
    context.lineTo(fittedDisplay.left + fittedDisplay.width, crosshairY);
    context.stroke();
    context.restore();
  }, [
    accentColor,
    cursor,
    fittedDisplay,
    paneSize.height,
    paneSize.width,
    sliceRenderData,
  ]);

  const resolvePlanePoint = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }

    const bounds = container.getBoundingClientRect();
    if (fittedDisplay.width <= 0 || fittedDisplay.height <= 0) {
      return null;
    }

    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const withinX = localX >= fittedDisplay.left && localX <= fittedDisplay.left + fittedDisplay.width;
    const withinY = localY >= fittedDisplay.top && localY <= fittedDisplay.top + fittedDisplay.height;

    if (!withinX || !withinY) {
      return null;
    }

    const planeX = Math.floor(((localX - fittedDisplay.left) / fittedDisplay.width) * planeGeometry.pixelWidth);
    const planeY = Math.floor(((localY - fittedDisplay.top) / fittedDisplay.height) * planeGeometry.pixelHeight);

    return {
      x: Math.min(Math.max(planeX, 0), planeGeometry.pixelWidth - 1),
      y: Math.min(Math.max(planeY, 0), planeGeometry.pixelHeight - 1),
    };
  }, [fittedDisplay, planeGeometry.pixelHeight, planeGeometry.pixelWidth]);

  const buildInteractionSample = useCallback((planeX: number, planeY: number): PaneInteractionSample => {
    const { label, point } = getLabelAtPlanePoint(
      plane,
      cursor,
      planeX,
      planeY,
      dimensions,
      segmentationData,
    );
    const { intensity } = getIntensityAtPlanePoint(
      plane,
      cursor,
      planeX,
      planeY,
      dimensions,
      intensityData,
    );

    return {
      plane,
      planeX,
      planeY,
      point,
      label,
      intensity,
      organName: organByLabel.get(label)?.name ?? null,
    };
  }, [cursor, dimensions, intensityData, organByLabel, plane, segmentationData]);

  const emitHoverCandidate = useCallback((clientX: number, clientY: number, planeX: number, planeY: number) => {
    if (!hoverDetailsEnabled) {
      onHoverCandidateChange(null);
      return;
    }

    const { label } = getLabelAtPlanePoint(
      plane,
      cursor,
      planeX,
      planeY,
      dimensions,
      segmentationData,
    );
    const organ = organByLabel.get(label);

    if (!organ) {
      onHoverCandidateChange(null);
      return;
    }

    onHoverCandidateChange({
      name: organ.name,
      source: 'slice',
      pane: plane,
      clientX,
      clientY,
    });
  }, [
    cursor,
    dimensions,
    hoverDetailsEnabled,
    onHoverCandidateChange,
    organByLabel,
    plane,
    segmentationData,
  ]);

  const projectOverlayPoint = useCallback((planeX: number, planeY: number) => {
    if (fittedDisplay.width <= 0 || fittedDisplay.height <= 0) {
      return null;
    }

    return {
      left: fittedDisplay.left + ((planeX + 0.5) / sliceRenderData.width) * fittedDisplay.width,
      top: fittedDisplay.top + ((planeY + 0.5) / sliceRenderData.height) * fittedDisplay.height,
    };
  }, [fittedDisplay, sliceRenderData.height, sliceRenderData.width]);

  const anatomyLabels = useMemo(
    () => sliceRenderData.labelAnchors
      .filter((anchor) => anchor.count >= 12 || anchor.label === focusedLabel)
      .slice(0, 6)
      .map((anchor) => {
        const organ = organByLabel.get(anchor.label);
        const position = projectOverlayPoint(anchor.x, anchor.y);

        if (!organ || !position) {
          return null;
        }

        return {
          label: anchor.label,
          organ,
          position,
        };
      })
      .filter((label): label is { label: number; organ: OrganInfo; position: { left: number; top: number } } => label !== null),
    [focusedLabel, organByLabel, projectOverlayPoint, sliceRenderData.labelAnchors],
  );

  const measurementStartPosition = distanceMeasurement
    ? projectOverlayPoint(distanceMeasurement.start.planeX, distanceMeasurement.start.planeY)
    : null;
  const measurementEndPosition = distanceMeasurement?.end
    ? projectOverlayPoint(distanceMeasurement.end.planeX, distanceMeasurement.end.planeY)
    : null;
  const probePosition = probeSample
    ? projectOverlayPoint(probeSample.planeX, probeSample.planeY)
    : null;

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const planePoint = resolvePlanePoint(event.clientX, event.clientY);
    if (!planePoint) {
      return;
    }

    const applyCursorPoint = () => {
      startTransition(() => {
        onCursorChange(updateCursorFromPlanePoint(plane, cursor, planePoint.x, planePoint.y, dimensions));
      });
    };

    if (interactionMode === 'distance') {
      onHoverCandidateChange(null);
      applyCursorPoint();
      onDistanceSample(buildInteractionSample(planePoint.x, planePoint.y));
      return;
    }

    if (interactionMode === 'probe') {
      onHoverCandidateChange(null);
      applyCursorPoint();
      onProbeSample(buildInteractionSample(planePoint.x, planePoint.y));
      return;
    }

    pointerDownRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onHoverCandidateChange(null);
    startTransition(() => {
      onCursorChange(updateCursorFromPlanePoint(plane, cursor, planePoint.x, planePoint.y, dimensions));
    });
  }, [
    buildInteractionSample,
    cursor,
    dimensions,
    interactionMode,
    onCursorChange,
    onDistanceSample,
    onHoverCandidateChange,
    onProbeSample,
    plane,
    resolvePlanePoint,
  ]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const planePoint = resolvePlanePoint(event.clientX, event.clientY);
    if (!planePoint) {
      if (!pointerDownRef.current) {
        onHoverCandidateChange(null);
      }
      return;
    }

    if (pointerDownRef.current) {
      onHoverCandidateChange(null);
      startTransition(() => {
        onCursorChange(updateCursorFromPlanePoint(plane, cursor, planePoint.x, planePoint.y, dimensions));
      });
      return;
    }

    emitHoverCandidate(event.clientX, event.clientY, planePoint.x, planePoint.y);
  }, [
    cursor,
    dimensions,
    emitHoverCandidate,
    onCursorChange,
    onHoverCandidateChange,
    plane,
    resolvePlanePoint,
  ]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    pointerDownRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    pointerDownRef.current = false;
    onHoverCandidateChange(null);
  }, [onHoverCandidateChange]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    onHoverCandidateChange(null);
    startTransition(() => {
      onCursorChange(stepSliceCursor(cursor, plane, event.deltaY > 0 ? 1 : -1, dimensions));
    });
  }, [cursor, dimensions, onCursorChange, onHoverCandidateChange, plane]);

  return (
    <div className="relative min-h-0 overflow-hidden rounded-2xl border border-gray-800 bg-[#070b13] shadow-[0_18px_40px_rgba(2,6,23,0.3)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-gray-800/80 bg-slate-950/88 px-4 py-3 backdrop-blur-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Slice View
          </p>
          <p className="mt-1 text-sm font-semibold text-white">{title}</p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
          {Math.round(planeGeometry.displayWidth)} x {Math.round(planeGeometry.displayHeight)}
        </span>
      </div>
      <div
        ref={containerRef}
        className="absolute inset-0"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
        data-testid={`slice-pane-${plane}`}
      >
        <canvas ref={canvasRef} className="h-full w-full" />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {measurementStartPosition && (
            <circle
              cx={measurementStartPosition.left}
              cy={measurementStartPosition.top}
              r="5"
              fill="#f8fafc"
              stroke={accentColor}
              strokeWidth="2"
            />
          )}
          {measurementStartPosition && measurementEndPosition && (
            <>
              <line
                x1={measurementStartPosition.left}
                y1={measurementStartPosition.top}
                x2={measurementEndPosition.left}
                y2={measurementEndPosition.top}
                stroke="#f8fafc"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
              <circle
                cx={measurementEndPosition.left}
                cy={measurementEndPosition.top}
                r="5"
                fill="#f8fafc"
                stroke={accentColor}
                strokeWidth="2"
              />
            </>
          )}
          {probePosition && (
            <>
              <circle
                cx={probePosition.left}
                cy={probePosition.top}
                r="8"
                fill="rgba(15,23,42,0.72)"
                stroke="#38bdf8"
                strokeWidth="2"
              />
              <line
                x1={probePosition.left - 10}
                y1={probePosition.top}
                x2={probePosition.left + 10}
                y2={probePosition.top}
                stroke="#38bdf8"
                strokeWidth="1.5"
              />
              <line
                x1={probePosition.left}
                y1={probePosition.top - 10}
                x2={probePosition.left}
                y2={probePosition.top + 10}
                stroke="#38bdf8"
                strokeWidth="1.5"
              />
            </>
          )}
        </svg>
        {distanceMeasurement?.end && measurementEndPosition && distanceMeasurement.distanceMm !== null && (
          <div
            className="pointer-events-none absolute z-10 rounded-full border border-white/15 bg-slate-950/88 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.45)]"
            style={{
              left: `${(measurementStartPosition!.left + measurementEndPosition.left) / 2}px`,
              top: `${(measurementStartPosition!.top + measurementEndPosition.top) / 2 - 18}px`,
              transform: 'translate(-50%, -50%)',
            }}
            data-testid={`slice-distance-readout-${plane}`}
          >
            {distanceMeasurement.distanceMm.toFixed(1)} mm
          </div>
        )}
        {probeSample && probePosition && (
          <div
            className="pointer-events-none absolute z-10 rounded-2xl border border-sky-400/25 bg-slate-950/88 px-3 py-2 text-[11px] text-slate-100 shadow-[0_12px_28px_rgba(15,23,42,0.45)]"
            style={{
              left: `${probePosition.left + 14}px`,
              top: `${probePosition.top - 14}px`,
            }}
            data-testid={`slice-probe-readout-${plane}`}
          >
            <p className="font-semibold uppercase tracking-[0.18em] text-sky-200/85">Probe</p>
            <p className="mt-1 font-medium text-white">{probeSample.intensity} HU</p>
            <p className="mt-1 text-slate-400">
              {probeSample.organName ? formatOrganName(probeSample.organName) : 'Unlabeled tissue'}
            </p>
          </div>
        )}
        {anatomyLabelsEnabled && anatomyLabels.map(({ label, organ, position }) => (
          <div
            key={`${plane}-${label}`}
            className={`pointer-events-none absolute z-10 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] shadow-[0_8px_18px_rgba(2,6,23,0.45)] ${
              focusedLabel === label
                ? 'border-sky-300/60 bg-sky-400/18 text-sky-50'
                : 'border-white/10 bg-slate-950/82 text-slate-100'
            }`}
            style={{
              left: `${position.left}px`,
              top: `${position.top}px`,
              transform: 'translate(-50%, -50%)',
            }}
            data-testid={`slice-anatomy-label-${plane}-${organ.name}`}
          >
            {formatOrganName(organ.name)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SliceViewport({
  jobId,
  volume,
  organs,
  requestedOrgans,
  displayedOrgans,
  activeHoverName,
  hoverDetailsEnabled,
  cursor,
  windowCenter,
  windowWidth,
  anatomyLabelsEnabled,
  interactionMode,
  onCursorChange,
  onHoverCandidateChange,
  onDistanceMeasurementChange,
  onProbeChange,
}: SliceViewportProps) {
  const [loadedVolume, setLoadedVolume] = useState<{ key: string; data: LoadedSliceVolume } | null>(null);
  const [loadingError, setLoadingError] = useState<{ key: string; message: string } | null>(null);
  const [distanceMeasurements, setDistanceMeasurements] = useState<Partial<Record<SlicePlane, DistanceMeasurementState>>>({});
  const [probeSamples, setProbeSamples] = useState<Partial<Record<SlicePlane, PaneInteractionSample>>>({});
  const cacheKey = volume ? `${jobId}:${volume.intensity.file}:${volume.segmentation.file}` : null;

  useEffect(() => {
    if (!volume || !cacheKey) {
      return;
    }

    let cancelled = false;

    loadSliceVolume(jobId, volume)
      .then((nextVolume) => {
        if (!cancelled) {
          setLoadedVolume({ key: cacheKey, data: nextVolume });
          setLoadingError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadedVolume(null);
          setLoadingError({
            key: cacheKey,
            message: error instanceof Error ? error.message : 'Failed to load slice volumes',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, jobId, volume]);

  useEffect(() => {
    setDistanceMeasurements({});
    setProbeSamples({});
    onDistanceMeasurementChange(null);
    onProbeChange(null);
  }, [cacheKey, onDistanceMeasurementChange, onProbeChange]);

  useEffect(() => {
    setDistanceMeasurements({});
    setProbeSamples({});

    if (interactionMode !== 'distance') {
      onDistanceMeasurementChange(null);
    }
    if (interactionMode !== 'probe') {
      onProbeChange(null);
    }
  }, [interactionMode, onDistanceMeasurementChange, onProbeChange]);

  const organByLabel = useMemo(() => new Map(organs.map((organ) => [organ.id, organ])), [organs]);
  const organByName = useMemo(() => new Map(organs.map((organ) => [organ.name, organ])), [organs]);
  const colorByLabel = useMemo(
    () => new Map(organs.map((organ) => [organ.id, organ.color as [number, number, number]])),
    [organs],
  );
  const visibleLabels = useMemo(
    () => new Set(organs.filter((organ) => displayedOrgans.has(organ.name)).map((organ) => organ.id)),
    [displayedOrgans, organs],
  );
  const focusedLabel = activeHoverName ? organByName.get(activeHoverName)?.id ?? null : null;
  const resolvedVolume = loadedVolume?.key === cacheKey ? loadedVolume.data : null;
  const resolvedError = loadingError?.key === cacheKey ? loadingError.message : null;
  const isLoading = Boolean(volume && !resolvedVolume && !resolvedError);

  const handleDistanceSample = useCallback((sample: PaneInteractionSample) => {
    if (!volume) {
      return;
    }

    setDistanceMeasurements((prev) => {
      const current = prev[sample.plane];

      if (!current || current.end) {
        return {
          ...prev,
          [sample.plane]: {
            start: sample,
            end: null,
            distanceMm: null,
          },
        };
      }

      const distanceMm = computeVoxelDistanceMm(current.start.point, sample.point, volume.intensity.spacing);
      const nextMeasurement: DistanceMeasurementState = {
        start: current.start,
        end: sample,
        distanceMm,
      };

      onDistanceMeasurementChange({
        plane: sample.plane,
        start: current.start.point,
        end: sample.point,
        distanceMm,
      });

      return {
        ...prev,
        [sample.plane]: nextMeasurement,
      };
    });
  }, [onDistanceMeasurementChange, volume]);

  const handleProbeSample = useCallback((sample: PaneInteractionSample) => {
    setProbeSamples((prev) => ({
      ...prev,
      [sample.plane]: sample,
    }));
    onProbeChange({
      plane: sample.plane,
      point: sample.point,
      intensity: sample.intensity,
      label: sample.label,
      organName: sample.organName,
    });
  }, [onProbeChange]);

  if (!volume) {
    return (
      <div className="flex h-full items-center justify-center px-6 pb-24">
        <div className="max-w-lg rounded-3xl border border-gray-800 bg-slate-950/80 px-8 py-10 text-center shadow-[0_24px_60px_rgba(2,6,23,0.3)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            Slice Mode Unavailable
          </p>
          <p className="mt-3 text-lg font-semibold text-white">
            This study does not have exported slice volumes yet.
          </p>
        </div>
      </div>
    );
  }

  if (resolvedError) {
    return (
      <div className="flex h-full items-center justify-center px-6 pb-24">
        <div className="max-w-lg rounded-3xl border border-red-500/30 bg-slate-950/88 px-8 py-10 text-center shadow-[0_24px_60px_rgba(2,6,23,0.3)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-red-300/75">
            Slice Load Failed
          </p>
          <p className="mt-3 text-lg font-semibold text-white">{resolvedError}</p>
        </div>
      </div>
    );
  }

  if (isLoading || !resolvedVolume) {
    return (
      <div className="grid h-full grid-cols-2 grid-rows-2 gap-3 p-3 pb-24" data-testid="slice-viewport-loading">
        {['Axial', '3D Model', 'Coronal', 'Sagittal'].map((title) => (
          <div
            key={title}
            className="relative min-h-0 overflow-hidden rounded-2xl border border-gray-800 bg-[#070b13]"
          >
            <div className="absolute inset-x-0 top-0 border-b border-gray-800/80 bg-slate-950/88 px-4 py-3">
              <p className="text-sm font-semibold text-white">{title}</p>
            </div>
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Loading slice volume...
            </div>
          </div>
        ))}
      </div>
    );
  }


  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-3 p-3 pb-24" data-testid="slice-viewport">
      <SlicePane
        plane="axial"
        title="Axial"
        accentColor="#60a5fa"
        dimensions={volume.intensity.dimensions}
        spacing={volume.intensity.spacing}
        intensityData={resolvedVolume.intensityData}
        segmentationData={resolvedVolume.segmentationData}
        organByLabel={organByLabel}
        colorByLabel={colorByLabel}
        visibleLabels={visibleLabels}
        focusedLabel={focusedLabel}
        cursor={cursor}
        hoverDetailsEnabled={hoverDetailsEnabled}
        windowCenter={windowCenter}
        windowWidth={windowWidth}
        anatomyLabelsEnabled={anatomyLabelsEnabled}
        interactionMode={interactionMode}
        distanceMeasurement={distanceMeasurements.axial}
        probeSample={probeSamples.axial}
        onCursorChange={onCursorChange}
        onHoverCandidateChange={onHoverCandidateChange}
        onDistanceSample={handleDistanceSample}
        onProbeSample={handleProbeSample}
      />

      <div
        className="relative min-h-0 overflow-hidden rounded-2xl border border-gray-800 bg-[#070b13] shadow-[0_18px_40px_rgba(2,6,23,0.3)]"
        data-testid="slice-pane-model"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-gray-800/80 bg-slate-950/88 px-4 py-3 backdrop-blur-sm">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Interactive Pane
            </p>
            <p className="mt-1 text-sm font-semibold text-white">3D Model</p>
          </div>
          <span className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
            Hover-enabled
          </span>
        </div>
        <VTKRenderer
          jobId={jobId}
          organs={organs}
          requestedOrgans={requestedOrgans}
          displayedOrgans={displayedOrgans}
          clipping={DISABLED_CLIPPING}
          activeHoverName={activeHoverName}
          hoverDetailsEnabled={hoverDetailsEnabled}
          onHoverCandidateChange={onHoverCandidateChange}
        />
      </div>

      <SlicePane
        plane="coronal"
        title="Coronal"
        accentColor="#34d399"
        dimensions={volume.intensity.dimensions}
        spacing={volume.intensity.spacing}
        intensityData={resolvedVolume.intensityData}
        segmentationData={resolvedVolume.segmentationData}
        organByLabel={organByLabel}
        colorByLabel={colorByLabel}
        visibleLabels={visibleLabels}
        focusedLabel={focusedLabel}
        cursor={cursor}
        hoverDetailsEnabled={hoverDetailsEnabled}
        windowCenter={windowCenter}
        windowWidth={windowWidth}
        anatomyLabelsEnabled={anatomyLabelsEnabled}
        interactionMode={interactionMode}
        distanceMeasurement={distanceMeasurements.coronal}
        probeSample={probeSamples.coronal}
        onCursorChange={onCursorChange}
        onHoverCandidateChange={onHoverCandidateChange}
        onDistanceSample={handleDistanceSample}
        onProbeSample={handleProbeSample}
      />

      <SlicePane
        plane="sagittal"
        title="Sagittal"
        accentColor="#fb7185"
        dimensions={volume.intensity.dimensions}
        spacing={volume.intensity.spacing}
        intensityData={resolvedVolume.intensityData}
        segmentationData={resolvedVolume.segmentationData}
        organByLabel={organByLabel}
        colorByLabel={colorByLabel}
        visibleLabels={visibleLabels}
        focusedLabel={focusedLabel}
        cursor={cursor}
        hoverDetailsEnabled={hoverDetailsEnabled}
        windowCenter={windowCenter}
        windowWidth={windowWidth}
        anatomyLabelsEnabled={anatomyLabelsEnabled}
        interactionMode={interactionMode}
        distanceMeasurement={distanceMeasurements.sagittal}
        probeSample={probeSamples.sagittal}
        onCursorChange={onCursorChange}
        onHoverCandidateChange={onHoverCandidateChange}
        onDistanceSample={handleDistanceSample}
        onProbeSample={handleProbeSample}
      />
    </div>
  );
}