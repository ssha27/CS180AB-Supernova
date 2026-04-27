export type SlicePlane = 'axial' | 'coronal' | 'sagittal';

export interface SliceCursor {
  z: number;
  y: number;
  x: number;
}

export type VolumeDimensions = [number, number, number];
export type VolumeSpacing = [number, number, number];

export interface SlicePoint {
  z: number;
  y: number;
  x: number;
}

export interface SliceViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SlicePixelOptions {
  plane: SlicePlane;
  cursor: SliceCursor;
  dimensions: VolumeDimensions;
  intensityData: Int16Array;
  segmentationData: Uint16Array;
  visibleLabels: Set<number>;
  colorByLabel: Map<number, readonly [number, number, number]>;
  focusedLabel: number | null;
  windowCenter?: number;
  windowWidth?: number;
}

const DEFAULT_WINDOW_CENTER = 50;
const DEFAULT_WINDOW_WIDTH = 400;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function createDefaultSliceCursor(dimensions: VolumeDimensions): SliceCursor {
  return {
    z: Math.floor((dimensions[0] - 1) / 2),
    y: Math.floor((dimensions[1] - 1) / 2),
    x: Math.floor((dimensions[2] - 1) / 2),
  };
}

export function clampSliceCursor(cursor: SliceCursor, dimensions: VolumeDimensions): SliceCursor {
  return {
    z: clamp(cursor.z, 0, dimensions[0] - 1),
    y: clamp(cursor.y, 0, dimensions[1] - 1),
    x: clamp(cursor.x, 0, dimensions[2] - 1),
  };
}

export function getPlaneGeometry(plane: SlicePlane, dimensions: VolumeDimensions) {
  switch (plane) {
    case 'axial':
      return {
        width: dimensions[2],
        height: dimensions[1],
      };
    case 'coronal':
      return {
        width: dimensions[2],
        height: dimensions[0],
      };
    case 'sagittal':
      return {
        width: dimensions[1],
        height: dimensions[0],
      };
  }
}

export function getPlaneDisplayGeometry(
  plane: SlicePlane,
  dimensions: VolumeDimensions,
  spacing: VolumeSpacing,
  longestEdge: number = 512,
) {
  const pixelGeometry = getPlaneGeometry(plane, dimensions);

  let physicalWidth = pixelGeometry.width;
  let physicalHeight = pixelGeometry.height;

  switch (plane) {
    case 'axial':
      physicalWidth = pixelGeometry.width * spacing[2];
      physicalHeight = pixelGeometry.height * spacing[1];
      break;
    case 'coronal':
      physicalWidth = pixelGeometry.width * spacing[2];
      physicalHeight = pixelGeometry.height * spacing[0];
      break;
    case 'sagittal':
      physicalWidth = pixelGeometry.width * spacing[1];
      physicalHeight = pixelGeometry.height * spacing[0];
      break;
  }

  const scale = longestEdge / Math.max(physicalWidth, physicalHeight, 1);

  return {
    pixelWidth: pixelGeometry.width,
    pixelHeight: pixelGeometry.height,
    displayWidth: Math.max(1, physicalWidth * scale),
    displayHeight: Math.max(1, physicalHeight * scale),
  };
}

export function fitSliceToViewport(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
): SliceViewportRect {
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const scale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    left: (viewportWidth - width) / 2,
    top: (viewportHeight - height) / 2,
    width,
    height,
  };
}

export function sampleSlicePoint(
  plane: SlicePlane,
  cursor: SliceCursor,
  planeX: number,
  planeY: number,
  dimensions: VolumeDimensions,
): SlicePoint {
  const geometry = getPlaneGeometry(plane, dimensions);
  const boundedX = clamp(Math.round(planeX), 0, geometry.width - 1);
  const boundedY = clamp(Math.round(planeY), 0, geometry.height - 1);

  switch (plane) {
    case 'axial':
      return { z: cursor.z, y: boundedY, x: boundedX };
    case 'coronal':
      return { z: boundedY, y: cursor.y, x: boundedX };
    case 'sagittal':
      return { z: boundedY, y: boundedX, x: cursor.x };
  }
}

