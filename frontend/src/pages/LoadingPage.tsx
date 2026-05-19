import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';

export default function LoadingPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { progress } = useWebSocket(jobId);
  const [elapsed, setElapsed] = useState(0);
  const elapsedAnchorRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof progress?.elapsed_seconds !== 'number') {
      return;
    }

    const safeElapsed = Math.max(0, Math.floor(progress.elapsed_seconds));
    elapsedAnchorRef.current = Date.now() - safeElapsed * 1000;
    setElapsed(safeElapsed);
  }, [progress?.elapsed_seconds]);

  useEffect(() => {
    const updateElapsed = () => {
      if (elapsedAnchorRef.current === null) {
        return;
      }

      setElapsed(Math.max(0, Math.floor((Date.now() - elapsedAnchorRef.current) / 1000)));
    };

    const timer = setInterval(() => {
      updateElapsed();
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Navigate to viewer when complete
  useEffect(() => {
    if (progress?.status === 'completed') {
      navigate(`/viewer/${jobId}`);
    }
  }, [progress?.status, jobId, navigate]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const pct = progress?.progress ?? 0;
  const status = progress?.status ?? 'pending';
  const message = progress?.message ?? 'Connecting...';
  const isFailed = status === 'failed';

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_30%),#020617] p-8">
      <div className="absolute right-6 top-6 z-10">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-full border border-white/15 bg-slate-950/88 px-4 py-2 text-sm font-semibold text-slate-100 shadow-[0_14px_32px_rgba(15,23,42,0.38)] backdrop-blur-md transition-colors hover:border-sky-300/45 hover:text-sky-100"
          data-testid="loading-back-home-button"
        >
          Back to Home
        </button>
      </div>

      <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-slate-950/72 p-8 text-center shadow-[0_30px_120px_rgba(15,23,42,0.45)] backdrop-blur-xl">
        <h1 className="text-3xl font-bold mb-8 tracking-tight">
          Processing CT Scan
        </h1>

        <p className="mb-6 text-sm leading-6 text-slate-400">
          Processing continues on the server. You can return to the home screen and reopen this job from Recent Uploads at any time.
        </p>

        {/* Progress ring */}
        <div className="relative w-48 h-48 mx-auto mb-8">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="42"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              className="text-gray-800"
            />
            <circle
              cx="50" cy="50" r="42"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeDasharray={`${2 * Math.PI * 42}`}
              strokeDashoffset={`${2 * Math.PI * 42 * (1 - pct / 100)}`}
              strokeLinecap="round"
              className={isFailed ? 'text-red-500' : 'text-blue-500'}
              style={{ transition: 'stroke-dashoffset 0.5s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold" data-testid="progress-value">
              {pct}%
            </span>
          </div>
        </div>

        {/* Status message */}
        <p className="text-lg text-gray-300 mb-2" data-testid="status-message">
          {message}
        </p>

        {/* Stage indicator */}
        <p className="text-sm text-gray-500 mb-6 capitalize">
          Stage: {status.replace('_', ' ')}
        </p>

        {/* Elapsed time */}
        <p className="text-gray-500 text-sm" data-testid="elapsed-time">
          Elapsed: {formatTime(elapsed)}
        </p>

        {/* Error state */}
        {isFailed && (
          <div className="mt-6">
            <p className="text-red-400 mb-4">{progress?.message}</p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
