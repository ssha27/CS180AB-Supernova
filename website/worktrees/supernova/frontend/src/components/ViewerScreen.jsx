import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAppStore, VIEW_MODES, UPLOAD_STATES, heavyDataCache } from '../store/appStore'
import { fetchSurfaceData, fetchSegmentManifest, fetchSegmentMesh, getJobStatus, fetchVolumeData, fetchVolumeInfo, fetchMetadata } from '../services/api'
import './ViewerScreen.css'

// vtk.js imports — loaded dynamically to avoid SSR issues
let vtkFullScreenRenderWindow,
  vtkVolume,
  vtkVolumeMapper,
  vtkImageData,
  vtkDataArray,
  vtkColorTransferFunction,
  vtkPiecewiseFunction,
  vtkPlane,
  vtkActor,
  vtkMapper,
  vtkXMLPolyDataReader

async function loadVtkModules() {
  const vtk = await import('@kitware/vtk.js')

  // Rendering
  const renderingModule = await import(
    '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow'
  )
  vtkFullScreenRenderWindow = renderingModule.default

  // Volume rendering
  const volumeModule = await import('@kitware/vtk.js/Rendering/Core/Volume')
  vtkVolume = volumeModule.default

  const volumeMapperModule = await import(
    '@kitware/vtk.js/Rendering/Core/VolumeMapper'
  )
  vtkVolumeMapper = volumeMapperModule.default

  // Data
  const imageDataModule = await import('@kitware/vtk.js/Common/DataModel/ImageData')
  vtkImageData = imageDataModule.default

  // DataArray for scalar data
  const dataArrayModule = await import('@kitware/vtk.js/Common/Core/DataArray')
  vtkDataArray = dataArrayModule.default

  // Transfer functions
  const ctfModule = await import(
    '@kitware/vtk.js/Rendering/Core/ColorTransferFunction'
  )
  vtkColorTransferFunction = ctfModule.default

  const pwfModule = await import(
    '@kitware/vtk.js/Common/DataModel/PiecewiseFunction'
  )
  vtkPiecewiseFunction = pwfModule.default

  // Surface rendering
  const actorModule = await import('@kitware/vtk.js/Rendering/Core/Actor')
  vtkActor = actorModule.default

  const mapperModule = await import('@kitware/vtk.js/Rendering/Core/Mapper')
  vtkMapper = mapperModule.default

  // VTP reader for surface meshes
  const vtpReaderModule = await import('@kitware/vtk.js/IO/XML/XMLPolyDataReader')
  vtkXMLPolyDataReader = vtpReaderModule.default

  // Clipping
  const planeModule = await import('@kitware/vtk.js/Common/DataModel/Plane')
  vtkPlane = planeModule.default

  return vtk
}

/**
 * CT opacity presets for different tissue types.
 * Each preset defines color and opacity transfer functions using Hounsfield units.
 * The opacity values can be scaled by the opacityMultiplier.
 */
const CT_OPACITY_PRESETS = {
  skin: {
    label: 'Skin',
    color: [
      [-1000, 0, 0, 0],
      [-500, 0.6, 0.4, 0.3],
      [-100, 0.85, 0.65, 0.55],
      [0, 0.9, 0.72, 0.6],
      [100, 0.85, 0.6, 0.5],
      [500, 0.95, 0.88, 0.8],
      [1500, 1, 1, 0.95],
    ],
    opacity: [
      [-1000, 0],
      [-500, 0],
      [-300, 0],
      [-100, 0.3],
      [0, 0.45],
      [100, 0.5],
      [500, 0.6],
      [1500, 0.85],
    ],
  },
  muscle: {
    label: 'Muscle',
    color: [
      [-1000, 0, 0, 0],
      [-100, 0.4, 0.15, 0.1],
      [0, 0.7, 0.3, 0.25],
      [50, 0.8, 0.4, 0.3],
      [200, 0.9, 0.6, 0.5],
      [500, 0.95, 0.85, 0.75],
      [1500, 1, 1, 0.95],
    ],
    opacity: [
      [-1000, 0],
      [-200, 0],
      [-50, 0],
      [0, 0.1],
      [50, 0.35],
      [200, 0.5],
      [500, 0.6],
      [1500, 0.85],
    ],
  },
  bone: {
    label: 'Bone',
    color: [
      [-1000, 0, 0, 0],
      [100, 0.5, 0.35, 0.25],
      [300, 0.85, 0.75, 0.65],
      [800, 0.95, 0.9, 0.85],
      [1500, 1, 1, 1],
    ],
    opacity: [
      [-1000, 0],
      [0, 0],
      [150, 0],
      [300, 0.4],
      [500, 0.7],
      [1000, 0.85],
      [1500, 0.95],
    ],
  },
}