export function updateCursorFromPlanePoint(
  plane: SlicePlane,
  cursor: SliceCursor,
  planeX: number,
  planeY: number,
  dimensions: VolumeDimensions,
): SliceCursor {
  const point = sampleSlicePoint(plane, cursor, planeX, planeY, dimensions);
  return clampSliceCursor(point, dimensions);
}

export function stepSliceCursor(
  cursor: SliceCursor,
  plane: SlicePlane,
  delta: number,
  dimensions: VolumeDimensions,
): SliceCursor {
  if (delta === 0) {
    return cursor;
  }

  if (plane === 'axial') {
    return clampSliceCursor({ ...cursor, z: cursor.z + delta }, dimensions);
  }

  if (plane === 'coronal') {
    return clampSliceCursor({ ...cursor, y: cursor.y + delta }, dimensions);
  }

  return clampSliceCursor({ ...cursor, x: cursor.x + delta }, dimensions);
}

export function getCrosshairCoordinates(plane: SlicePlane, cursor: SliceCursor) {
  if (plane === 'axial') {
    return { x: cursor.x, y: cursor.y };
  }

  if (plane === 'coronal') {
    return { x: cursor.x, y: cursor.z };
  }

  return { x: cursor.y, y: cursor.z };
}

export function getVolumeIndex(dimensions: VolumeDimensions, point: SlicePoint): number {
  return point.z * dimensions[1] * dimensions[2] + point.y * dimensions[2] + point.x;
}

export function getLabelAtPlanePoint(
  plane: SlicePlane,
  cursor: SliceCursor,
  planeX: number,
  planeY: number,
  dimensions: VolumeDimensions,
  segmentationData: Uint16Array,
): { label: number; point: SlicePoint } {
  const point = sampleSlicePoint(plane, cursor, planeX, planeY, dimensions);
  const index = getVolumeIndex(dimensions, point);
  return {
    label: segmentationData[index] ?? 0,
    point,
  };
}

function windowHUValue(value: number, windowCenter: number, windowWidth: number): number {
  const lower = windowCenter - windowWidth / 2;
  const normalized = (value - lower) / Math.max(windowWidth, 1);
  return Math.round(clamp(normalized, 0, 1) * 255);
}

function blendChannel(base: number, overlay: number, alpha: number): number {
  return Math.round(base * (1 - alpha) + overlay * alpha);
}

export function buildSlicePixels({
  plane,
  cursor,
  dimensions,
  intensityData,
  segmentationData,
  visibleLabels,
  colorByLabel,
  focusedLabel,
  windowCenter = DEFAULT_WINDOW_CENTER,
  windowWidth = DEFAULT_WINDOW_WIDTH,
}: SlicePixelOptions): { width: number; height: number; pixels: Uint8ClampedArray } {
  const { width, height } = getPlaneGeometry(plane, dimensions);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const hasFocus = focusedLabel !== null;

  for (let planeY = 0; planeY < height; planeY += 1) {
    for (let planeX = 0; planeX < width; planeX += 1) {
      const point = sampleSlicePoint(plane, cursor, planeX, planeY, dimensions);
      const index = getVolumeIndex(dimensions, point);
      const grayscale = windowHUValue(intensityData[index] ?? 0, windowCenter, windowWidth);
      const pixelOffset = (planeY * width + planeX) * 4;

      let red = grayscale;
      let green = grayscale;
      let blue = grayscale;

      const label = segmentationData[index] ?? 0;
      if (label !== 0 && visibleLabels.has(label)) {
        const color = colorByLabel.get(label);
        if (color) {
          const alpha = hasFocus
            ? (label === focusedLabel ? 0.88 : 0.28)
            : 0.6;
          red = blendChannel(grayscale, color[0], alpha);
          green = blendChannel(grayscale, color[1], alpha);
          blue = blendChannel(grayscale, color[2], alpha);
        }
      }

      pixels[pixelOffset] = red;
      pixels[pixelOffset + 1] = green;
      pixels[pixelOffset + 2] = blue;
      pixels[pixelOffset + 3] = 255;
    }
  }

  return { width, height, pixels };
}