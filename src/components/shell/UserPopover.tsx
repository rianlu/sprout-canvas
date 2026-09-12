import { useEffect, useId, useRef, useState } from 'react';
import type { Theme } from '../../hooks/useTheme';
import { StitchIcon } from '../ui/StitchIcon';

interface UserPopoverProps {
  accessName: string;
  tail?: string;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenHelp: () => void;
  onSignOut: () => void;
}

export function UserPopover({ accessName, tail, theme, onToggleTheme, onOpenHelp, onSignOut }: UserPopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label="用户菜单"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="用户菜单"
        className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors ${open ? 'bg-primary text-on-primary shadow-sm' : 'bg-secondary-container text-on-secondary-container hover:bg-primary hover:text-on-primary'}`}
        onClick={() => setOpen((value) => !value)}
      >
        <StitchIcon name="person" size={21} />
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="用户设置"
          tabIndex={-1}
          className="absolute right-0 top-full mt-3 w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3 shadow-[0_12px_40px_rgba(45,55,36,0.16)] outline-none focus-visible:outline-none"
        >
          <div className="flex items-start gap-3 px-2 py-3">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-secondary-container/60 text-secondary flex items-center justify-center"><StitchIcon name="person" size={24} /></span>
            <div className="min-w-0">
              <p className="font-body-md text-body-md font-semibold break-words">{accessName.trim() || '创作者'}</p>
              {tail && <p className="mt-1 font-meta-sm text-meta-sm text-on-surface-variant">访问码尾号 <span className="font-mono">{tail}</span></p>}
            </div>
          </div>
          <div className="my-2 rounded-xl bg-surface-container-low p-3">
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-2">外观</p>
            <div role="group" aria-label="外观主题" className="grid grid-cols-2 gap-1 rounded-lg bg-surface-container p-1">
              {([{ value: 'light', label: '浅色', icon: 'light_mode' }, { value: 'dark', label: '深色', icon: 'dark_mode' }] as const).map((option) => (
                <button key={option.value} type="button" aria-pressed={theme === option.value} className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 font-body-sm text-body-sm transition-colors ${theme === option.value ? 'bg-surface-container-lowest text-primary font-medium shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`} onClick={() => { if (theme !== option.value) onToggleTheme(); }}>
                  <StitchIcon name={option.icon} size={17} />{option.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="w-full flex items-center gap-3 rounded-xl px-3 py-3 font-body-sm text-body-sm text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors" onClick={() => { close(); onOpenHelp(); }}>
            <StitchIcon name="menu_book" size={19} />使用帮助<StitchIcon name="chevron_right" size={18} className="ml-auto text-outline" />
          </button>
          <div className="mt-2 pt-2 border-t border-outline-variant/25">
            <button type="button" className="w-full flex items-center gap-3 rounded-xl px-3 py-3 font-body-sm text-body-sm text-on-surface-variant hover:bg-error-container/50 hover:text-on-error-container transition-colors" onClick={() => { close(); onSignOut(); }}>
              <StitchIcon name="logout" size={19} />退出登录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