/** Slicing mode enum matching vtk.js ImageMapper.SlicingMode */
const SLICING_MODE_MAP = {
  axial: 2,    // K (Z)
  sagittal: 0, // I (X)
  coronal: 1,  // J (Y)
}

const POLL_INTERVAL = 1500

export default function ViewerScreen() {
  const { jobId: urlJobId } = useParams()
  const containerRef = useRef(null)
  const vtkContextRef = useRef(null)
  const [vtkReady, setVtkReady] = useState(false)
  const [loadingFromDB, setLoadingFromDB] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const {
    viewMode,
    volumeData,
    surfaceData,
    surfaceAvailable,
    jobId: storeJobId,
    setJobId,
    setSurfaceData,
    setViewerData,
    setUploadState,
    setProcessingProgress,
    clipPlanes,
    isFlippedH,
    isFlippedV,
    currentSliceIndex,
    totalSlices,
    sliceAxis,
    opacityPreset,
    opacityMultiplier,
    setCurrentSliceIndex,
    setTotalSlices,
    segmentsAvailable,
    segmentManifest,
    activeSegments,
    setSegmentsAvailable,
    setSegmentManifest,
    setSegmentLoading,
    uploadState,
  } = useAppStore()

  // Use URL param jobId, falling back to store jobId
  const jobId = urlJobId || storeJobId

  // If navigating directly to /viewer/:jobId (e.g. from browse), load data
  useEffect(() => {
    if (!urlJobId) return
    if (storeJobId === urlJobId && volumeData) return // already loaded

    setJobId(urlJobId)
    setLoadingFromDB(true)
    setLoadError(null)

    let cancelled = false

    async function pollAndLoad() {
      try {
        // Poll until completed
        let status = await getJobStatus(urlJobId)
        while (!cancelled && status.status === 'processing') {
          setUploadState(UPLOAD_STATES.PROCESSING)
          if (status.progress) setProcessingProgress(status.progress)
          await new Promise((r) => setTimeout(r, POLL_INTERVAL))
          status = await getJobStatus(urlJobId)
        }

        if (cancelled) return

        if (status.status === 'failed') {
          setLoadError(status.error || 'Processing failed')
          setLoadingFromDB(false)
          return
        }

        // Load volume data
        const [volumeBuffer, volumeInfo, metadata] = await Promise.all([
          fetchVolumeData(urlJobId),
          fetchVolumeInfo(urlJobId),
          fetchMetadata(urlJobId),
        ])

        if (cancelled) return

        heavyDataCache.volumeScalars = new Float32Array(volumeBuffer)

        setViewerData({
          volumeData: {
            dimensions: volumeInfo.dimensions,
            spacing: volumeInfo.spacing,
            origin: volumeInfo.origin,
            min: volumeInfo.min,
            max: volumeInfo.max,
          },
          surfaceAvailable: !status.result?.is2DFallback,
          metadata,
          totalSlices: status.result?.totalSlices,
          is2DFallback: status.result?.is2DFallback || false,
          fallbackMessage: status.result?.fallbackMessage,
        })

        if (status.result?.segmentsAvailable) {
          setSegmentsAvailable(true)
        }
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      } finally {
        if (!cancelled) setLoadingFromDB(false)
      }
    }

    pollAndLoad()
    return () => { cancelled = true }
  }, [urlJobId])

  // Pipeline object refs — track vtk.js objects for reuse and cleanup.
  // vtk.js objects hold internal GPU/WASM resources that must be explicitly .delete()'d;
  // without this, every preset or mode change leaks ~50-100 MB of GPU memory.
  const volumeRef = useRef(null)
  const volumeMapperRef = useRef(null)
  const ctfRef = useRef(null)
  const ofRef = useRef(null)
  const surfaceActorRef = useRef(null)
  const surfaceMapperRef = useRef(null)
  const clipPlaneObjectsRef = useRef([])   // Track vtkPlane instances for cleanup
  const surfaceLoadedRef = useRef(false)    // Track if surface has been lazy-loaded
  const segmentActorsRef = useRef({})        // { structureName: { actor, mapper } }

  /** Safely delete vtk.js objects to free GPU/WASM resources. */
  function cleanupVtk(...objects) {
    for (const obj of objects) {
      try { obj?.delete?.() } catch (_) { /* already deleted or null */ }
    }
  }

  // Initialize vtk.js rendering context
  useEffect(() => {
    let destroyed = false

    async function init() {
      if (!containerRef.current) return
      await loadVtkModules()
      if (destroyed) return

      const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
        rootContainer: containerRef.current,
        containerStyle: {
          height: '100%',
          width: '100%',
          position: 'absolute',
        },
        background: [0.1, 0.1, 0.12],
      })

      const renderer = fullScreenRenderer.getRenderer()
      const renderWindow = fullScreenRenderer.getRenderWindow()

      vtkContextRef.current = {
        fullScreenRenderer,
        renderer,
        renderWindow,
        actors: [],
        volumes: [],
      }

      setVtkReady(true)
    }

    init()

    return () => {
      destroyed = true
      try {
        // Free all tracked vtk pipeline objects before destroying the render window
        for (const p of clipPlaneObjectsRef.current) { try { p.delete() } catch (_) {} }
        clipPlaneObjectsRef.current = []
        surfaceLoadedRef.current = false
        // Clean up organ segment actors
        for (const s of Object.values(segmentActorsRef.current)) {
          cleanupVtk(s.actor, s.mapper)
        }
        segmentActorsRef.current = {}
        cleanupVtk(
          volumeRef.current, volumeMapperRef.current,
          ctfRef.current, ofRef.current,
          surfaceActorRef.current, surfaceMapperRef.current,
          imageDataRef.current,
        )
        if (vtkContextRef.current) {
          vtkContextRef.current.fullScreenRenderer.delete()
          vtkContextRef.current = null
        }
      } catch (err) {
        console.warn('VTK cleanup error (non-fatal):', err)
      }
      // VTK.js FullScreenRenderWindow may leave behind DOM nodes — clean them up
      try {
        if (containerRef.current) {
          containerRef.current.innerHTML = ''
        }
        // Also remove any VTK-created elements that escaped to body
        document.querySelectorAll('.vtk-container > div').forEach(el => {
          try { el.remove() } catch (_) {}
        })
      } catch (_) {}
    }
  }, [])

  // Build vtkImageData from volumeData (shared by volume + slice rendering)
  const imageDataRef = useRef(null)
  useEffect(() => {
    if (!vtkReady || !volumeData || !heavyDataCache.volumeScalars) {
      cleanupVtk(imageDataRef.current)
      imageDataRef.current = null
      return
    }
    // Delete previous vtkImageData when replacing (e.g. re-upload)
    cleanupVtk(imageDataRef.current)
    const imageData = vtkImageData.newInstance()
    const { dimensions, spacing, origin } = volumeData
    imageData.setDimensions(dimensions)
    imageData.setSpacing(spacing || [1, 1, 1])
    imageData.setOrigin(origin || [0, 0, 0])

    // Use the Float32Array directly from cache — no copy
    const scalarArray = vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: heavyDataCache.volumeScalars,
      name: 'Scalars',
    })
    imageData.getPointData().setScalars(scalarArray)
    imageDataRef.current = imageData

    // Set total slices for the default axis
    const dims = imageData.getDimensions()
    setTotalSlices(dims[2]) // axial = Z dimension by default
  }, [vtkReady, volumeData, setTotalSlices])

  // Volume pipeline — creates mapper, volume actor, and shading properties.
  // Only rebuilds when the underlying data or view mode changes (NOT on
  // preset/multiplier tweaks), avoiding a costly 3D-texture re-upload.
  useEffect(() => {
    if (!vtkReady || !vtkContextRef.current || !imageDataRef.current) return
    if (viewMode !== VIEW_MODES.VOLUME) return

    const { renderer } = vtkContextRef.current
    const imageData = imageDataRef.current

    // Free ALL previous objects (both modes) to reclaim GPU memory
    renderer.removeAllVolumes()
    renderer.removeAllActors()
    cleanupVtk(
      volumeRef.current, volumeMapperRef.current,
      ctfRef.current, ofRef.current,
      surfaceActorRef.current, surfaceMapperRef.current,
    )
    surfaceActorRef.current = null
    surfaceMapperRef.current = null

    try {
      const spacing = imageData.getSpacing()

      // Volume mapper
      const mapper = vtkVolumeMapper.newInstance()
      mapper.setInputData(imageData)
      const minSpacing = Math.min(...spacing)
      mapper.setSampleDistance(minSpacing * 0.5)
      mapper.setAutoAdjustSampleDistances(true)
      mapper.setMaximumSamplesPerRay(2000)

      // Empty transfer functions — the TF effect below will fill them
      const ctfun = vtkColorTransferFunction.newInstance()
      const ofun = vtkPiecewiseFunction.newInstance()

      const avgSpacing = (spacing[0] + spacing[1] + spacing[2]) / 3

      // Volume actor
      const volume = vtkVolume.newInstance()
      volume.setMapper(mapper)
      volume.getProperty().setRGBTransferFunction(0, ctfun)
      volume.getProperty().setScalarOpacity(0, ofun)
      volume.getProperty().setScalarOpacityUnitDistance(0, avgSpacing)
      volume.getProperty().setInterpolationTypeToLinear()
      volume.getProperty().setShade(true)
      volume.getProperty().setAmbient(0.2)
      volume.getProperty().setDiffuse(0.7)
      volume.getProperty().setSpecular(0.3)
      volume.getProperty().setSpecularPower(8.0)

      // Gradient opacity — modulates opacity by local gradient magnitude
      try {
        volume.getProperty().setUseGradientOpacity(0, true)
        volume.getProperty().setGradientOpacityMinimumValue(0, 2)
        volume.getProperty().setGradientOpacityMaximumValue(0, 20)
        volume.getProperty().setGradientOpacityMinimumOpacity(0, 0.0)
        volume.getProperty().setGradientOpacityMaximumOpacity(0, 1.0)
      } catch (_) { /* gradient opacity not available in this vtk.js build */ }

      renderer.addVolume(volume)
      renderer.resetCamera()

      // Store refs — the TF effect will populate control points and render
      volumeRef.current = volume
      volumeMapperRef.current = mapper
      ctfRef.current = ctfun
      ofRef.current = ofun
      vtkContextRef.current.volumes = [volume]
      vtkContextRef.current.actors = []
    } catch (err) {
      console.error('Failed to build volume pipeline:', err)
    }
  }, [vtkReady, volumeData, viewMode])

  // Transfer function update — lightweight effect that only touches color/opacity
  // control points.  Runs on preset or multiplier changes WITHOUT recreating the
  // heavy mapper, 3D texture, or volume actor.
  useEffect(() => {
    if (!ctfRef.current || !ofRef.current || !imageDataRef.current) return
    if (viewMode !== VIEW_MODES.VOLUME) return

    const ctfun = ctfRef.current
    const ofun = ofRef.current
    ctfun.removeAllPoints()
    ofun.removeAllPoints()

    const imageData = imageDataRef.current
    const scalarArray = imageData.getPointData().getScalars()
    const dataRange = scalarArray.getRange()
    const rangeMin = dataRange[0]
    const rangeMax = dataRange[1]
    const isCTData = rangeMin < -500

    if (isCTData) {
      const preset = CT_OPACITY_PRESETS[opacityPreset] || CT_OPACITY_PRESETS.skin
      for (const [val, r, g, b] of preset.color) {
        ctfun.addRGBPoint(val, r, g, b)
      }
      for (const [val, baseOpacity] of preset.opacity) {
        ofun.addPoint(val, baseOpacity * opacityMultiplier)
      }
    } else {
      const rangeWidth = rangeMax - rangeMin || 1
      ctfun.addRGBPoint(rangeMin, 0, 0, 0)
      ctfun.addRGBPoint(rangeMin + rangeWidth * 0.25, 0.4, 0.3, 0.4)
      ctfun.addRGBPoint(rangeMin + rangeWidth * 0.5, 0.7, 0.6, 0.65)
      ctfun.addRGBPoint(rangeMin + rangeWidth * 0.75, 0.9, 0.85, 0.8)
      ctfun.addRGBPoint(rangeMax, 1, 1, 1)

      ofun.addPoint(rangeMin, 0)
      ofun.addPoint(rangeMin + rangeWidth * 0.1, 0)
      ofun.addPoint(rangeMin + rangeWidth * 0.3, 0.05 * opacityMultiplier)
      ofun.addPoint(rangeMin + rangeWidth * 0.5, 0.2 * opacityMultiplier)
      ofun.addPoint(rangeMin + rangeWidth * 0.8, 0.5 * opacityMultiplier)
      ofun.addPoint(rangeMax, 0.8 * opacityMultiplier)
    }

    if (vtkContextRef.current) {
      vtkContextRef.current.renderWindow.render()
    }
  }, [vtkReady, viewMode, opacityPreset, opacityMultiplier, volumeData])

  // Lazy-load surface data when user switches to surface mode
  useEffect(() => {
    if (viewMode !== VIEW_MODES.SURFACE) return
    if (surfaceData || surfaceLoadedRef.current) return   // already loaded
    if (!surfaceAvailable || !jobId) return

    let cancelled = false
    async function loadSurface() {
      try {
        const buffer = await fetchSurfaceData(jobId)
        if (!cancelled) {
          heavyDataCache.surfaceBuffer = buffer
          setSurfaceData(buffer)
          surfaceLoadedRef.current = true
        }
      } catch (err) {
        console.error('Failed to lazy-load surface data:', err)
        if (!cancelled) surfaceLoadedRef.current = true  // Don't retry on failure
      }
    }
    loadSurface()
    return () => { cancelled = true }
  }, [viewMode, surfaceData, surfaceAvailable, jobId, setSurfaceData])

  // Load surface data when available
  useEffect(() => {
    if (!vtkReady || !vtkContextRef.current || !surfaceData) return
    if (viewMode !== VIEW_MODES.SURFACE) return

    const { renderer, renderWindow } = vtkContextRef.current

    // Free ALL previous objects (both modes) to reclaim GPU memory
    renderer.removeAllVolumes()
    renderer.removeAllActors()
    cleanupVtk(
      volumeRef.current, volumeMapperRef.current,
      ctfRef.current, ofRef.current,
      surfaceActorRef.current, surfaceMapperRef.current,
    )
    volumeRef.current = null
    volumeMapperRef.current = null
    ctfRef.current = null
    ofRef.current = null

    try {
      // Parse VTP — delete the reader immediately to free its internal buffers
      const reader = vtkXMLPolyDataReader.newInstance()
      reader.parseAsArrayBuffer(surfaceData)
      const polyData = reader.getOutputData(0)
      reader.delete()

      // Free the raw ArrayBuffer from cache — polyData now owns the parsed geometry
      heavyDataCache.surfaceBuffer = null

      if (!polyData) {
        console.error('Failed to parse surface VTP data')
        return
      }

      const mapper = vtkMapper.newInstance()
      mapper.setInputData(polyData)

      const actor = vtkActor.newInstance()
      actor.setMapper(mapper)
      actor.getProperty().setColor(0.8, 0.75, 0.7)
      actor.getProperty().setOpacity(1.0)
      actor.getProperty().setBackfaceCulling(false)

      renderer.addActor(actor)
      renderer.resetCamera()
      renderWindow.render()

      surfaceActorRef.current = actor
      surfaceMapperRef.current = mapper
      vtkContextRef.current.actors = [actor]
      vtkContextRef.current.volumes = []
    } catch (err) {
      console.error('Failed to render surface:', err)
    }
  }, [vtkReady, surfaceData, viewMode])

  // ─── Organ segment manifest fetch ───────────────────────────────────
  // After job completion, fetch the list of available segments if the backend
  // reported that segmentation succeeded.
  useEffect(() => {
    if (!jobId || !segmentsAvailable) return
    if (segmentManifest.length > 0) return  // already fetched

    let cancelled = false
    async function load() {
      try {
        const manifest = await fetchSegmentManifest(jobId)
        if (!cancelled && Array.isArray(manifest)) {
          setSegmentManifest(manifest)
        }
      } catch (err) {
        console.error('Failed to fetch segment manifest:', err)
      }
    }
    load()
    return () => { cancelled = true }
  }, [jobId, segmentsAvailable, segmentManifest.length, setSegmentManifest])

  // ─── Organ segment rendering ────────────────────────────────────────
  // When activeSegments changes, load meshes on demand and add/remove
  // vtkActor objects from the renderer.
  useEffect(() => {
    if (!vtkReady || !vtkContextRef.current || !jobId) return

    const { renderer, renderWindow } = vtkContextRef.current
    const currentActors = segmentActorsRef.current

    // Remove actors for segments that are no longer active
    for (const name of Object.keys(currentActors)) {
      if (!activeSegments.has(name)) {
        try {
          renderer.removeActor(currentActors[name].actor)
        } catch (_) {}
        // Keep the cached objects — don't delete() them so re-toggle is instant
      }
    }

    // Add actors for newly active segments
    const toLoad = []
    for (const name of activeSegments) {
      if (currentActors[name]) {
        // Already parsed — just re-add to renderer if removed
        try {
          renderer.addActor(currentActors[name].actor)
        } catch (_) {}
        continue
      }
      // Need to fetch + parse
      toLoad.push(name)
    }

    if (toLoad.length === 0) {
      renderWindow.render()
      return
    }

    // Find colors from the manifest
    const colorMap = {}
    for (const entry of segmentManifest) {
      colorMap[entry.name] = entry.color
    }

    let cancelled = false
    async function loadMeshes() {
      for (const name of toLoad) {
        if (cancelled) break

        // Use cached buffer or fetch
        let buffer = heavyDataCache.segmentBuffers[name]
        if (!buffer) {
          try {
            setSegmentLoading(name, true)
            buffer = await fetchSegmentMesh(jobId, name)
            heavyDataCache.segmentBuffers[name] = buffer
          } catch (err) {
            console.error(`Failed to load segment mesh: ${name}`, err)
            setSegmentLoading(name, false)
            continue
          }
        }

        if (cancelled) break

        try {
          const reader = vtkXMLPolyDataReader.newInstance()
          reader.parseAsArrayBuffer(buffer)
          const polyData = reader.getOutputData(0)
          reader.delete()

          if (!polyData || polyData.getNumberOfPoints() < 3) continue

          const mapper = vtkMapper.newInstance()
          mapper.setInputData(polyData)

          const actor = vtkActor.newInstance()
          actor.setMapper(mapper)

          const color = colorMap[name] || [0.7, 0.7, 0.7]
          const prop = actor.getProperty()
          prop.setColor(color[0], color[1], color[2])
          prop.setOpacity(1.0)
          prop.setBackfaceCulling(false)
          // Realistic shading: diffuse + specular highlights
          prop.setAmbient(0.15)
          prop.setDiffuse(0.7)
          prop.setSpecular(0.3)
          prop.setSpecularPower(20)
          prop.setInterpolationToPhong()

          // Apply any active flips
          const isFlippedHNow = useAppStore.getState().isFlippedH
          const isFlippedVNow = useAppStore.getState().isFlippedV
          actor.setScale(isFlippedHNow ? -1 : 1, isFlippedVNow ? -1 : 1, 1)

          currentActors[name] = { actor, mapper }
          renderer.addActor(actor)
        } catch (err) {
          console.error(`Failed to parse segment mesh: ${name}`, err)
        } finally {
          setSegmentLoading(name, false)
        }
      }

      if (!cancelled) {
        renderWindow.render()
      }
    }

    loadMeshes()
    return () => { cancelled = true }
  }, [vtkReady, activeSegments, jobId, segmentManifest, setSegmentLoading])

  // Apply flip transforms
  useEffect(() => {
    if (!vtkContextRef.current) return
    const { renderer, renderWindow, volumes, actors } = vtkContextRef.current
    // Include organ segment actors in the flip
    const segActors = Object.values(segmentActorsRef.current).map(s => s.actor)
    const allActors = [...(volumes || []), ...(actors || []), ...segActors]
    const isOddFlip = isFlippedH !== isFlippedV

    // When an odd number of axes are negatively scaled the triangle winding
    // reverses.  vtk.js's two-sided lighting path negates the fragment normal
    // for back-facing triangles, but the normal matrix already accounts for
    // the mirrored transform — the double negation produces an incorrect
    // normal and the surface goes black.  Disabling two-sided lighting when
    // an odd flip is active avoids the double negation.
    renderer.setTwoSidedLighting(!isOddFlip)

    for (const actor of allActors) {
      if (actor.setScale) {
        actor.setScale(isFlippedH ? -1 : 1, isFlippedV ? -1 : 1, 1)
      }
    }

    renderWindow.render()
  }, [isFlippedH, isFlippedV])

  // Unified clipping: slice view + user clip planes (combined into one effect to avoid conflicts)
  useEffect(() => {
    if (!vtkContextRef.current) return

    const { renderWindow, volumes, actors } = vtkContextRef.current

    // Delete previously created vtkPlane objects to prevent WASM/GPU memory leak
    for (const p of clipPlaneObjectsRef.current) {
      try { p.delete() } catch (_) { /* already deleted */ }
    }
    clipPlaneObjectsRef.current = []

    /** Create a vtkPlane, track it for later cleanup, and return it. */
    function createTrackedPlane(opts) {
      const plane = vtkPlane.newInstance(opts)
      clipPlaneObjectsRef.current.push(plane)
      return plane
    }

    // Apply clip planes to volumes, surface actors, AND organ segment actors
    const segActorList = Object.entries(segmentActorsRef.current)
      .filter(([name]) => activeSegments.has(name))
      .map(([, s]) => s.actor)
    const allMappables = [...(volumes || []), ...(actors || []), ...segActorList]

    for (const obj of allMappables) {
      const mapper = obj.getMapper()
      if (!mapper) continue

      // Remove all existing clipping planes first
      mapper.removeAllClippingPlanes()

      const bounds = mapper.getBounds()
      if (!bounds || bounds.length < 6) continue

      // --- Slice clipping (when slice index > 0) ---
      if (imageDataRef.current && totalSlices > 0 && currentSliceIndex > 0) {
        const imageData = imageDataRef.current
        const dims = imageData.getDimensions()
        const spacing = imageData.getSpacing()
        const origin = imageData.getOrigin()
        const axisIndex = SLICING_MODE_MAP[sliceAxis] ?? 2
        const maxSlice = dims[axisIndex]

        if (maxSlice !== totalSlices) {
          setTotalSlices(maxSlice)
        }

        const clampedSlice = Math.min(currentSliceIndex, maxSlice - 1)
        const slicePos = origin[axisIndex] + clampedSlice * spacing[axisIndex]
        const halfThickness = spacing[axisIndex] * 0.6

        // Front clip plane
        const frontOrigin = [origin[0], origin[1], origin[2]]
        frontOrigin[axisIndex] = slicePos - halfThickness
        const frontNormal = [0, 0, 0]
        frontNormal[axisIndex] = 1
        mapper.addClippingPlane(
          createTrackedPlane({ normal: frontNormal, origin: frontOrigin })
        )

        // Back clip plane
        const backOrigin = [origin[0], origin[1], origin[2]]
        backOrigin[axisIndex] = slicePos + halfThickness
        const backNormal = [0, 0, 0]
        backNormal[axisIndex] = -1
        mapper.addClippingPlane(
          createTrackedPlane({ normal: backNormal, origin: backOrigin })
        )
      }

      // --- User clip planes ---
      if (clipPlanes.axial.enabled) {
        const z = bounds[4] + clipPlanes.axial.value * (bounds[5] - bounds[4])
        mapper.addClippingPlane(
          createTrackedPlane({ normal: [0, 0, 1], origin: [0, 0, z] })
        )
      }

      if (clipPlanes.sagittal.enabled) {
        const x = bounds[0] + clipPlanes.sagittal.value * (bounds[1] - bounds[0])
        mapper.addClippingPlane(
          createTrackedPlane({ normal: [1, 0, 0], origin: [x, 0, 0] })
        )
      }

      if (clipPlanes.coronal.enabled) {
        const y = bounds[2] + clipPlanes.coronal.value * (bounds[3] - bounds[2])
        mapper.addClippingPlane(
          createTrackedPlane({ normal: [0, 1, 0], origin: [0, y, 0] })
        )
      }
    }

    renderWindow.render()
  }, [clipPlanes, volumeData, viewMode, currentSliceIndex, sliceAxis, totalSlices, setTotalSlices, activeSegments])

  const showOverlay = loadError || loadingFromDB || (uploadState === UPLOAD_STATES.PROCESSING && !volumeData)

  return (
    <div className="viewer-screen">
      <div ref={containerRef} className="vtk-container" />
      {showOverlay && (
        <div className="viewer-message">
          {loadError
            ? <p>Error: {loadError}</p>
            : <p>Processing DICOM data...</p>
          }
        </div>
      )}
    </div>
  )
}
