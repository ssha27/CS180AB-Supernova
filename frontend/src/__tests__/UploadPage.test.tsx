import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import UploadPage from '../pages/UploadPage';

// Mock the API module
vi.mock('../utils/api', () => ({
  uploadDicom: vi.fn(),
  checkMemory: vi.fn().mockResolvedValue({ sufficient: true, available_gb: 32, required_gb: 12, message: 'OK' }),
  getRecentUploads: vi.fn().mockResolvedValue([]),
}));

// Mock react-router-dom navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

async function renderUploadPage() {
  render(
    <BrowserRouter>
      <UploadPage />
    </BrowserRouter>,
  );

  await act(async () => {
    await Promise.resolve();
  });
}

describe('UploadPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the title and drop zone', async () => {
    await renderUploadPage();
    expect(screen.getByText('Supernova')).toBeInTheDocument();
    expect(screen.getByText(/Drop your DICOM ZIP file here/i)).toBeInTheDocument();
  });

  it('has a disabled upload button initially', async () => {
    await renderUploadPage();
    const button = screen.getByText('Start Processing');
    expect(button).toBeDisabled();
  });

  it('shows quality toggles', async () => {
    await renderUploadPage();
    expect(screen.getByText('Fast')).toBeInTheDocument();
    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows error for non-zip file', async () => {
    await renderUploadPage();
    const input = screen.getByTestId('file-input');
    const file = new File(['data'], 'scan.txt', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
  });

  it('shows file name after selecting zip', async () => {
    await renderUploadPage();
    const input = screen.getByTestId('file-input');
    const file = new File(['data'], 'scan.zip', { type: 'application/zip' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('scan.zip')).toBeInTheDocument();
    });
  });

  it('enables upload button after file selection', async () => {
    await renderUploadPage();
    const input = screen.getByTestId('file-input');
    const file = new File(['data'], 'scan.zip', { type: 'application/zip' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const button = screen.getByText('Start Processing');
      expect(button).not.toBeDisabled();
    });
  });

  it('navigates on successful upload', async () => {
    const { uploadDicom } = await import('../utils/api');
    (uploadDicom as ReturnType<typeof vi.fn>).mockResolvedValue({ job_id: 'abc123', message: 'OK' });

    await renderUploadPage();
    const input = screen.getByTestId('file-input');
    const file = new File(['data'], 'scan.zip', { type: 'application/zip' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Start Processing')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByText('Start Processing'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/processing/abc123');
    });
  });

  it('shows recent uploads and opens a completed cached study', async () => {
    const { getRecentUploads } = await import('../utils/api');
    (getRecentUploads as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        job_id: 'recent123',
        file_name: 'recent-scan.zip',
        status: 'completed',
        progress: 100,
        message: 'Processing complete!',
        error: null,
        seg_quality: 'fast',
        vol_quality: 'standard',
        created_at: '2026-04-27T10:15:00+00:00',
        updated_at: '2026-04-27T10:20:00+00:00',
        result_available: true,
        organ_count: 4,
        preview_organs: ['spleen', 'liver'],
      },
    ]);

    await renderUploadPage();

    expect(await screen.findByText('recent-scan.zip')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('recent-upload-recent123'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/viewer/recent123');
    });
  });
});
