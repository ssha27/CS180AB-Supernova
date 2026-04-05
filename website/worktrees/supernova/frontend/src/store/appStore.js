import { create } from 'zustand'

/**
 * Module-level cache for heavy binary data.
 * Kept outside Zustand to avoid proxy/snapshot overhead and extra references to large buffers.
 */
export const heavyDataCache = {
  volumeScalars: null,   // Float32Array — zero-copy view over the server ArrayBuffer
  surfaceBuffer: null,   // ArrayBuffer (set lazily, freed after vtk parse)
  segmentBuffers: {},    // { structureName: ArrayBuffer } — cached organ mesh data
}

/**
 * Upload state machine:
 * idle → uploading → processing → ready → viewing
 * Any state can transition to → error
 * error → idle (on retry/reset)
 */

const VALID_EXTENSIONS = ['.dcm', '.zip']
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024 // 5GB

export const UPLOAD_STATES = {
  IDLE: 'idle',
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  READY: 'ready',
  VIEWING: 'viewing',
  ERROR: 'error',
}

export const VIEW_MODES = {
  VOLUME: 'volume',
  SURFACE: 'surface',
}

export const SLICE_AXES = {
  AXIAL: 'axial',
  SAGITTAL: 'sagittal',
  CORONAL: 'coronal',
}

export const OPACITY_PRESETS = {
  SKIN: 'skin',
  MUSCLE: 'muscle',
  BONE: 'bone',
}

export const useAppStore = create((set, get) => ({
  // Upload state
  uploadState: UPLOAD_STATES.IDLE,
  uploadProgress: 0,
  processingProgress: 0,
  errorMessage: null,

  // File info
  files: [],
  jobId: null,

  // Viewer state
  viewMode: VIEW_MODES.VOLUME,
  volumeData: null,
  surfaceData: null,
  surfaceAvailable: false,
  metadata: null,
  is2DFallback: false,
  fallbackMessage: null,

  // Interaction state
  clipPlanes: {
    axial: { enabled: false, value: 0.5 },
    sagittal: { enabled: false, value: 0.5 },
    coronal: { enabled: false, value: 0.5 },
  },
  isFlippedH: false,
  isFlippedV: false,
  currentSliceIndex: 0,
  totalSlices: 0,
  sliceAxis: 'axial',
  opacityPreset: 'skin',
  opacityMultiplier: 1.0,

  // Organ segmentation state
  segmentsAvailable: false,
  segmentManifest: [],        // Array of {name, displayName, color, file, fileSize}
  activeSegments: new Set(),  // Set of currently visible structure names
  segmentLoadingSet: new Set(), // Set of structures currently being fetched

  // Actions
  setUploadState: (state) => set({ uploadState: state }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  setProcessingProgress: (progress) => set({ processingProgress: progress }),

  setError: (message) =>
    set({
      uploadState: UPLOAD_STATES.ERROR,
      errorMessage: message,
    }),

  reset: () => {
    heavyDataCache.volumeScalars = null
    heavyDataCache.surfaceBuffer = null
    heavyDataCache.segmentBuffers = {}
    set({
      uploadState: UPLOAD_STATES.IDLE,
      uploadProgress: 0,
      processingProgress: 0,
      errorMessage: null,
      files: [],
      jobId: null,
      volumeData: null,
      surfaceData: null,
      surfaceAvailable: false,
      metadata: null,
      is2DFallback: false,
      fallbackMessage: null,
      isFlippedH: false,
      isFlippedV: false,
      currentSliceIndex: 0,
      sliceAxis: 'axial',
      opacityPreset: 'skin',
      opacityMultiplier: 1.0,
      segmentsAvailable: false,
      segmentManifest: [],
      activeSegments: new Set(),
      segmentLoadingSet: new Set(),
    })
  },

  setFiles: (files) => set({ files }),
  setJobId: (jobId) => set({ jobId }),

  setViewMode: (mode) => set({ viewMode: mode }),
  setVolumeData: (data) => set({ volumeData: data }),
  setSurfaceData: (data) => set({ surfaceData: data }),
  setMetadata: (metadata) => set({ metadata }),

  set2DFallback: (message) =>
    set({
      is2DFallback: true,
      fallbackMessage: message,
    }),

  toggleFlipH: () => set((state) => ({ isFlippedH: !state.isFlippedH })),
  toggleFlipV: () => set((state) => ({ isFlippedV: !state.isFlippedV })),

  setClipPlane: (plane, updates) =>
    set((state) => ({
      clipPlanes: {
        ...state.clipPlanes,
        [plane]: { ...state.clipPlanes[plane], ...updates },
      },
    })),

  setCurrentSliceIndex: (index) => set({ currentSliceIndex: index }),
  setTotalSlices: (total) => set({ totalSlices: total }),
  setSliceAxis: (axis) => set({ sliceAxis: axis, currentSliceIndex: 0 }),
  setOpacityPreset: (preset) => set({ opacityPreset: preset }),
  setOpacityMultiplier: (value) => set({ opacityMultiplier: value }),

  // Segment actions
  setSegmentsAvailable: (available) => set({ segmentsAvailable: available }),
  setSegmentManifest: (manifest) => set({ segmentManifest: manifest }),

  toggleSegment: (name) => set((state) => {
    const next = new Set(state.activeSegments)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    return { activeSegments: next }
  }),

  showOnlySegment: (name) => set(() => {
    return { activeSegments: new Set([name]) }
  }),

  showAllSegments: () => set((state) => {
    const all = new Set(state.segmentManifest.map((s) => s.name))
    return { activeSegments: all }
  }),

  clearSegments: () => set({ activeSegments: new Set() }),

  setSegmentLoading: (name, loading) => set((state) => {
    const next = new Set(state.segmentLoadingSet)
    if (loading) {
      next.add(name)
    } else {
      next.delete(name)
    }
    return { segmentLoadingSet: next }
  }),

  // Computed helpers
  setViewerData: ({ volumeData, surfaceAvailable, metadata, totalSlices, is2DFallback, fallbackMessage }) =>
    set({
      uploadState: is2DFallback ? UPLOAD_STATES.VIEWING : UPLOAD_STATES.READY,
      volumeData: volumeData || null,
      surfaceAvailable: surfaceAvailable || false,
      metadata: metadata || null,
      totalSlices: totalSlices || 0,
      is2DFallback: is2DFallback || false,
      fallbackMessage: fallbackMessage || null,
    }),
}))

// Validation utilities
export function validateFiles(files) {
  const errors = []

  if (!files || files.length === 0) {
    errors.push('No files selected')
    return { valid: false, errors }
  }

  let totalSize = 0
  for (const file of files) {
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (!VALID_EXTENSIONS.includes(ext)) {
      errors.push(`Invalid file type: ${file.name}. Only .dcm and .zip files are accepted.`)
    }
    totalSize += file.size
  }

  if (totalSize > MAX_FILE_SIZE) {
    const sizeGB = (totalSize / (1024 * 1024 * 1024)).toFixed(2)
    errors.push(`Total file size (${sizeGB} GB) exceeds the 5 GB limit.`)
  }

  return { valid: errors.length === 0, errors }
}
