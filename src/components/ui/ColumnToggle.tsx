import { useState } from 'react';
import { StitchIcon } from './StitchIcon';

const PREFIX = 'sprout_canvas_compact_';

/** A per-page "more columns" choice remembered in this browser; storage failures fall back to the default. */
export function useCompactGrid(page: string) {
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem(PREFIX + page) === '1'; } catch { return false; }
  });
  const toggle = () => setCompact((value) => {
    const next = !value;
    try { if (next) localStorage.setItem(PREFIX + page, '1'); else localStorage.removeItem(PREFIX + page); } catch { /* ignore */ }
    return next;
  });
  return [compact, toggle] as const;
}

export function ColumnToggle({ compact, onToggle, className = '' }: { compact: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={`shrink-0 inline-flex items-center justify-center rounded-lg text-primary ${className}`}
      aria-label={compact ? '切换为较少列' : '切换为较多列'}
      title={compact ? '较少列' : '较多列'}
      aria-pressed={compact}
      onClick={onToggle}
    >
      <StitchIcon name={compact ? 'view_module' : 'grid_view'} size={20} />
    </button>
  );
}
