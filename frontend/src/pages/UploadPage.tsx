import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadDicom, checkMemory, getRecentUploads, type RecentUpload } from '../utils/api';

const ACTIVE_UPLOAD_STATUSES = new Set([
  'pending',
  'validating',
  'segmenting',
  'meshing',
  'volume_prep',
]);

function formatUploadTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown upload time';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function formatStatus(status: string): string {
  if (!status) {
    return 'Unknown';
  }

  return status
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function getRecentUploadTarget(upload: RecentUpload): string | null {
  if (upload.status === 'completed' && upload.result_available) {
    return `/viewer/${upload.job_id}`;
  }

  if (ACTIVE_UPLOAD_STATUSES.has(upload.status)) {
    return `/processing/${upload.job_id}`;
  }

  return null;
}

function getStatusTone(status: string, resultAvailable: boolean): string {
  if (status === 'completed' && resultAvailable) {
    return 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200';
  }

  if (ACTIVE_UPLOAD_STATUSES.has(status)) {
    return 'border-sky-400/35 bg-sky-400/10 text-sky-200';
  }

  if (status === 'failed') {
    return 'border-rose-400/35 bg-rose-400/10 text-rose-200';
  }

  return 'border-slate-500/35 bg-slate-500/10 text-slate-200';
}

export default function UploadPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [segQuality, setSegQuality] = useState<'fast' | 'full'>('fast');
  const [volQuality, setVolQuality] = useState<'standard' | 'high'>('standard');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memoryWarning, setMemoryWarning] = useState<string | null>(null);
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);

  const loadRecentUploads = useCallback(async () => {
    setRecentLoading(true);

    try {
      const uploads = await getRecentUploads();
      if (!mountedRef.current) {
        return;
      }

      setRecentUploads(uploads);
      setRecentError(null);
    } catch {
      if (!mountedRef.current) {
        return;
      }

      setRecentError('Failed to load recent uploads.');
    } finally {
      if (mountedRef.current) {
        setRecentLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadRecentUploads();

    return () => {
      mountedRef.current = false;
    };
  }, [loadRecentUploads]);

  const handleFile = useCallback(async (f: File) => {
    if (!f.name.toLowerCase().endsWith('.zip')) {
      setError('Please upload a ZIP file containing DICOM images');
      return;
    }
    setFile(f);
    setError(null);

    // Check memory
    try {
      const mem = await checkMemory(segQuality);
      if (!mem.sufficient) {
        setMemoryWarning(mem.message);
      } else {
        setMemoryWarning(null);
      }
    } catch {
      // Non-blocking — don't prevent upload
    }
  }, [segQuality]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFile(droppedFile);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragActive(false);
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const result = await uploadDicom(file, segQuality, volQuality);
      navigate(`/processing/${result.job_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  };

  const handleRecentUploadClick = (upload: RecentUpload) => {
    const target = getRecentUploadTarget(upload);
    if (!target) {
      return;
    }

    navigate(target);
  };

  return (
    <div className="h-screen overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.16),transparent_28%),#020617]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-6 lg:px-10 lg:py-8">
        <header className="relative overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/70 p-8 shadow-[0_30px_120px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.18),transparent_72%)] lg:block" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-sky-300/80">
                Cached Catalog
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Supernova Academy Inc.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
                CT Scan 3D Segmentation Viewer.
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,420px)] lg:items-start">
          <section className="rounded-[28px] border border-white/10 bg-slate-950/72 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Catalog</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Recent Uploads</h2>
              </div>
              <button
                type="button"
                onClick={() => void loadRecentUploads()}
                className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
              >
                Refresh
              </button>
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              Resume processing in-flight uploads or reopen completed models from the cached result bundle.
            </p>

            <div className="mt-6 space-y-3" data-testid="recent-uploads-panel">
              {recentLoading ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-6 text-sm text-slate-400">
                  Loading recent uploads...
                </div>
              ) : recentError ? (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-6 text-sm text-rose-200">
                  {recentError}
                </div>
              ) : recentUploads.length === 0 ? (
                <div
                  className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-5 py-8 text-sm text-slate-400"
                  data-testid="recent-uploads-empty"
                >
                  Your latest five uploads will appear here after you start processing a scan.
                </div>
              ) : (
                recentUploads.map((upload) => {
                  const target = getRecentUploadTarget(upload);

                  return (
                    <button
                      key={upload.job_id}
                      type="button"
                      onClick={() => handleRecentUploadClick(upload)}
                      disabled={!target}
                      data-testid={`recent-upload-${upload.job_id}`}
                      className={`w-full rounded-[24px] border p-5 text-left transition-all ${
                        target
                          ? 'border-white/10 bg-slate-900/80 hover:border-sky-300/40 hover:bg-slate-900'
                          : 'border-slate-800 bg-slate-900/55 text-slate-500'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-lg font-semibold text-white">
                            {upload.file_name}
                          </p>
                          <p className="mt-1 text-sm text-slate-400">
                            Uploaded {formatUploadTimestamp(upload.created_at)}
                          </p>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${getStatusTone(upload.status, upload.result_available)}`}>
                          {formatStatus(upload.status)}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                        <span className="rounded-full border border-slate-700/80 px-3 py-1">
                          {upload.seg_quality} Segmentation
                        </span>
                        <span className="rounded-full border border-slate-700/80 px-3 py-1">
                          {upload.vol_quality} Volume
                        </span>
                        {upload.status === 'completed' && upload.result_available && (
                          <span className="rounded-full border border-emerald-400/25 px-3 py-1 text-emerald-200">
                            {upload.organ_count} Organs Ready
                          </span>
                        )}
                      </div>

                      {ACTIVE_UPLOAD_STATUSES.has(upload.status) && (
                        <div className="mt-4">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-300 transition-[width]"
                              style={{ width: `${Math.max(upload.progress, 4)}%` }}
                            />
                          </div>
                          <p className="mt-2 text-sm text-slate-300">{upload.message}</p>
                        </div>
                      )}

                      {upload.status === 'completed' && upload.preview_organs.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {upload.preview_organs.map((organ) => (
                            <span
                              key={`${upload.job_id}-${organ}`}
                              className="rounded-full bg-white/6 px-3 py-1 text-xs text-slate-300"
                            >
                              {organ}
                            </span>
                          ))}
                        </div>
                      )}

                      {upload.error && (
                        <p className="mt-4 text-sm text-rose-300">{upload.error}</p>
                      )}

                      <div className="mt-5 flex items-center justify-between text-sm">
                        <span className="text-slate-400">{upload.message}</span>
                        <span className={target ? 'font-semibold text-sky-200' : 'font-semibold text-slate-500'}>
                          {upload.status === 'completed' && upload.result_available
                            ? 'Open Viewer'
                            : ACTIVE_UPLOAD_STATUSES.has(upload.status)
                              ? 'Resume Processing'
                              : 'Unavailable'}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-slate-950/76 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)] backdrop-blur-xl">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Upload</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Upload File</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Start a new CT upload here. Once processing begins, the study is added to the catalog automatically.
              </p>
            </div>

            <div
              data-testid="drop-zone"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-6 rounded-[24px] border-2 border-dashed p-12 text-center transition-colors ${
                dragActive
                  ? 'border-sky-400 bg-sky-400/10'
                  : file
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-slate-700 bg-slate-900/80 hover:border-slate-500'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                data-testid="file-input"
                onChange={(e) => {
                  const nextFile = e.target.files?.[0];
                  if (nextFile) handleFile(nextFile);
                }}
              />
              {file ? (
                <div>
                  <p className="text-lg font-medium text-emerald-300">{file.name}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                    Click or drop to replace
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-lg text-slate-200">Drop your DICOM ZIP file here</p>
                  <p className="mt-2 text-sm text-slate-500">or click to browse</p>
                </div>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-sm text-slate-400">Segmentation Quality</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSegQuality('fast')}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      segQuality === 'fast'
                        ? 'bg-sky-500 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Fast
                  </button>
                  <button
                    onClick={() => setSegQuality('full')}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      segQuality === 'full'
                        ? 'bg-sky-500 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Full
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Volume Quality</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setVolQuality('standard')}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      volQuality === 'standard'
                        ? 'bg-sky-500 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Standard
                  </button>
                  <button
                    onClick={() => setVolQuality('high')}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      volQuality === 'high'
                        ? 'bg-sky-500 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    High
                  </button>
                </div>
              </div>
            </div>

            {memoryWarning && (
              <div className="mt-4 rounded-2xl border border-yellow-700 bg-yellow-900/30 p-3 text-sm text-yellow-300">
                ⚠ {memoryWarning}
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-2xl border border-red-700 bg-red-900/30 p-3 text-sm text-red-300" data-testid="error-message">
                {error}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className={`mt-6 w-full rounded-2xl py-3 text-lg font-semibold transition-all ${
                file && !uploading
                  ? 'bg-gradient-to-r from-sky-500 to-cyan-400 text-white shadow-[0_20px_45px_rgba(14,165,233,0.3)] hover:from-sky-400 hover:to-cyan-300'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              {uploading ? 'Uploading...' : 'Start Processing'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
