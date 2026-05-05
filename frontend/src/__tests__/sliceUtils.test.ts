import { describe, expect, it } from 'vitest';
import {
  buildSlicePixels,
  computeVoxelDistanceMm,
  createDefaultSliceCursor,
  getPlaneDisplayGeometry,
  getIntensityAtPlanePoint,
  getWindowPresetById,
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
    expect(overlay.labelAnchors).toEqual([]);
  });

  it('updates the crosshair position from an in-plane drag point', () => {
    const cursor = { z: 4, y: 5, x: 6 };
    const dimensions: [number, number, number] = [10, 12, 14];

    expect(updateCursorFromPlanePoint('axial', cursor, 8, 9, dimensions)).toEqual({ z: 4, y: 9, x: 8 });
    expect(updateCursorFromPlanePoint('sagittal', cursor, 4, 7, dimensions)).toEqual({ z: 7, y: 4, x: 6 });
  });

  it('looks up CT window presets by identifier with a soft-tissue fallback', () => {
    expect(getWindowPresetById('lung')).toMatchObject({ center: -600, width: 1500 });
    expect(getWindowPresetById('missing')).toMatchObject({ center: 50, width: 400 });
  });

  it('samples HU intensity at a plane coordinate', () => {
    const intensityData = new Int16Array([
      10, 20,
      30, 40,
    ]);

    expect(
      getIntensityAtPlanePoint('axial', { z: 0, y: 0, x: 0 }, 1, 0, [1, 2, 2], intensityData),
    ).toEqual({
      intensity: 20,
      point: { z: 0, y: 0, x: 1 },
    });
  });

  it('computes a spacing-aware voxel distance in millimeters', () => {
    expect(
      computeVoxelDistanceMm(
        { z: 2, y: 4, x: 5 },
        { z: 2, y: 7, x: 9 },
        [2.5, 1.5, 0.5],
      ),
    ).toBeCloseTo(Math.sqrt((3 * 1.5) ** 2 + (4 * 0.5) ** 2), 5);
  });

  it('collects slice label anchors when anatomy label extraction is enabled', () => {
    const result = buildSlicePixels({
      plane: 'axial',
      cursor: { z: 0, y: 0, x: 0 },
      dimensions: [1, 2, 3],
      intensityData: new Int16Array(6).fill(25),
      segmentationData: new Uint16Array([
        0, 4, 4,
        0, 4, 0,
      ]),
      visibleLabels: new Set([4]),
      colorByLabel: new Map([[4, [20, 200, 20] as const]]),
      focusedLabel: null,
      collectLabelAnchors: true,
    });

    expect(result.labelAnchors).toHaveLength(1);
    expect(result.labelAnchors[0]).toMatchObject({ label: 4, count: 3 });
    expect(result.labelAnchors[0].x).toBeCloseTo(1.3333, 3);
    expect(result.labelAnchors[0].y).toBeCloseTo(0.3333, 3);
  });
});