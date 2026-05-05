import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import ViewerPage from '../pages/ViewerPage';
import { HOVER_DWELL_MS } from '../utils/hoverDetails';

const HOVER_EXIT_GRACE_MS = 240;

const { mockGetJobResults } = vi.hoisted(() => ({
  mockGetJobResults: vi.fn(),
}));

const mockNavigate = vi.fn();

vi.mock('../utils/api', async () => {
  const actual = await vi.importActual('../utils/api');
  return {
    ...actual,
    getJobResults: mockGetJobResults,
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ jobId: 'job-123' }),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../components/ViewerControls', () => ({
  default: (props: {
    viewMode: 'model' | 'slice';
    sliceAvailable: boolean;
    onViewModeChange: (mode: 'model' | 'slice') => void;
  }) => (
    <div
      data-testid="viewer-controls-mock"
      data-view-mode={props.viewMode}
      data-slice-available={String(props.sliceAvailable)}
    >
      <button
        type="button"
        data-testid="switch-to-slice"
        onClick={() => props.onViewModeChange('slice')}
      >
        Slice Mode
      </button>
      <button
        type="button"
        data-testid="switch-to-model"
        onClick={() => props.onViewModeChange('model')}
      >
        Model Mode
      </button>
    </div>
  ),
}));

vi.mock('../components/OrganPanel', () => ({
  default: (props: {
    organs: Array<{ name: string }>;
    visibleOrgans: Set<string>;
    hoverDetailsEnabled: boolean;
    onCollapse: () => void;
    onHoverCandidateChange: (target: { name: string; source: 'sidebar'; clientX: number; clientY: number } | null) => void;
    onHoverDetailsEnabledChange: (enabled: boolean) => void;
  }) => (
    <div data-testid="organ-panel-mock">
      <div data-testid="panel-organs">
        {props.organs.map((organ) => organ.name).join(',')}
      </div>
      <div data-testid="panel-visible-organs">
        {Array.from(props.visibleOrgans).sort().join(',')}
      </div>
      <div data-testid="panel-hover-enabled">
        {String(props.hoverDetailsEnabled)}
      </div>
      <button
        type="button"
        data-testid="collapse-organ-panel"
        onClick={props.onCollapse}
      >
        Collapse Organ Panel
      </button>
      <button
        type="button"
        data-testid="sidebar-hover-kidney"
        onMouseEnter={() => {
          props.onHoverCandidateChange({
            name: 'kidney_right',
            source: 'sidebar',
            clientX: 120,
            clientY: 180,
          });
        }}
        onMouseLeave={() => props.onHoverCandidateChange(null)}
      >
        Hover Kidney
      </button>
      <button
        type="button"
        data-testid="disable-hover-details"
        onClick={() => props.onHoverDetailsEnabledChange(false)}
      >
        Disable Hover Details
      </button>
    </div>
  ),
}));

vi.mock('../components/VTKRenderer', () => ({
  default: (props: {
    requestedOrgans: Set<string>;
    displayedOrgans: Set<string>;
    activeHoverName: string | null;
    onHoverCandidateChange: (target: { name: string; source: 'renderer'; clientX: number; clientY: number } | null) => void;
  }) => (
    <div
      data-testid="vtk-renderer-mock"
      onPointerDown={() => props.onHoverCandidateChange(null)}
    >
      <div data-testid="renderer-requested-organs">
        {Array.from(props.requestedOrgans).sort().join(',')}
      </div>
      <div data-testid="renderer-displayed-organs">
        {Array.from(props.displayedOrgans).sort().join(',')}
      </div>
      <div data-testid="renderer-active-hover-name">
        {props.activeHoverName ?? ''}
      </div>
      <button
        type="button"
        data-testid="renderer-hover-spleen"
        onMouseEnter={() => {
          props.onHoverCandidateChange({
            name: 'spleen',
            source: 'renderer',
            clientX: 320,
            clientY: 240,
          });
        }}
        onMouseLeave={() => props.onHoverCandidateChange(null)}
      >
        Hover Spleen
      </button>
    </div>
  ),
}));

