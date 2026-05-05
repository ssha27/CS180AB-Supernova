import type { OrganInfo } from './api';
import type { SlicePlane, SlicePoint } from './sliceUtils';

export type VisibilityPresetId = 'all' | 'bones' | 'organs' | 'muscles';

export interface VisibilityPreset {
  id: VisibilityPresetId;
  label: string;
  categories: string[] | null;
  description: string;
}

export const DEFAULT_VISIBILITY_PRESET_ID: VisibilityPresetId = 'all';

export const VISIBILITY_PRESETS: VisibilityPreset[] = [
  {
    id: DEFAULT_VISIBILITY_PRESET_ID,
    label: 'All',
    categories: null,
    description: 'Show all returned anatomy, including organs, bones, vessels, muscles, and other structures.',
  },
  {
    id: 'bones',
    label: 'Bones',
    categories: ['bones'],
    description: 'Focus the viewer and organ list on skeletal anatomy only.',
  },
  {
    id: 'organs',
    label: 'Organs',
    categories: ['organs'],
    description: 'Focus the viewer and organ list on soft-tissue organs only.',
  },
  {
    id: 'muscles',
    label: 'Muscles',
    categories: ['muscles'],
    description: 'Focus the viewer and organ list on segmented muscular anatomy only.',
  },
];

export type SliceInteractionMode = 'navigate' | 'distance' | 'probe';

export interface SliceDistanceMeasurementSummary {
  plane: SlicePlane;
  start: SlicePoint;
  end: SlicePoint;
  distanceMm: number;
}

export interface SliceProbeSummary {
  plane: SlicePlane;
  point: SlicePoint;
  intensity: number;
  label: number;
  organName: string | null;
}

export function getVisibilityPresetById(id: string): VisibilityPreset {
  return VISIBILITY_PRESETS.find((preset) => preset.id === id) ?? VISIBILITY_PRESETS[0];
}

export function filterOrgansByVisibilityPreset(
  organs: OrganInfo[],
  presetId: VisibilityPresetId,
): OrganInfo[] {
  const preset = getVisibilityPresetById(presetId);

  if (!preset.categories) {
    return organs;
  }

  const allowedCategories = new Set(preset.categories.map((category) => category.toLowerCase()));
  return organs.filter((organ) => allowedCategories.has(organ.category.toLowerCase()));
}

export function buildVisibleOrganNameSet(
  organs: OrganInfo[],
  presetId: VisibilityPresetId,
): Set<string> {
  return new Set(filterOrgansByVisibilityPreset(organs, presetId).map((organ) => organ.name));
}

export function formatStudyDate(raw: string | null | undefined): string {
  if (!raw) {
    return 'Unavailable';
  }

  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  return raw;
}

export function formatPatientName(raw: string | null | undefined): string {
  if (!raw) {
    return 'Unavailable';
  }

  return raw
    .split('^')
    .filter(Boolean)
    .join(' ');
}