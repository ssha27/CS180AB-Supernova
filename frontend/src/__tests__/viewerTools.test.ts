import { describe, expect, it } from 'vitest';
import type { OrganInfo } from '../utils/api';
import {
  buildVisibleOrganNameSet,
  DEFAULT_VISIBILITY_PRESET_ID,
  filterOrgansByVisibilityPreset,
  formatIntensityRange,
  getDefaultSliceWindow,
  getIntensityRangeLabel,
  getIntensityUnit,
  getVisibilityPresetById,
} from '../utils/viewerTools';

const MOCK_ORGANS: OrganInfo[] = [
  { id: 1, name: 'spleen', color: [1, 2, 3], file: 'spleen.stl', vertex_count: 10, category: 'organs' },
  { id: 2, name: 'rib_left_1', color: [1, 2, 3], file: 'rib.stl', vertex_count: 10, category: 'bones' },
  { id: 3, name: 'aorta', color: [1, 2, 3], file: 'aorta.stl', vertex_count: 10, category: 'vessels' },
  { id: 4, name: 'gluteus_maximus_left', color: [1, 2, 3], file: 'gluteus.stl', vertex_count: 10, category: 'muscles' },
];

describe('viewerTools', () => {
  it('falls back to the all preset when the preset id is unknown', () => {
    expect(getVisibilityPresetById('missing').id).toBe(DEFAULT_VISIBILITY_PRESET_ID);
  });

  it('filters the returned organs for the bones preset', () => {
    expect(filterOrgansByVisibilityPreset(MOCK_ORGANS, 'bones').map((organ) => organ.name)).toEqual([
      'rib_left_1',
    ]);
  });

  it('filters the returned organs for the organs preset', () => {
    expect(filterOrgansByVisibilityPreset(MOCK_ORGANS, 'organs').map((organ) => organ.name)).toEqual([
      'spleen',
    ]);
  });

  it('filters the returned organs for the muscles preset', () => {
    expect(filterOrgansByVisibilityPreset(MOCK_ORGANS, 'muscles').map((organ) => organ.name)).toEqual([
      'gluteus_maximus_left',
    ]);
  });

  it('returns every organ for the all preset', () => {
    expect(filterOrgansByVisibilityPreset(MOCK_ORGANS, 'all')).toHaveLength(4);
  });

  it('builds a visible organ set from the preset-filtered organs', () => {
    expect(Array.from(buildVisibleOrganNameSet(MOCK_ORGANS, 'bones'))).toEqual(['rib_left_1']);
  });

  it('uses a generic intensity unit for MRI studies', () => {
    expect(getIntensityUnit({ study: { modality: 'MR' }, intensity_unit: 'signal' })).toBe('signal');
  });

  it('formats MRI intensity ranges without HU wording', () => {
    expect(getIntensityRangeLabel({ study: { modality: 'MR' }, intensity_unit: 'signal' })).toBe('Intensity Range');
    expect(formatIntensityRange({ min_value: 120, max_value: 480 })).toBe('120 to 480');
  });

  it('derives a full-range slice window for MRI studies', () => {
    expect(getDefaultSliceWindow({ study: { modality: 'MR' }, min_value: 100, max_value: 300 })).toEqual({
      center: 200,
      width: 200,
    });
  });
});