vi.mock('../components/SliceViewport', () => ({
  default: (props: {
    cursor: { z: number; y: number; x: number };
    activeHoverName: string | null;
    windowCenter: number;
    windowWidth: number;
    anatomyLabelsEnabled: boolean;
    interactionMode: 'navigate' | 'distance' | 'probe';
    onCursorChange: (cursor: { z: number; y: number; x: number }) => void;
    onHoverCandidateChange: (target: {
      name: string;
      source: 'slice';
      pane: 'axial';
      clientX: number;
      clientY: number;
    } | null) => void;
    onDistanceMeasurementChange: (measurement: {
      plane: 'axial';
      start: { z: number; y: number; x: number };
      end: { z: number; y: number; x: number };
      distanceMm: number;
    } | null) => void;
    onProbeChange: (probe: {
      plane: 'axial';
      point: { z: number; y: number; x: number };
      intensity: number;
      label: number;
      organName: string | null;
    } | null) => void;
  }) => (
    <div data-testid="slice-viewport-mock">
      <div data-testid="slice-cursor">
        {props.cursor.z},{props.cursor.y},{props.cursor.x}
      </div>
      <div data-testid="slice-active-hover-name">
        {props.activeHoverName ?? ''}
      </div>
      <div data-testid="slice-window-values">
        {props.windowCenter}/{props.windowWidth}
      </div>
      <div data-testid="slice-labels-enabled">
        {String(props.anatomyLabelsEnabled)}
      </div>
      <div data-testid="slice-interaction-mode">
        {props.interactionMode}
      </div>
      <button
        type="button"
        data-testid="slice-hover-kidney"
        onMouseEnter={() => {
          props.onHoverCandidateChange({
            name: 'kidney_right',
            source: 'slice',
            pane: 'axial',
            clientX: 420,
            clientY: 220,
          });
        }}
        onMouseLeave={() => props.onHoverCandidateChange(null)}
      >
        Hover Slice Kidney
      </button>
      <button
        type="button"
        data-testid="slice-move-cursor"
        onClick={() => props.onCursorChange({ z: 1, y: 2, x: 3 })}
      >
        Move Slice Cursor
      </button>
      <button
        type="button"
        data-testid="slice-report-distance"
        onClick={() => props.onDistanceMeasurementChange({
          plane: 'axial',
          start: { z: 1, y: 2, x: 3 },
          end: { z: 1, y: 5, x: 7 },
          distanceMm: 16.4,
        })}
      >
        Report Distance
      </button>
      <button
        type="button"
        data-testid="slice-report-probe"
        onClick={() => props.onProbeChange({
          plane: 'axial',
          point: { z: 4, y: 5, x: 6 },
          intensity: 72,
          label: 2,
          organName: 'kidney_right',
        })}
      >
        Report Probe
      </button>
    </div>
  ),
}));

const MOCK_RESULT = {
  organs: [
    {
      id: 1,
      name: 'spleen',
      color: [157, 108, 162],
      file: 'spleen.stl',
      vertex_count: 5000,
      category: 'organs',
    },
    {
      id: 2,
      name: 'kidney_right',
      color: [185, 102, 83],
      file: 'kidney_right.stl',
      vertex_count: 4000,
      category: 'organs',
    },
    {
      id: 3,
      name: 'rib_left_1',
      color: [241, 214, 145],
      file: 'rib_left_1.stl',
      vertex_count: 2500,
      category: 'bones',
    },
    {
      id: 4,
      name: 'gluteus_maximus_left',
      color: [198, 124, 110],
      file: 'gluteus_maximus_left.stl',
      vertex_count: 2200,
      category: 'muscles',
    },
  ],
  preload: ['spleen'],
  volume: {
    intensity: {
      file: 'volume.raw',
      dimensions: [10, 12, 14],
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      dtype: 'int16',
      byte_order: 'little',
      high_quality: false,
      min_hu: -1024,
      max_hu: 1400,
      study: {
        patient_name: 'Doe^Jane',
        patient_id: 'MRN-101',
        patient_sex: 'F',
        patient_age: '034Y',
        study_description: 'Abdominal CT',
        series_description: 'Portal venous phase',
        study_date: '20260505',
        modality: 'CT',
        institution_name: 'Supernova Medical Center',
        manufacturer: 'Acme Imaging',
        slice_count: 10,
      },
    },
    segmentation: {
      file: 'segmentation.raw',
      dimensions: [10, 12, 14],
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      dtype: 'uint16',
      byte_order: 'little',
      high_quality: false,
    },
  },
};

