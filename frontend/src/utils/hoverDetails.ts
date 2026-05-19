export type HoverSource = 'renderer' | 'sidebar' | 'slice';

export interface HoverTarget {
  name: string;
  source: HoverSource;
  pane?: 'axial' | 'coronal' | 'sagittal';
  clientX: number;
  clientY: number;
}

export const HOVER_DWELL_MS = 2000;

const SPECIFIC_DESCRIPTIONS: Record<string, string> = {
  spleen: 'Filters blood, supports immune activity, and helps recycle aging blood cells.',
  liver: 'Processes nutrients, stores energy, and helps clear toxins from the bloodstream.',
  stomach: 'Breaks down food mechanically and chemically before it enters the small intestine.',
  pancreas: 'Produces digestive enzymes and hormones that help regulate blood sugar.',
  heart: 'Pumps oxygenated blood through the body and returns deoxygenated blood to the lungs.',
  esophagus: 'Carries swallowed food and liquid from the throat into the stomach.',
  duodenum: 'Receives food from the stomach and mixes it with bile and pancreatic enzymes.',
  colon: 'Absorbs water and electrolytes while compacting waste for elimination.',
  'small bowel': 'Continues digestion and absorbs most nutrients from digested food.',
  'urinary bladder': 'Stores urine until it can be released from the body.',
  prostate: 'Produces fluid that nourishes and protects sperm.',
  aorta: 'Main artery carrying oxygen-rich blood from the heart to the systemic circulation.',
  sacrum: 'Anchors the spine to the pelvis and helps transfer body weight into the hips.',
};

const CATEGORY_FALLBACKS: Record<string, string> = {
  organs: 'A soft-tissue structure that contributes to a core body function.',
  bones: 'Part of the skeletal framework that provides support, protection, and leverage.',
  vessels: 'A blood vessel that helps distribute blood to or from surrounding anatomy.',
  muscles: 'A contractile structure that supports movement, posture, or stability.',
};

function normalizeOrganName(name: string): string {
  return name.toLowerCase().replace(/_/g, ' ').trim();
}

export function formatOrganName(name: string): string {
  return normalizeOrganName(name).replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getOrganDescription(name: string, category?: string): string {
  const normalized = normalizeOrganName(name);

  if (SPECIFIC_DESCRIPTIONS[normalized]) {
    return SPECIFIC_DESCRIPTIONS[normalized];
  }

  if (/^kidney\b/.test(normalized)) {
    return 'Filters waste from the blood and helps regulate fluid, electrolyte, and acid-base balance.';
  }
  if (/^adrenal gland\b/.test(normalized)) {
    return 'Releases hormones that help regulate metabolism, stress response, and blood pressure.';
  }
  if (/^lung\b/.test(normalized)) {
    return 'Supports gas exchange by moving oxygen into the blood and carbon dioxide out of it.';
  }
  if (/^rib\b/.test(normalized)) {
    return 'Forms part of the thoracic cage that protects the heart and lungs during breathing.';
  }
  if (/^vertebrae\b/.test(normalized)) {
    return 'A spinal segment that supports posture while protecting the spinal canal.';
  }
  if (/^femur\b/.test(normalized)) {
    return 'The thigh bone, responsible for major load-bearing and lower-limb movement.';
  }
  if (/^hip\b/.test(normalized)) {
    return 'Part of the pelvic joint complex that stabilizes the trunk and transfers force into the legs.';
  }

  if (category) {
    const fallback = CATEGORY_FALLBACKS[category.toLowerCase()];
    if (fallback) {
      return fallback;
    }
  }

  return 'Description not added currently.';
}