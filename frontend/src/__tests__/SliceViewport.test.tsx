import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SliceViewport from '../components/SliceViewport';

vi.mock('../components/VTKRenderer', () => ({
  default: () => <div data-testid="vtk-renderer-mock" />,
}));

const mockFetch = vi.fn();

const originalFetch = global.fetch;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
const originalCanvasGetContext = HTMLCanvasElement.prototype.getContext;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const originalResizeObserver = global.ResizeObserver;
const originalImageData = global.ImageData;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

const TEST_DIMENSIONS: [number, number, number] = [85, 64, 64];
const TEST_SPACING: [number, number, number] = [6, 8, 8];
const TEST_VOXEL_COUNT = TEST_DIMENSIONS[0] * TEST_DIMENSIONS[1] * TEST_DIMENSIONS[2];

function createBinaryResponse(view: Int16Array | Uint16Array) {
  return {
    ok: true,
    arrayBuffer: async () => view.slice().buffer,
  } as Response;
}

describe('SliceViewport', () => {
  beforeEach(() => {
    global.fetch = mockFetch as typeof fetch;
    global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
    global.ImageData = class ImageDataMock {
      data: Uint8ClampedArray;
      width: number;
      height: number;

      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    } as typeof ImageData;

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 512;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 512;
      },
    });

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 512,
        bottom: 512,
        width: 512,
        height: 512,
        toJSON: () => ({}),
      } as DOMRect;
    };

    const mockContext = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      putImageData: vi.fn(),
      imageSmoothingEnabled: false,
    };

    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => mockContext as unknown as CanvasRenderingContext2D,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('volume.raw')) {
        return createBinaryResponse(new Int16Array(TEST_VOXEL_COUNT).fill(120));
      }
      if (url.includes('segmentation.raw')) {
        return createBinaryResponse(new Uint16Array(TEST_VOXEL_COUNT).fill(2));
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
  });

  afterEach(() => {
    mockFetch.mockReset();
    global.fetch = originalFetch;
    global.ResizeObserver = originalResizeObserver;
    global.ImageData = originalImageData;
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;

    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }

    HTMLCanvasElement.prototype.getContext = originalCanvasGetContext;
  });

  it('renders spacing-aware display geometry for coronal and sagittal panes', async () => {
    render(
      <SliceViewport
        jobId="job-123"
        volume={{
          intensity: {
            file: 'volume.raw',
            dimensions: TEST_DIMENSIONS,
            spacing: TEST_SPACING,
            origin: [0, 0, 0],
            dtype: 'int16',
            byte_order: 'little',
            high_quality: false,
          },
          segmentation: {
            file: 'segmentation.raw',
            dimensions: TEST_DIMENSIONS,
            spacing: TEST_SPACING,
            origin: [0, 0, 0],
            dtype: 'uint16',
            byte_order: 'little',
            high_quality: false,
          },
        }}
        organs={[
          {
            id: 2,
            name: 'kidney_right',
            color: [185, 102, 83],
            file: 'kidney_right.stl',
            vertex_count: 4000,
            category: 'organs',
          },
        ]}
        requestedOrgans={new Set()}
        displayedOrgans={new Set(['kidney_right'])}
        activeHoverName={null}
        hoverDetailsEnabled={true}
        cursor={{ z: 0, y: 0, x: 0 }}
        onCursorChange={vi.fn()}
        onHoverCandidateChange={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Axial')).toBeInTheDocument();
    expect(screen.getByText('Coronal')).toBeInTheDocument();
    expect(screen.getByText('Sagittal')).toBeInTheDocument();
    expect(screen.getAllByText(/512\s*x\s*510/)).toHaveLength(2);
  });
});