import { describe, expect, it } from 'vitest';
import {
  buildSlicePixels,
  createDefaultSliceCursor,
  getPlaneDisplayGeometry,
  sampleSlicePoint,
  stepSliceCursor,
  updateCursorFromPlanePoint,
} from '../utils/sliceUtils';

describe('sliceUtils', () => {
  it('creates a centered default cursor from volume dimensions', () => {
    expect(createDefaultSliceCursor([10, 12, 14])).toEqual({ z: 4, y: 5, x: 6 });
  });

  it('maps plane coordinates into voxel coordinates for each slice plane', () => {
    const cursor = { z: 4, y: 5, x: 6 };
    const dimensions: [number, number, number] = [10, 12, 14];

    expect(sampleSlicePoint('axial', cursor, 2, 3, dimensions)).toEqual({ z: 4, y: 3, x: 2 });
    expect(sampleSlicePoint('coronal', cursor, 2, 3, dimensions)).toEqual({ z: 3, y: 5, x: 2 });
    expect(sampleSlicePoint('sagittal', cursor, 2, 3, dimensions)).toEqual({ z: 3, y: 2, x: 6 });
  });

  it('updates the correct fixed axis when stepping through slices', () => {
    const cursor = { z: 4, y: 5, x: 6 };
    const dimensions: [number, number, number] = [10, 12, 14];

    expect(stepSliceCursor(cursor, 'axial', 2, dimensions)).toEqual({ z: 6, y: 5, x: 6 });
    expect(stepSliceCursor(cursor, 'coronal', -2, dimensions)).toEqual({ z: 4, y: 3, x: 6 });
    expect(stepSliceCursor(cursor, 'sagittal', 3, dimensions)).toEqual({ z: 4, y: 5, x: 9 });
  });

  it('computes spacing-aware display geometry for orthogonal panes', () => {
    const dimensions: [number, number, number] = [85, 512, 512];
    const spacing: [number, number, number] = [6, 1, 1];

    const axial = getPlaneDisplayGeometry('axial', dimensions, spacing);
    const coronal = getPlaneDisplayGeometry('coronal', dimensions, spacing);
    const sagittal = getPlaneDisplayGeometry('sagittal', dimensions, spacing);

    expect(axial.displayWidth).toBe(512);
    expect(axial.displayHeight).toBe(512);
    expect(coronal.displayWidth).toBe(512);
    expect(coronal.displayHeight).toBeCloseTo(510, 5);
    expect(sagittal.displayWidth).toBe(512);
    expect(sagittal.displayHeight).toBeCloseTo(510, 5);
  });

  it('blends visible segmentation labels over the grayscale CT slice', () => {
    const dimensions: [number, number, number] = [1, 1, 1];
    const cursor = { z: 0, y: 0, x: 0 };
    const intensityData = new Int16Array([50]);
    const segmentationData = new Uint16Array([7]);

    const overlay = buildSlicePixels({
      plane: 'axial',
      cursor,
      dimensions,
      intensityData,
      segmentationData,
      visibleLabels: new Set([7]),
      colorByLabel: new Map([[7, [220, 20, 20] as const]]),
      focusedLabel: null,
    });
    const noOverlay = buildSlicePixels({
      plane: 'axial',
      cursor,
      dimensions,
      intensityData,
      segmentationData,
      visibleLabels: new Set(),
      colorByLabel: new Map([[7, [220, 20, 20] as const]]),
      focusedLabel: null,
    });

    expect(overlay.pixels[0]).toBeGreaterThan(noOverlay.pixels[0]);
    expect(overlay.pixels[1]).toBeLessThan(noOverlay.pixels[1]);
    expect(overlay.pixels[3]).toBe(255);
  });

  it('updates the crosshair position from an in-plane drag point', () => {
    const cursor = { z: 4, y: 5, x: 6 };
    const dimensions: [number, number, number] = [10, 12, 14];

    expect(updateCursorFromPlanePoint('axial', cursor, 8, 9, dimensions)).toEqual({ z: 4, y: 9, x: 8 });
    expect(updateCursorFromPlanePoint('sagittal', cursor, 4, 7, dimensions)).toEqual({ z: 7, y: 4, x: 6 });
  });
});