import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { OrganInfo } from '../utils/api';
import type { HoverTarget } from '../utils/hoverDetails';

interface OrganPanelProps {
  organs: OrganInfo[];
  visibleOrgans: Set<string>;
  hoverDetailsEnabled: boolean;
  activeHoverName: string | null;
  onToggle: (name: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onShowCategory: (category: string) => void;
  onHideCategory: (category: string) => void;
  onHoverDetailsEnabledChange: (enabled: boolean) => void;
  onHoverCandidateChange: (target: HoverTarget | null) => void;
}

export default function OrganPanel({
  organs,
  visibleOrgans,
  hoverDetailsEnabled,
  activeHoverName,
  onToggle,
  onShowAll,
  onHideAll,
  onShowCategory,
  onHideCategory,
  onHoverDetailsEnabledChange,
  onHoverCandidateChange,
}: OrganPanelProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const categories = useMemo(() => {
    const cats = new Map<string, OrganInfo[]>();
    for (const organ of organs) {
      const list = cats.get(organ.category) || [];
      list.push(organ);
      cats.set(organ.category, list);
    }
    return cats;
  }, [organs]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    const result = new Map<string, OrganInfo[]>();
    for (const [cat, items] of categories) {
      const filtered = items.filter((o) =>
        o.name.toLowerCase().includes(q)
      );
      if (filtered.length > 0) {
        result.set(cat, filtered);
      }
    }
    return result;
  }, [categories, search]);

  const toggleCollapse = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const rgbToCSS = (color: number[]) =>
    `rgb(${color[0]}, ${color[1]}, ${color[2]})`;

  const buildSidebarHoverTarget = (
    event: ReactMouseEvent<HTMLDivElement>,
    organName: string,
  ): HoverTarget => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      name: organName,
      source: 'sidebar',
      clientX: rect.right + 10,
      clientY: rect.top + rect.height / 2,
    };
  };

  return (
    <div className="p-3">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
        Organs ({visibleOrgans.size}/{organs.length})
      </h2>

      {/* Global buttons */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={onShowAll}
          className="flex-1 text-xs py-1.5 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
        >
          Show All
        </button>
        <button
          onClick={onHideAll}
          className="flex-1 text-xs py-1.5 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
        >
          Hide All
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search organs..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg mb-3 focus:outline-none focus:border-blue-500"
        data-testid="organ-search"
      />

      {/* Category groups */}
      {Array.from(filteredCategories.entries()).map(([category, items]) => (
        <div key={category} className="mb-2">
          <div className="flex items-center justify-between group">
            <button
              onClick={() => toggleCollapse(category)}
              className="flex items-center gap-1 text-xs font-medium text-gray-400 uppercase tracking-wider py-1"
            >
              <span className={`transition-transform ${collapsed.has(category) ? '' : 'rotate-90'}`}>
                ▶
              </span>
              {category} ({items.length})
            </button>
            <div className="hidden group-hover:flex gap-1">
              <button
                onClick={() => onShowCategory(category)}
                className="text-[10px] text-gray-500 hover:text-gray-300 px-1"
                title={`Show all ${category}`}
              >
                show
              </button>
              <button
                onClick={() => onHideCategory(category)}
                className="text-[10px] text-gray-500 hover:text-gray-300 px-1"
                title={`Hide all ${category}`}
              >
                hide
              </button>
            </div>
          </div>

          {!collapsed.has(category) && (
            <div className="ml-2">
              {items.map((organ) => (
                <div
                  key={organ.id}
                  role="checkbox"
                  aria-checked={visibleOrgans.has(organ.name)}
                  tabIndex={0}
                  onClick={() => onToggle(organ.name)}
                  onMouseEnter={(event) => {
                    onHoverCandidateChange(buildSidebarHoverTarget(event, organ.name));
                  }}
                  onMouseLeave={() => onHoverCandidateChange(null)}
                  onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(organ.name); } }}
                  className={`flex items-center gap-2 py-0.5 cursor-pointer rounded px-1 text-sm select-none transition-colors ${
                    activeHoverName === organ.name
                      ? 'bg-sky-500/10 ring-1 ring-inset ring-sky-400/40'
                      : 'hover:bg-gray-800/50'
                  }`}
                  data-testid={`organ-row-${organ.name}`}
                  data-active-hover={activeHoverName === organ.name ? 'true' : 'false'}
                >
                  <span
                    className={`w-3 h-3 rounded-sm border flex-shrink-0 transition-colors ${
                      visibleOrgans.has(organ.name) ? 'border-transparent' : 'border-gray-600'
                    }`}
                    style={{
                      backgroundColor: visibleOrgans.has(organ.name) ? rgbToCSS(organ.color) : 'transparent',
                    }}
                  />
                  <span className={`truncate ${visibleOrgans.has(organ.name) ? 'text-gray-200' : 'text-gray-500'}`}>
                    {organ.name.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/70 p-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={hoverDetailsEnabled}
            onChange={(event) => onHoverDetailsEnabledChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-900 text-sky-500 focus:ring-sky-500"
            data-testid="hover-details-toggle"
          />
          <div>
            <p className="text-sm font-medium text-gray-200">
              Hover details
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              After a 2 second hover, show a description and focus the matching 3D anatomy.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}
