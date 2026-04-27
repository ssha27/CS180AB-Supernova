import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import LoadingPage from '../pages/LoadingPage';

const mockNavigate = vi.fn();

// Mock useWebSocket
vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: vi.fn().mockReturnValue({
    progress: {
      job_id: 'test123',
      status: 'segmenting',
      progress: 45,
      message: 'Running AI segmentation model...',
      elapsed_seconds: 120,
    },
    connected: true,
  }),
}));

// Mock useParams
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ jobId: 'test123' }),
    useNavigate: () => mockNavigate,
  };
});

function renderLoadingPage() {
  render(
    <BrowserRouter>
      <LoadingPage />
    </BrowserRouter>,
  );
}

async function renderSettledLoadingPage() {
  renderLoadingPage();

  await act(async () => {
    await Promise.resolve();
  });
}

describe('LoadingPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the progress value', async () => {
    await renderSettledLoadingPage();
    expect(screen.getByTestId('progress-value')).toHaveTextContent('45%');
  });

  it('shows the status message', async () => {
    await renderSettledLoadingPage();
    expect(screen.getByTestId('status-message')).toHaveTextContent(
      'Running AI segmentation model...',
    );
  });

  it('shows elapsed time', async () => {
    await renderSettledLoadingPage();
    expect(screen.getByTestId('elapsed-time')).toHaveTextContent('Elapsed: 2:00');
  });

  it('continues elapsed time from the server progress when the page is revisited', async () => {
    await renderSettledLoadingPage();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByTestId('elapsed-time')).toHaveTextContent('Elapsed: 2:05');
  });

  it('shows the title', async () => {
    await renderSettledLoadingPage();
    expect(screen.getByText('Processing CT Scan')).toBeInTheDocument();
  });

  it('returns to the home screen from the processing page', async () => {
    await renderSettledLoadingPage();

    fireEvent.click(screen.getByTestId('loading-back-home-button'));

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