async function renderViewerPage() {
  render(<ViewerPage />);

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ViewerPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetJobResults.mockResolvedValue(MOCK_RESULT);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns to the catalog from the viewer header', async () => {
    await renderViewerPage();

    fireEvent.click(screen.getByTestId('viewer-back-button'));

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('waits for the dwell timer before activating renderer hover details', async () => {
    await renderViewerPage();

    fireEvent.mouseEnter(screen.getByTestId('renderer-hover-spleen'));

    expect(screen.queryByTestId('organ-hover-tooltip')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(HOVER_DWELL_MS - 1);
    });

    expect(screen.queryByTestId('organ-hover-tooltip')).not.toBeInTheDocument();
    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('');

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('spleen');
    expect(screen.getByTestId('organ-hover-tooltip')).toHaveTextContent('Spleen');
  });

  it('shows all returned organs on the initial render', async () => {
    await renderViewerPage();

    expect(screen.getByTestId('panel-visible-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');
    expect(screen.getByTestId('renderer-requested-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');
    expect(screen.getByTestId('renderer-displayed-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');
  });

  it('temporarily reveals a hidden organ after a sidebar dwell without mutating visible selections', async () => {
    await renderViewerPage();

    expect(screen.getByTestId('panel-visible-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');

    const sidebarHover = screen.getByTestId('sidebar-hover-kidney');
    fireEvent.mouseEnter(sidebarHover);

    expect(screen.getByTestId('renderer-requested-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');
    expect(screen.getByTestId('renderer-displayed-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');

    await act(async () => {
      vi.advanceTimersByTime(HOVER_DWELL_MS);
    });

    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('kidney_right');
    expect(screen.getByTestId('renderer-displayed-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');
    expect(screen.getByTestId('panel-visible-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');

    fireEvent.mouseLeave(sidebarHover);

    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('kidney_right');

    await act(async () => {
      vi.advanceTimersByTime(HOVER_EXIT_GRACE_MS);
    });

    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('');
    expect(screen.getByTestId('renderer-displayed-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');
  });

  it('clears pending and active hover details when the feature is disabled', async () => {
    await renderViewerPage();

    const sidebarHover = screen.getByTestId('sidebar-hover-kidney');
    fireEvent.mouseEnter(sidebarHover);

    await act(async () => {
      vi.advanceTimersByTime(HOVER_DWELL_MS);
    });

    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('kidney_right');
    expect(screen.getByTestId('organ-hover-tooltip')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('disable-hover-details'));

    expect(screen.getByTestId('panel-hover-enabled')).toHaveTextContent('false');
    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('');
    expect(screen.getByTestId('renderer-requested-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');
    expect(screen.getByTestId('renderer-displayed-organs')).toHaveTextContent('gluteus_maximus_left,kidney_right,rib_left_1,spleen');
    expect(screen.queryByTestId('organ-hover-tooltip')).not.toBeInTheDocument();
  });

  it('lets the user pin a hovered organ and keep it focused during renderer interaction', async () => {
    await renderViewerPage();

    fireEvent.mouseEnter(screen.getByTestId('renderer-hover-spleen'));

    await act(async () => {
      vi.advanceTimersByTime(HOVER_DWELL_MS);
    });

    fireEvent.mouseLeave(screen.getByTestId('renderer-hover-spleen'));

    expect(screen.getByTestId('organ-hover-tooltip')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('organ-hover-pin-toggle'));

    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('spleen');
    expect(screen.getByTestId('organ-hover-pin-toggle')).toHaveTextContent('Unpin');
    expect(screen.getByTestId('organ-hover-tooltip')).toHaveTextContent('Pinned Focus');

    fireEvent.pointerDown(screen.getByTestId('vtk-renderer-mock'));

    await act(async () => {
      vi.advanceTimersByTime(HOVER_EXIT_GRACE_MS);
    });

    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('spleen');
    expect(screen.getByTestId('organ-hover-tooltip')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('organ-hover-pin-toggle'));

    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('');
    expect(screen.queryByTestId('organ-hover-tooltip')).not.toBeInTheDocument();
  });

  it('unpins the focused organ on Escape', async () => {
    await renderViewerPage();

    fireEvent.mouseEnter(screen.getByTestId('renderer-hover-spleen'));

    await act(async () => {
      vi.advanceTimersByTime(HOVER_DWELL_MS);
    });

    fireEvent.click(screen.getByTestId('organ-hover-pin-toggle'));
    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('spleen');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByTestId('renderer-active-hover-name')).toHaveTextContent('');
    expect(screen.queryByTestId('organ-hover-tooltip')).not.toBeInTheDocument();
  });

  it('switches between model and slice mode and preserves slice cursor state', async () => {
    await renderViewerPage();

    expect(screen.getByTestId('viewer-controls-mock')).toHaveAttribute('data-view-mode', 'model');
    expect(screen.getByTestId('vtk-renderer-mock')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('switch-to-slice'));

    expect(screen.getByTestId('viewer-controls-mock')).toHaveAttribute('data-view-mode', 'slice');
    expect(screen.getByTestId('slice-viewport-mock')).toBeInTheDocument();
    expect(screen.getByTestId('slice-cursor')).toHaveTextContent('4,5,6');

    fireEvent.click(screen.getByTestId('slice-move-cursor'));
    expect(screen.getByTestId('slice-cursor')).toHaveTextContent('1,2,3');

    fireEvent.click(screen.getByTestId('switch-to-model'));

    expect(screen.getByTestId('viewer-controls-mock')).toHaveAttribute('data-view-mode', 'model');
    expect(screen.getByTestId('vtk-renderer-mock')).toBeInTheDocument();
  });

  it('shows hover details for slice-pane hover targets after the dwell timer', async () => {
    await renderViewerPage();

    fireEvent.click(screen.getByTestId('switch-to-slice'));
    fireEvent.mouseEnter(screen.getByTestId('slice-hover-kidney'));

    await act(async () => {
      vi.advanceTimersByTime(HOVER_DWELL_MS);
    });

    expect(screen.getByTestId('slice-active-hover-name')).toHaveTextContent('kidney_right');
    expect(screen.getByTestId('organ-hover-tooltip')).toHaveTextContent('Kidney Right');

    fireEvent.mouseLeave(screen.getByTestId('slice-hover-kidney'));

    await act(async () => {
      vi.advanceTimersByTime(HOVER_EXIT_GRACE_MS);
    });

    expect(screen.getByTestId('slice-active-hover-name')).toHaveTextContent('');
    expect(screen.queryByTestId('organ-hover-tooltip')).not.toBeInTheDocument();
  });

  it('renders study metadata and lets the user collapse the metadata panel', async () => {
    await renderViewerPage();

    expect(screen.getByTestId('study-metadata-panel')).toHaveTextContent('Doe Jane');
    expect(screen.getByTestId('study-metadata-panel')).toHaveTextContent('Abdominal CT');

    fireEvent.click(screen.getByTestId('study-metadata-panel-collapse'));

    expect(screen.queryByTestId('study-metadata-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('study-metadata-panel-reopen')).toBeInTheDocument();
  });

  it('applies visibility presets and updates the organ list plus rendered organs', async () => {
    await renderViewerPage();

    expect(screen.getByTestId('panel-organs')).toHaveTextContent('spleen,kidney_right,rib_left_1,gluteus_maximus_left');

    fireEvent.change(screen.getByTestId('visibility-preset-select'), {
      target: { value: 'bones' },
    });
    expect(screen.getByTestId('panel-organs')).toHaveTextContent('rib_left_1');
    expect(screen.getByTestId('panel-visible-organs')).toHaveTextContent('rib_left_1');
    expect(screen.getByTestId('renderer-requested-organs')).toHaveTextContent('rib_left_1');

    fireEvent.change(screen.getByTestId('visibility-preset-select'), {
      target: { value: 'organs' },
    });
    expect(screen.getByTestId('panel-organs')).toHaveTextContent('spleen,kidney_right');
    expect(screen.getByTestId('panel-visible-organs')).toHaveTextContent('kidney_right,spleen');

    fireEvent.change(screen.getByTestId('visibility-preset-select'), {
      target: { value: 'muscles' },
    });
    expect(screen.getByTestId('panel-organs')).toHaveTextContent('gluteus_maximus_left');
    expect(screen.getByTestId('panel-visible-organs')).toHaveTextContent('gluteus_maximus_left');

    fireEvent.change(screen.getByTestId('visibility-preset-select'), {
      target: { value: 'all' },
    });
    expect(screen.getByTestId('panel-organs')).toHaveTextContent('spleen,kidney_right,rib_left_1,gluteus_maximus_left');
  });

  it('collapses and reopens the reader and organ panels', async () => {
    await renderViewerPage();

    fireEvent.click(screen.getByTestId('viewer-tool-panel-collapse'));
    expect(screen.queryByTestId('visibility-preset-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('viewer-tool-panel-reopen')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('collapse-organ-panel'));
    expect(screen.queryByTestId('organ-panel-mock')).not.toBeInTheDocument();
    expect(screen.getByTestId('organ-panel-reopen')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('viewer-tool-panel-reopen'));
    expect(screen.getByTestId('visibility-preset-select')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('organ-panel-reopen'));
    expect(screen.getByTestId('organ-panel-mock')).toBeInTheDocument();
  });

  it('switches into slice mode when slice tools are activated from model mode', async () => {
    await renderViewerPage();

    expect(screen.getByTestId('viewer-controls-mock')).toHaveAttribute('data-view-mode', 'model');

    fireEvent.click(screen.getByTestId('viewer-tool-distance'));

    expect(screen.getByTestId('viewer-controls-mock')).toHaveAttribute('data-view-mode', 'slice');
    expect(screen.getByTestId('slice-interaction-mode')).toHaveTextContent('distance');

    fireEvent.click(screen.getByTestId('slice-report-distance'));
    expect(screen.getByText('16.4 mm')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('viewer-tool-probe'));
    expect(screen.getByTestId('slice-interaction-mode')).toHaveTextContent('probe');

    fireEvent.click(screen.getByTestId('slice-report-probe'));
    expect(screen.getByText('72 HU')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('anatomy-labels-toggle'));
    expect(screen.getByTestId('slice-labels-enabled')).toHaveTextContent('false');

    fireEvent.click(screen.getByTestId('viewer-tool-navigate'));
    expect(screen.getByTestId('slice-interaction-mode')).toHaveTextContent('navigate');
  });
});