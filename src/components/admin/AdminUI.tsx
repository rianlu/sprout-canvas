import type { ReactNode } from 'react';
import { StitchIcon } from '../ui/StitchIcon';

export const adminButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 font-body-sm text-body-sm font-medium transition-colors disabled:opacity-50';
export const adminField = 'w-full min-h-11 rounded-xl bg-surface-container-low/70 border border-outline-variant/40 px-3 py-2.5 focus:border-primary outline-none font-body-md text-body-md text-on-surface placeholder:text-outline';
export const adminPanel = 'rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-[0_4px_20px_rgba(85,95,75,0.04)]';

export function AdminHeading({ icon, eyebrow, title, description, children }: { icon: string; eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
    <div className="min-w-0"><p className="flex items-center gap-2 text-secondary font-meta-sm text-meta-sm tracking-wider mb-2"><StitchIcon name={icon} size={17} />{eyebrow}</p>
      <h1 className="font-headline-lg text-headline-lg tracking-tight">{title}</h1><p className="mt-2 font-body-md text-body-md text-on-surface-variant leading-relaxed">{description}</p>
    </div>
    {children && <div className="flex flex-wrap items-center gap-2 shrink-0">{children}</div>}
  </section>;
}

export function AdminEmpty({ icon, title, description }: { icon: string; title: string; description: string }) {
  return <div className="flex flex-col items-center justify-center text-center px-5 py-10">
    <span className="w-12 h-12 mb-4 rounded-2xl bg-surface-container-low text-primary flex items-center justify-center"><StitchIcon name={icon} size={25} /></span>
    <p className="font-body-md text-body-md font-medium">{title}</p><p className="mt-1 max-w-md font-body-sm text-body-sm text-on-surface-variant">{description}</p>
  </div>;
}

export function AdminLoading({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="space-y-4 py-5">
    <span className="sr-only">{label}</span><div className="h-4 w-36 rounded-lg bg-surface-container animate-pulse" />
    <div className="grid grid-cols-2 gap-4"><div className="h-28 rounded-2xl bg-surface-container-low animate-pulse" /><div className="h-28 rounded-2xl bg-surface-container-low animate-pulse" /></div>
  </div>;
}
