interface PanelDockButtonProps {
  eyebrow: string;
  label: string;
  hint: string;
  align?: 'left' | 'right';
  onClick: () => void;
  testId: string;
}

export default function PanelDockButton({
  eyebrow,
  label,
  hint,
  align = 'left',
  onClick,
  testId,
}: PanelDockButtonProps) {
  const alignmentClass = align === 'right' ? 'items-end text-right' : 'items-start text-left';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-[min(15rem,calc(100vw-2rem))] flex-col gap-2 rounded-[1.35rem] border border-white/10 bg-slate-950/88 px-4 py-3 text-slate-100 shadow-[0_14px_32px_rgba(15,23,42,0.38)] backdrop-blur-md transition-all duration-200 hover:border-sky-300/40 hover:bg-slate-950/94 ${alignmentClass}`}
      data-testid={testId}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
        {eyebrow}
      </p>
      <div className={`flex w-full items-center justify-between gap-3 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <div className={`min-w-0 ${alignmentClass}`}>
          <p className="truncate text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">{hint}</p>
        </div>
        <span className="rounded-full border border-slate-700/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-200 transition-colors group-hover:border-sky-300/40 group-hover:text-sky-100">
          Show
        </span>
      </div>
    </button>
  );
}