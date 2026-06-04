import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StudyMetadataPanel from '../components/StudyMetadataPanel';

describe('StudyMetadataPanel', () => {
  it('renders MRI studies without CT-specific fallback text or HU labels', () => {
    const onCollapse = vi.fn();

    render(
      <StudyMetadataPanel
        asset={{
          file: 'volume.raw',
          dimensions: [10, 12, 14],
          spacing: [1, 1, 1],
          origin: [0, 0, 0],
          dtype: 'int16',
          byte_order: 'little',
          high_quality: false,
          min_value: 120,
          max_value: 480,
          intensity_unit: 'signal',
          study: {
            modality: 'MR',
            patient_name: 'Doe^Jane',
          },
        }}
        onCollapse={onCollapse}
      />,
    );

    expect(screen.getByTestId('study-metadata-panel')).toHaveTextContent('Study Overview');
    expect(screen.getByTestId('study-metadata-panel')).toHaveTextContent('MR');
    expect(screen.getByTestId('study-metadata-panel')).toHaveTextContent('Intensity Range');
    expect(screen.getByTestId('study-metadata-panel')).toHaveTextContent('120 to 480');
    expect(screen.getByTestId('study-metadata-panel')).not.toHaveTextContent('CT Study Overview');
    expect(screen.getByTestId('study-metadata-panel')).not.toHaveTextContent('HU Range');

    fireEvent.click(screen.getByTestId('study-metadata-panel-collapse'));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});