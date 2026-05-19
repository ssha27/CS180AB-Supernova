import { useEffect, useRef, useState, useCallback } from 'react';
import type { OrganInfo } from '../utils/api';
import { getMeshUrl } from '../utils/api';
import type { HoverTarget } from '../utils/hoverDetails';

// VTK.js imports
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkSTLReader from '@kitware/vtk.js/IO/Geometry/STLReader';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkCellPicker from '@kitware/vtk.js/Rendering/Core/CellPicker';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import type { vtkActor as VtkActorType } from '@kitware/vtk.js/Rendering/Core/Actor';
import type { vtkCellPicker as VtkCellPickerType } from '@kitware/vtk.js/Rendering/Core/CellPicker';
import type { vtkMapper as VtkMapperType } from '@kitware/vtk.js/Rendering/Core/Mapper';
import type { vtkPlane as VtkPlaneType } from '@kitware/vtk.js/Common/DataModel/Plane';

interface ClippingState {
  axial: { enabled: boolean; value: number };
  coronal: { enabled: boolean; value: number };
  sagittal: { enabled: boolean; value: number };
}

interface VTKRendererProps {
  jobId: string;
  organs: OrganInfo[];
  requestedOrgans: Set<string>;
  displayedOrgans: Set<string>;
  clipping: ClippingState;
  activeHoverName: string | null;
  hoverDetailsEnabled: boolean;
  onHoverCandidateChange: (target: HoverTarget | null) => void;
}

interface LoadedOrgan {
  name: string;
  actor: VtkActorType;
  mapper: VtkMapperType;
  color: number[];
}

const DEFAULT_BOUNDS = [0, 1, 0, 1, 0, 1];
const HOVER_PICK_SETTLE_MS = 48;
const HOVER_PICK_TOLERANCE = 0.015;

