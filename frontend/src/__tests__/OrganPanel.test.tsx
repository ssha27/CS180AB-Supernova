import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrganPanel from '../components/OrganPanel';
import type { OrganInfo } from '../utils/api';

const MOCK_ORGANS: OrganInfo[] = [
  { id: 1, name: 'spleen', color: [157, 108, 162], file: 'spleen.stl', vertex_count: 5000, category: 'organs' },
  { id: 2, name: 'kidney_right', color: [185, 102, 83], file: 'kidney_right.stl', vertex_count: 4000, category: 'organs' },
  { id: 5, name: 'liver', color: [221, 130, 101], file: 'liver.stl', vertex_count: 8000, category: 'organs' },
  { id: 22, name: 'rib_left_1', color: [241, 214, 145], file: 'rib_left_1.stl', vertex_count: 2000, category: 'bones' },
  { id: 51, name: 'aorta', color: [224, 97, 76], file: 'aorta.stl', vertex_count: 6000, category: 'vessels' },
];

function renderOrganPanel(props: Partial<Parameters<typeof OrganPanel>[0]> = {}) {
  const defaultProps = {
    organs: MOCK_ORGANS,
    visibleOrgans: new Set(['spleen', 'liver']),
    hoverDetailsEnabled: true,
    activeHoverName: null,
    onToggle: vi.fn(),
    onShowAll: vi.fn(),
    onHideAll: vi.fn(),
    onShowCategory: vi.fn(),
    onHideCategory: vi.fn(),
    onHoverDetailsEnabledChange: vi.fn(),
    onHoverCandidateChange: vi.fn(),
    ...props,
  };
  return render(<OrganPanel {...defaultProps} />);
}

describe('OrganPanel', () => {
  it('renders organ count', () => {
    renderOrganPanel();
    expect(screen.getByText('Organs (2/5)')).toBeInTheDocument();
  });

  it('renders show/hide all buttons', () => {
    renderOrganPanel();
    expect(screen.getByText('Show All')).toBeInTheDocument();
    expect(screen.getByText('Hide All')).toBeInTheDocument();
  });

  it('renders organ names without underscores', () => {
    renderOrganPanel();
    expect(screen.getByText('kidney right')).toBeInTheDocument();
    expect(screen.getByText('rib left 1')).toBeInTheDocument();
  });

  it('renders categories', () => {
    renderOrganPanel();
    // Categories should appear as collapsible buttons with counts
    expect(screen.getByText(/organs\s*\(\s*3\s*\)/i)).toBeInTheDocument();
    expect(screen.getByText(/bones\s*\(\s*1\s*\)/i)).toBeInTheDocument();
    expect(screen.getByText(/vessels\s*\(\s*1\s*\)/i)).toBeInTheDocument();
  });

  it('calls onToggle when clicking organ', () => {
    const onToggle = vi.fn();
    renderOrganPanel({ onToggle });

    fireEvent.click(screen.getByText('spleen'));
    expect(onToggle).toHaveBeenCalledWith('spleen');
  });

  it('calls onShowAll when clicking Show All', () => {
    const onShowAll = vi.fn();
    renderOrganPanel({ onShowAll });

    fireEvent.click(screen.getByText('Show All'));
    expect(onShowAll).toHaveBeenCalled();
  });

  it('filters organs on search', () => {
    renderOrganPanel();
    const search = screen.getByTestId('organ-search');

    fireEvent.change(search, { target: { value: 'kidney' } });

    expect(screen.getByText('kidney right')).toBeInTheDocument();
    expect(screen.queryByText('spleen')).not.toBeInTheDocument();
    expect(screen.queryByText('aorta')).not.toBeInTheDocument();
  });

  it('shows search input', () => {
    renderOrganPanel();
    expect(screen.getByTestId('organ-search')).toBeInTheDocument();
  });

  it('renders hover details toggle as enabled by default', () => {
    renderOrganPanel();
    expect(screen.getByTestId('hover-details-toggle')).toBeChecked();
  });

  it('calls onHoverDetailsEnabledChange when hover details is toggled', () => {
    const onHoverDetailsEnabledChange = vi.fn();
    renderOrganPanel({ onHoverDetailsEnabledChange });

    fireEvent.click(screen.getByTestId('hover-details-toggle'));
    expect(onHoverDetailsEnabledChange).toHaveBeenCalledWith(false);
  });

  it('emits sidebar hover targets for organ rows', () => {
    const onHoverCandidateChange = vi.fn();
    renderOrganPanel({ onHoverCandidateChange });

    const organRow = screen.getByTestId('organ-row-spleen');
    fireEvent.mouseEnter(organRow);

    expect(onHoverCandidateChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'spleen', source: 'sidebar' }),
    );

    fireEvent.mouseLeave(organRow);
    expect(onHoverCandidateChange).toHaveBeenLastCalledWith(null);
  });

  it('marks the active hover row', () => {
    renderOrganPanel({ activeHoverName: 'spleen' });

    expect(screen.getByTestId('organ-row-spleen')).toHaveAttribute(
      'data-active-hover',
      'true',
    );
    expect(screen.getByTestId('organ-row-liver')).toHaveAttribute(
      'data-active-hover',
      'false',
    );
  });
});
