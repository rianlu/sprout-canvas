import { useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import type { Theme } from '../../hooks/useTheme';
import { StitchIcon } from '../ui/StitchIcon';
import { SegmentedControl } from '../ui/SegmentedControl';

interface UserPopoverProps {
  accessName: string;
  tail?: string;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenHelp: () => void;
  /** Absent for visitors, who see appearance and help only; the header carries their sign-in button. */
  onSignOut?: () => void;
}

export function UserPopover({ accessName, tail, theme, onToggleTheme, onOpenHelp, onSignOut }: UserPopoverProps) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // Non-modal Base UI popover: outside press, Escape and Tab-out close it, and focus returns to the trigger.
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="用户菜单"
        title="用户菜单"
        className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors ${open ? 'bg-primary text-on-primary shadow-sm' : 'bg-secondary-container text-on-secondary-container hover:bg-primary hover:text-on-primary'}`}
      >
        <StitchIcon name="person" size={21} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={12} collisionPadding={16} className="z-50">
          <Popover.Popup
            ref={panel}
            aria-label="用户设置"
            initialFocus={panel}
            className="w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3 shadow-[0_12px_40px_rgba(45,55,36,0.16)] outline-none"
          >
          <div className="flex items-start gap-3 px-2 py-3">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-secondary-container/60 text-secondary flex items-center justify-center"><StitchIcon name="person" size={24} /></span>
            <div className="min-w-0">
              <p className="font-body-md text-body-md font-semibold break-words">{onSignOut ? accessName.trim() || '创作者' : '未登录'}</p>
              {onSignOut ? tail && <p className="mt-1 font-meta-sm text-meta-sm text-on-surface-variant">访问码尾号 <span className="font-mono">{tail}</span></p> : <p className="mt-1 font-meta-sm text-meta-sm text-on-surface-variant">浏览无需登录, 生成和润色时使用访问码</p>}
            </div>
          </div>
          <div className="my-2 rounded-xl bg-surface-container-low p-3">
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-2">外观</p>
            <SegmentedControl
              label="外观主题"
              className="grid grid-cols-2 gap-1 rounded-lg bg-surface-container p-1"
              value={theme}
              onChange={(next) => { if (next !== theme) onToggleTheme(); }}
              options={([{ value: 'light', label: '浅色', icon: 'light_mode' }, { value: 'dark', label: '深色', icon: 'dark_mode' }] as const).map((option) => ({ id: option.value, label: <><StitchIcon name={option.icon} size={17} />{option.label}</> }))}
              itemClassName={(active) => `flex items-center justify-center gap-2 rounded-md px-3 py-2 font-body-sm text-body-sm transition-colors ${active ? 'bg-surface-container-lowest text-primary font-medium shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
            />
          </div>
          <button type="button" className="w-full flex items-center gap-3 rounded-xl px-3 py-3 font-body-sm text-body-sm text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors" onClick={() => { setOpen(false); onOpenHelp(); }}>
            <StitchIcon name="menu_book" size={19} />使用帮助<StitchIcon name="chevron_right" size={18} className="ml-auto text-outline" />
          </button>
          {onSignOut && <div className="mt-2 pt-2 border-t border-outline-variant/25">
            <button type="button" className="w-full flex items-center gap-3 rounded-xl px-3 py-3 font-body-sm text-body-sm text-on-surface-variant hover:bg-error-container/50 hover:text-on-error-container transition-colors" onClick={() => { setOpen(false); onSignOut(); }}>
              <StitchIcon name="logout" size={19} />退出登录
            </button>
          </div>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