function haveSameBounds(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export default function VTKRenderer({
  jobId,
  organs,
  requestedOrgans,
  displayedOrgans,
  clipping,
  activeHoverName,
  hoverDetailsEnabled,
  onHoverCandidateChange,
}: VTKRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<ReturnType<typeof vtkGenericRenderWindow.newInstance> | null>(null);
  const organsRef = useRef<Map<string, LoadedOrgan>>(new Map());
  const mapperLookupRef = useRef<Map<VtkMapperType, string>>(new Map());
  const loadingOrgansRef = useRef<Set<string>>(new Set());
  const pickerRef = useRef<VtkCellPickerType | null>(null);
  const displayedOrgansRef = useRef(displayedOrgans);
  const hoverDetailsEnabledRef = useRef(hoverDetailsEnabled);
  const activeHoverNameRef = useRef(activeHoverName);
  const onHoverCandidateChangeRef = useRef(onHoverCandidateChange);
  const lastRendererHoverRef = useRef<string | null>(null);
  const pointerDownRef = useRef(false);
  const pendingPickTimerRef = useRef<number | null>(null);
  const pendingPointerEventRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const [globalBounds, setGlobalBounds] = useState<number[]>(DEFAULT_BOUNDS);
  const clippingPlanesRef = useRef<VtkPlaneType[]>([]);

  useEffect(() => {
    displayedOrgansRef.current = displayedOrgans;
  }, [displayedOrgans]);

  useEffect(() => {
    hoverDetailsEnabledRef.current = hoverDetailsEnabled;
    if (!hoverDetailsEnabled) {
      lastRendererHoverRef.current = null;
    }
  }, [hoverDetailsEnabled]);

  useEffect(() => {
    activeHoverNameRef.current = activeHoverName;
  }, [activeHoverName]);

  useEffect(() => {
    onHoverCandidateChangeRef.current = onHoverCandidateChange;
  }, [onHoverCandidateChange]);

  const applyActorAppearance = useCallback(
    (name: string, loaded: LoadedOrgan, visibleNames: Set<string>, focusedName: string | null) => {
      const property = loaded.actor.getProperty();
      const [red, green, blue] = loaded.color;

      property.setColor(red / 255, green / 255, blue / 255);
      property.setOpacity(1);
      property.setSpecular(0.3);
      property.setSpecularPower(20);
      property.setAmbient(0.2);
      property.setDiffuse(0.8);
      property.setEdgeVisibility(false);

      if (!visibleNames.has(name) || !focusedName) {
        return;
      }

      if (name === focusedName) {
        property.setOpacity(1);
        property.setAmbient(0.35);
        property.setDiffuse(0.95);
        property.setSpecular(0.45);
        property.setSpecularPower(28);
        property.setEdgeVisibility(true);
        property.setEdgeColor(1, 1, 1);
        property.setLineWidth(1.5);
        return;
      }

      property.setOpacity(0.18);
      property.setAmbient(0.12);
      property.setDiffuse(0.55);
      property.setSpecular(0.08);
    },
    [],
  );

  const updateDisplayedBounds = useCallback((visibleNames: Set<string>) => {
    const nextBounds = [
      Infinity, -Infinity,
      Infinity, -Infinity,
      Infinity, -Infinity,
    ];

    organsRef.current.forEach(({ actor }, name) => {
      if (!visibleNames.has(name)) return;

      const bounds = actor.getBounds();
      if (!Number.isFinite(bounds[0])) return;

      nextBounds[0] = Math.min(nextBounds[0], bounds[0]);
      nextBounds[1] = Math.max(nextBounds[1], bounds[1]);
      nextBounds[2] = Math.min(nextBounds[2], bounds[2]);
      nextBounds[3] = Math.max(nextBounds[3], bounds[3]);
      nextBounds[4] = Math.min(nextBounds[4], bounds[4]);
      nextBounds[5] = Math.max(nextBounds[5], bounds[5]);
    });

    const resolvedBounds = nextBounds[0] === Infinity ? DEFAULT_BOUNDS : nextBounds;
    setGlobalBounds((prev) => (haveSameBounds(prev, resolvedBounds) ? prev : resolvedBounds));
  }, []);

  // Initialize VTK render window
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    const grw = vtkGenericRenderWindow.newInstance();
    grw.setContainer(container);
    grw.resize();
    contextRef.current = grw;

    const renderer = grw.getRenderer();
    renderer.setBackground(0.1, 0.1, 0.12);

    // Set up interaction
    const interactor = grw.getInteractor();
    interactor.setDesiredUpdateRate(30);

    const picker = vtkCellPicker.newInstance();
    picker.setTolerance(HOVER_PICK_TOLERANCE);
    pickerRef.current = picker;
    const mapperLookup = mapperLookupRef.current;
    const loadingOrgans = loadingOrgansRef.current;

    const clearPendingPick = () => {
      if (pendingPickTimerRef.current !== null) {
        window.clearTimeout(pendingPickTimerRef.current);
        pendingPickTimerRef.current = null;
      }
    };

    const clearRendererHover = () => {
      clearPendingPick();
      pendingPointerEventRef.current = null;
      if (lastRendererHoverRef.current === null) return;
      lastRendererHoverRef.current = null;
      onHoverCandidateChangeRef.current(null);
    };

    const getPickCoordinates = (event: PointerEvent) => {
      const apiRenderWindow = grw.getApiSpecificRenderWindow();
      const bounds = container.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return null;

      const [canvasWidth, canvasHeight] = apiRenderWindow.getSize();
      return {
        x: Math.round(((event.clientX - bounds.left) / bounds.width) * canvasWidth),
        y: Math.round(((bounds.height - (event.clientY - bounds.top)) / bounds.height) * canvasHeight),
      };
    };

    const performRendererPick = () => {
      pendingPickTimerRef.current = null;

      if (!hoverDetailsEnabledRef.current || pointerDownRef.current || !pickerRef.current) {
        return;
      }

      const pointerEvent = pendingPointerEventRef.current;
      if (!pointerEvent) {
        return;
      }

      const coordinates = getPickCoordinates({
        clientX: pointerEvent.clientX,
        clientY: pointerEvent.clientY,
      } as PointerEvent);
      if (!coordinates) return;

      pickerRef.current.pick([coordinates.x, coordinates.y, 0], renderer);

      const pickedMapper = pickerRef.current.getMapper() as VtkMapperType | null;
      const pickedActor = pickerRef.current.getActors()[0] as VtkActorType | undefined;
      const resolvedMapper = pickedMapper ?? (pickedActor?.getMapper() as VtkMapperType | null);
      const organName = resolvedMapper ? mapperLookup.get(resolvedMapper) ?? null : null;

      if (!organName || !displayedOrgansRef.current.has(organName)) {
        clearRendererHover();
        return;
      }

      if (lastRendererHoverRef.current === organName) {
        return;
      }

      lastRendererHoverRef.current = organName;
      onHoverCandidateChangeRef.current({
        name: organName,
        source: 'renderer',
        clientX: pointerEvent.clientX,
        clientY: pointerEvent.clientY,
      });
    };

    const scheduleRendererPick = () => {
      clearPendingPick();
      pendingPickTimerRef.current = window.setTimeout(() => {
        performRendererPick();
      }, HOVER_PICK_SETTLE_MS);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!hoverDetailsEnabledRef.current || pointerDownRef.current || !pickerRef.current) {
        return;
      }

      pendingPointerEventRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
      };
      scheduleRendererPick();
    };

    const handlePointerDown = () => {
      pointerDownRef.current = true;
      clearRendererHover();
    };

    const handlePointerUp = () => {
      pointerDownRef.current = false;
    };

    const handlePointerLeave = () => {
      pointerDownRef.current = false;
      clearRendererHover();
    };

    const handleWheel = () => {
      clearRendererHover();
    };

    // Handle resize — both window and container-level
    const handleResize = () => grw.resize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointerleave', handlePointerLeave);
    container.addEventListener('wheel', handleWheel, { passive: true });

    const resizeObserver = new ResizeObserver(() => grw.resize());
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointerleave', handlePointerLeave);
      container.removeEventListener('wheel', handleWheel);
      resizeObserver.disconnect();
      clearPendingPick();
      picker.delete();
      pickerRef.current = null;
      mapperLookup.clear();
      loadingOrgans.clear();
      lastRendererHoverRef.current = null;
      grw.delete();
      contextRef.current = null;
    };
  }, []);

  // Load organ meshes
  const loadOrganMesh = useCallback(
    async (organ: OrganInfo) => {
      if (!contextRef.current) return;
      if (organsRef.current.has(organ.name)) return;
      if (loadingOrgansRef.current.has(organ.name)) return;

      loadingOrgansRef.current.add(organ.name);

      const renderer = contextRef.current.getRenderer();
      const url = getMeshUrl(jobId, organ.file);

      try {
        const response = await fetch(url);
        if (!response.ok) return;

        const arrayBuffer = await response.arrayBuffer();
        const reader = vtkSTLReader.newInstance();
        reader.parseAsArrayBuffer(arrayBuffer);

        const polyData = reader.getOutputData();
        if (!polyData || polyData.getNumberOfPoints() === 0) return;
        if (!contextRef.current) return;

        const mapper = vtkMapper.newInstance() as VtkMapperType;
        mapper.setScalarVisibility(false);
        mapper.setInputData(polyData);

        const actor = vtkActor.newInstance() as VtkActorType;
        actor.setMapper(mapper);

        // Apply color from our color map
        const [r, g, b] = organ.color;
        actor.getProperty().setColor(r / 255, g / 255, b / 255);
        actor.getProperty().setSpecular(0.3);
        actor.getProperty().setSpecularPower(20);
        actor.getProperty().setAmbient(0.2);
        actor.getProperty().setDiffuse(0.8);

        // Apply current clipping planes to the new organ
        clippingPlanesRef.current.forEach((p) => mapper.addClippingPlane(p));

        const loadedOrgan: LoadedOrgan = {
          name: organ.name,
          actor,
          mapper,
          color: organ.color,
        };

        actor.setVisibility(displayedOrgansRef.current.has(organ.name));
        applyActorAppearance(
          organ.name,
          loadedOrgan,
          displayedOrgansRef.current,
          activeHoverNameRef.current,
        );

        renderer.addActor(actor);
        mapperLookupRef.current.set(mapper, organ.name);

        organsRef.current.set(organ.name, loadedOrgan);
      } catch (err) {
        console.error(`Failed to load mesh for ${organ.name}:`, err);
      } finally {
        loadingOrgansRef.current.delete(organ.name);
      }
    },
    [applyActorAppearance, jobId],
  );

  // Load meshes for visible organs
  useEffect(() => {
    const toLoad = organs.filter(
      (o) => requestedOrgans.has(o.name) && !organsRef.current.has(o.name),
    );

    if (toLoad.length === 0) return;

    const shouldResetCamera =
      activeHoverName === null && toLoad.some((organ) => displayedOrgans.has(organ.name));

    Promise.all(toLoad.map(loadOrganMesh)).then(() => {
      if (!contextRef.current) return;
      const renderer = contextRef.current.getRenderer();

      updateDisplayedBounds(displayedOrgans);

      if (shouldResetCamera) {
        renderer.resetCamera();
      }

      contextRef.current?.getRenderWindow().render();
    });
  }, [activeHoverName, displayedOrgans, loadOrganMesh, organs, requestedOrgans, updateDisplayedBounds]);

  // Sync visibility and focus styling
  useEffect(() => {
    organsRef.current.forEach((loaded, name) => {
      loaded.actor.setVisibility(displayedOrgans.has(name));
      applyActorAppearance(name, loaded, displayedOrgans, activeHoverName);
    });

    updateDisplayedBounds(displayedOrgans);
    contextRef.current?.getRenderWindow().render();
  }, [activeHoverName, applyActorAppearance, displayedOrgans, updateDisplayedBounds]);

  // Update clipping planes
  useEffect(() => {
    if (!contextRef.current) return;

    const bounds = globalBounds;
    const planes: VtkPlaneType[] = [];

    if (clipping.axial.enabled) {
      const plane = vtkPlane.newInstance();
      const z = bounds[4] + (bounds[5] - bounds[4]) * clipping.axial.value;
      plane.setOrigin(0, 0, z);
      plane.setNormal(0, 0, 1);
      planes.push(plane);
    }
    if (clipping.coronal.enabled) {
      const plane = vtkPlane.newInstance();
      const y = bounds[2] + (bounds[3] - bounds[2]) * clipping.coronal.value;
      plane.setOrigin(0, y, 0);
      plane.setNormal(0, 1, 0);
      planes.push(plane);
    }
    if (clipping.sagittal.enabled) {
      const plane = vtkPlane.newInstance();
      const x = bounds[0] + (bounds[1] - bounds[0]) * clipping.sagittal.value;
      plane.setOrigin(x, 0, 0);
      plane.setNormal(1, 0, 0);
      planes.push(plane);
    }

    // Store current planes for newly loaded organs
    clippingPlanesRef.current = planes;

    // Apply clipping planes to all organs
    organsRef.current.forEach(({ mapper }) => {
      mapper.removeAllClippingPlanes();
      planes.forEach((p) => mapper.addClippingPlane(p));
    });

    contextRef.current.getRenderWindow().render();
  }, [clipping, globalBounds]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      data-testid="vtk-container"
    />
  );
}
