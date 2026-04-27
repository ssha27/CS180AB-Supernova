import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getJobResults, type JobResult } from '../utils/api';
import VTKRenderer from '../components/VTKRenderer';
import SliceViewport from '../components/SliceViewport';
import OrganPanel from '../components/OrganPanel';
import ViewerControls, { type ViewerMode } from '../components/ViewerControls';
import {
  HOVER_DWELL_MS,
  formatOrganName,
  getOrganDescription,
  type HoverTarget,
} from '../utils/hoverDetails';
import { createDefaultSliceCursor, type SliceCursor } from '../utils/sliceUtils';

const HOVER_EXIT_GRACE_MS = 240;

function haveSameHoverTarget(left: HoverTarget | null, right: HoverTarget | null): boolean {
  return (
    left?.name === right?.name &&
    left?.source === right?.source &&
    (left?.pane ?? null) === (right?.pane ?? null)
  );
}

export default function ViewerPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewerMode>('model');
  const [sliceCursor, setSliceCursor] = useState<SliceCursor>({ z: 0, y: 0, x: 0 });
  const [visibleOrgans, setVisibleOrgans] = useState<Set<string>>(new Set());
  const [hoverDetailsEnabled, setHoverDetailsEnabled] = useState(true);
  const [hoverCandidate, setHoverCandidate] = useState<HoverTarget | null>(null);
  const [activeHover, setActiveHover] = useState<HoverTarget | null>(null);
  const [pinnedHover, setPinnedHover] = useState<HoverTarget | null>(null);
  const [tooltipHovered, setTooltipHovered] = useState(false);
  const [clipping, setClipping] = useState({
    axial: { enabled: false, value: 0.5 },
    coronal: { enabled: false, value: 0.5 },
    sagittal: { enabled: false, value: 0.5 },
  });
  const [loading, setLoading] = useState(true);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverClearTimerRef = useRef<number | null>(null);
  const hoverCandidateRef = useRef<HoverTarget | null>(null);
  const activeHoverRef = useRef<HoverTarget | null>(null);
  const pinnedHoverRef = useRef<HoverTarget | null>(null);
  const tooltipHoveredRef = useRef(false);
  const hoverDetailsEnabledRef = useRef(hoverDetailsEnabled);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const clearHoverClearTimer = useCallback(() => {
    if (hoverClearTimerRef.current !== null) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;

    getJobResults(jobId)
      .then((data) => {
        setResult(data);
        setVisibleOrgans(new Set(data.organs.map((organ) => organ.name)));
        if (data.volume) {
          setSliceCursor(createDefaultSliceCursor(data.volume.intensity.dimensions));
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [jobId]);

  useEffect(() => {
    hoverCandidateRef.current = hoverCandidate;
  }, [hoverCandidate]);

  useEffect(() => {
    activeHoverRef.current = activeHover;
  }, [activeHover]);

  useEffect(() => {
    pinnedHoverRef.current = pinnedHover;
  }, [pinnedHover]);

  useEffect(() => {
    tooltipHoveredRef.current = tooltipHovered;
  }, [tooltipHovered]);

  useEffect(() => {
    hoverDetailsEnabledRef.current = hoverDetailsEnabled;
  }, [hoverDetailsEnabled]);

  useEffect(() => {
    return () => {
      clearHoverTimer();
      clearHoverClearTimer();
    };
  }, [clearHoverClearTimer, clearHoverTimer]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !pinnedHoverRef.current) {
        return;
      }

      clearHoverTimer();
      clearHoverClearTimer();
      setPinnedHover(null);
      setHoverCandidate(null);
      setActiveHover(null);
      setTooltipHovered(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearHoverClearTimer, clearHoverTimer]);

  const scheduleActiveHoverClear = useCallback((ignoreCurrentCandidate = false) => {
    clearHoverClearTimer();

    if (
      pinnedHoverRef.current ||
      tooltipHoveredRef.current ||
      (!ignoreCurrentCandidate && hoverCandidateRef.current)
    ) {
      return;
    }

    hoverClearTimerRef.current = window.setTimeout(() => {
      if (pinnedHoverRef.current || tooltipHoveredRef.current || hoverCandidateRef.current) {
        hoverClearTimerRef.current = null;
        return;
      }

      setActiveHover(null);
      hoverClearTimerRef.current = null;
    }, HOVER_EXIT_GRACE_MS);
  }, [clearHoverClearTimer]);

  const handleHoverCandidateChange = useCallback(
    (next: HoverTarget | null) => {
      if (!hoverDetailsEnabled) {
        if (next === null) {
          clearHoverTimer();
          clearHoverClearTimer();
          setHoverCandidate(null);
          setActiveHover(null);
          setPinnedHover(null);
          setTooltipHovered(false);
        }
        return;
      }

      if (pinnedHoverRef.current) {
        return;
      }

      const currentCandidate = hoverCandidateRef.current;
      const currentActive = activeHoverRef.current;

      if (!next) {
        clearHoverTimer();
        if (currentCandidate !== null) {
          setHoverCandidate(null);
        }
        if (currentActive !== null) {
          scheduleActiveHoverClear(true);
        }
        return;
      }

      clearHoverClearTimer();

      if (
        haveSameHoverTarget(currentCandidate, next)
      ) {
        return;
      }

      clearHoverTimer();
      setHoverCandidate(next);

      if (
        currentActive &&
        !haveSameHoverTarget(currentActive, next)
      ) {
        setActiveHover(null);
      }

      hoverTimerRef.current = window.setTimeout(() => {
        if (pinnedHoverRef.current || !hoverDetailsEnabledRef.current) {
          hoverTimerRef.current = null;
          return;
        }
        setActiveHover(next);
        hoverTimerRef.current = null;
      }, HOVER_DWELL_MS);
    },
    [clearHoverClearTimer, clearHoverTimer, hoverDetailsEnabled, scheduleActiveHoverClear],
  );

  const handleHoverDetailsEnabledChange = useCallback(
    (enabled: boolean) => {
      setHoverDetailsEnabled(enabled);

      if (!enabled) {
        clearHoverTimer();
        clearHoverClearTimer();
        setHoverCandidate(null);
        setActiveHover(null);
        setPinnedHover(null);
        setTooltipHovered(false);
      }
    },
    [clearHoverClearTimer, clearHoverTimer],
  );

  const handleTooltipMouseEnter = useCallback(() => {
    if (!hoverDetailsEnabledRef.current) {
      return;
    }

    clearHoverClearTimer();
    setTooltipHovered(true);
  }, [clearHoverClearTimer]);

  const handleTooltipMouseLeave = useCallback(() => {
    setTooltipHovered(false);

    if (pinnedHoverRef.current) {
      return;
    }

    scheduleActiveHoverClear();
  }, [scheduleActiveHoverClear]);

  const handleViewModeChange = useCallback((nextMode: ViewerMode) => {
    if (nextMode === 'slice' && !result?.volume) {
      return;
    }

    clearHoverTimer();
    clearHoverClearTimer();
    setHoverCandidate(null);
    setActiveHover(null);
    setPinnedHover(null);
    setTooltipHovered(false);
    setViewMode(nextMode);
  }, [clearHoverClearTimer, clearHoverTimer, result?.volume]);

  const handlePinFocusedHover = useCallback(() => {
    const currentPinned = pinnedHoverRef.current;
    const focusedHover = currentPinned ?? activeHoverRef.current;

    if (!focusedHover) {
      return;
    }

    clearHoverTimer();
    clearHoverClearTimer();
    setHoverCandidate(null);
    setActiveHover(null);
    setPinnedHover(focusedHover);
  }, [clearHoverClearTimer, clearHoverTimer]);

  const handleUnpinFocusedHover = useCallback(() => {
    clearHoverTimer();
    clearHoverClearTimer();
    setPinnedHover(null);
    setHoverCandidate(null);
    setActiveHover(null);
    setTooltipHovered(false);
  }, [clearHoverClearTimer, clearHoverTimer]);

  const toggleOrgan = (name: string) => {
    setVisibleOrgans((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const showAll = () => {
    if (result) {
      setVisibleOrgans(new Set(result.organs.map((o) => o.name)));
    }
  };

  const hideAll = () => {
    setVisibleOrgans(new Set());
  };

  const showCategory = (category: string) => {
    if (result) {
      setVisibleOrgans((prev) => {
        const next = new Set(prev);
        result.organs
          .filter((o) => o.category === category)
          .forEach((o) => next.add(o.name));
        return next;
      });
    }
  };

  const hideCategory = (category: string) => {
    if (result) {
      setVisibleOrgans((prev) => {
        const next = new Set(prev);
        result.organs
          .filter((o) => o.category === category)
          .forEach((o) => next.delete(o.name));
        return next;
      });
    }
  };

  const requestedOrgans = new Set(visibleOrgans);
  if (hoverCandidate) {
    requestedOrgans.add(hoverCandidate.name);
  }
  if (activeHover) {
    requestedOrgans.add(activeHover.name);
  }
  if (pinnedHover) {
    requestedOrgans.add(pinnedHover.name);
  }

  const focusedHover = pinnedHover ?? activeHover;

  const displayedOrgans = new Set(visibleOrgans);
  if (focusedHover) {
    displayedOrgans.add(focusedHover.name);
  }

  const activeHoverOrgan =
    !result || !focusedHover
      ? null
      : result.organs.find((organ) => organ.name === focusedHover.name) ?? null;

  const tooltipPosition = !focusedHover
    ? null
    : {
        left: Math.min(
          Math.max(focusedHover.clientX + (focusedHover.source === 'sidebar' ? 16 : 20), 16),
          window.innerWidth - 304,
        ),
        top: Math.min(
          Math.max(focusedHover.clientY + 12, 16),
          window.innerHeight - 156,
        ),
      };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading results...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!result || !jobId) return null;

  const sliceAvailable = Boolean(result.volume);

  return (
    <div className="flex h-screen overflow-hidden relative" data-testid="viewer-page">
      <div className="absolute right-4 top-4 z-20">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-full border border-white/15 bg-slate-950/88 px-4 py-2 text-sm font-semibold text-slate-100 shadow-[0_14px_32px_rgba(15,23,42,0.38)] backdrop-blur-md transition-colors hover:border-sky-300/45 hover:text-sky-100"
          data-testid="viewer-back-button"
        >
          Back to Catalog
        </button>
      </div>

      {/* Left sidebar — organ panel */}
      <div className="w-72 min-h-0 bg-gray-900 border-r border-gray-800 overflow-y-auto flex-shrink-0">
        <OrganPanel
          organs={result.organs}
          visibleOrgans={visibleOrgans}
          hoverDetailsEnabled={hoverDetailsEnabled}
          activeHoverName={focusedHover?.name ?? null}
          onToggle={toggleOrgan}
          onShowAll={showAll}
          onHideAll={hideAll}
          onShowCategory={showCategory}
          onHideCategory={hideCategory}
          onHoverDetailsEnabledChange={handleHoverDetailsEnabledChange}
          onHoverCandidateChange={handleHoverCandidateChange}
        />
      </div>

      {/* Main viewport */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {viewMode === 'slice' ? (
          <SliceViewport
            jobId={jobId}
            volume={result.volume}
            organs={result.organs}
            requestedOrgans={requestedOrgans}
            displayedOrgans={displayedOrgans}
            activeHoverName={focusedHover?.name ?? null}
            hoverDetailsEnabled={hoverDetailsEnabled}
            cursor={sliceCursor}
            onCursorChange={setSliceCursor}
            onHoverCandidateChange={handleHoverCandidateChange}
          />
        ) : (
          <VTKRenderer
            jobId={jobId}
            organs={result.organs}
            requestedOrgans={requestedOrgans}
            displayedOrgans={displayedOrgans}
            clipping={clipping}
            activeHoverName={focusedHover?.name ?? null}
            hoverDetailsEnabled={hoverDetailsEnabled}
            onHoverCandidateChange={handleHoverCandidateChange}
          />
        )}

        {/* Bottom controls overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gray-900/80 backdrop-blur-sm border-t border-gray-800 p-4">
          <ViewerControls
            viewMode={viewMode}
            sliceAvailable={sliceAvailable}
            clipping={clipping}
            onViewModeChange={handleViewModeChange}
            onClippingChange={setClipping}
          />
        </div>
      </div>

      {hoverDetailsEnabled && activeHoverOrgan && tooltipPosition && (
        <div
          className={`fixed z-30 max-w-xs rounded-2xl border px-4 py-3 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.45)] backdrop-blur-md ${
            pinnedHover
              ? 'border-amber-300/60 bg-slate-950/96'
              : 'border-sky-400/30 bg-slate-950/92'
          }`}
          style={{ left: `${tooltipPosition.left}px`, top: `${tooltipPosition.top}px` }}
          data-testid="organ-hover-tooltip"
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`text-[10px] font-semibold uppercase tracking-[0.25em] ${pinnedHover ? 'text-amber-200/80' : 'text-sky-300/80'}`}>
                {pinnedHover ? 'Pinned Focus' : 'Hover Details'}
              </p>
              {pinnedHover && (
                <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-amber-100/70">
                  Camera controls remain active
                </p>
              )}
            </div>
            <button
              type="button"
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                pinnedHover
                  ? 'border-amber-300/60 bg-amber-300/12 text-amber-100 hover:bg-amber-300/20'
                  : 'border-sky-300/35 bg-sky-300/10 text-sky-100 hover:bg-sky-300/18'
              }`}
              onClick={pinnedHover ? handleUnpinFocusedHover : handlePinFocusedHover}
              data-testid="organ-hover-pin-toggle"
            >
              {pinnedHover ? 'Unpin' : 'Pin'}
            </button>
          </div>
          <p className="mt-2 text-base font-semibold text-white">
            {formatOrganName(activeHoverOrgan.name)}
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
            {activeHoverOrgan.category}
          </p>
          <p className="mt-3 leading-5 text-slate-200">
            {getOrganDescription(activeHoverOrgan.name, activeHoverOrgan.category)}
          </p>
        </div>
      )}
    </div>
  );
}
