import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ClippingControls from '../components/ClippingControls';

function renderClippingControls(overrides = {}) {
  const defaultClipping = {
    axial: { enabled: false, value: 0.5 },
    coronal: { enabled: false, value: 0.5 },
    sagittal: { enabled: false, value: 0.5 },
  };
  const onChange = vi.fn();
  const props = { clipping: { ...defaultClipping, ...overrides }, onChange };
  render(<ClippingControls {...props} />);
  return { onChange };
}

describe('ClippingControls', () => {
  it('renders three plane toggles', () => {
    renderClippingControls();
    expect(screen.getByTestId('clip-toggle-axial')).toBeInTheDocument();
    expect(screen.getByTestId('clip-toggle-coronal')).toBeInTheDocument();
    expect(screen.getByTestId('clip-toggle-sagittal')).toBeInTheDocument();
  });

  it('renders three sliders', () => {
    renderClippingControls();
    expect(screen.getByTestId('clip-slider-axial')).toBeInTheDocument();
    expect(screen.getByTestId('clip-slider-coronal')).toBeInTheDocument();
    expect(screen.getByTestId('clip-slider-sagittal')).toBeInTheDocument();
  });

  it('calls onChange when toggling a plane', () => {
    const { onChange } = renderClippingControls();
    fireEvent.click(screen.getByTestId('clip-toggle-axial'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        axial: { enabled: true, value: 0.5 },
      }),
    );
  });

  it('keeps sliders interactive when plane is off', () => {
    renderClippingControls();
    expect(screen.getByTestId('clip-slider-axial')).not.toBeDisabled();
  });

  it('enables a plane when its slider changes', () => {
    const { onChange } = renderClippingControls();

    fireEvent.change(screen.getByTestId('clip-slider-axial'), {
      target: { value: '0.72' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        axial: { enabled: true, value: 0.72 },
      }),
    );
  });
});
