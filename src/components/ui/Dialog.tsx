import { useEffect, useRef, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';

/** Shared overlay layers; z-index stays below toasts (z-[80]) and the app banners. */
export const DIALOG_BACKDROP = 'fixed inset-0 z-50 bg-inverse-surface/45 backdrop-blur-sm';
export const DIALOG_VIEWPORT = 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5';

interface DialogProps {
  /** Accessible name; the dialog keeps it even when a visible heading is shown. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Escape, outside press and close buttons are ignored while an action runs. */
  busy?: boolean;
  /** Outside press closes the dialog unless disabled, e.g. for forms with unsaved input. */
  dismissOnOutsidePress?: boolean;
  /** Escape closes the dialog unless disabled, e.g. when it shows a secret that cannot be shown again. */
  dismissOnEscape?: boolean;
  className?: string;
  backdropClassName?: string;
  viewportClassName?: string;
  initialFocus?: boolean | RefObject<HTMLElement | null>;
  /** Mounted dialogs are open; parents unmount them to close. */
  open?: boolean;
  ariaBusy?: boolean;
  /** Keys pressed inside the dialog; Base UI stops arrow keys at the popup, so window listeners never see them. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Modal dialog on Base UI: focus trap and return, Escape, scroll lock, inert background and nested stacking
 * come from the library, so pages only describe their content.
 */
export function Dialog({ label, onClose, children, busy = false, dismissOnOutsidePress = true, dismissOnEscape = true, className = '', backdropClassName = DIALOG_BACKDROP, viewportClassName = DIALOG_VIEWPORT, initialFocus, open = true, ariaBusy, onKeyDown }: DialogProps) {
  const popup = useRef<HTMLDivElement>(null);
  // A busy action can disable the focused control; park focus on the dialog so it never falls back to the page.
  useEffect(() => {
    if (!busy) return;
    const node = popup.current, active = document.activeElement;
    if (node && (!node.contains(active) || (active instanceof HTMLElement && active.matches(':disabled')))) node.focus();
  }, [busy]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const active = document.activeElement;
    if (busy && event.key === 'Tab' && (active === popup.current || (active instanceof HTMLElement && active.matches(':disabled')))) event.preventDefault();
    onKeyDown?.(event);
  };
  return <BaseDialog.Root
    open={open}
    disablePointerDismissal={busy || !dismissOnOutsidePress}
    onOpenChange={(next, details) => {
      if (next) return;
      if (busy || (!dismissOnEscape && details.reason === 'escape-key')) { details.cancel(); return; }
      onClose();
    }}
  >
    <BaseDialog.Portal>
      <BaseDialog.Backdrop forceRender className={backdropClassName} />
      <BaseDialog.Viewport className={viewportClassName} onPaste={stop} onDragOver={block} onDrop={block}>
        <BaseDialog.Popup ref={popup} aria-label={label} aria-busy={ariaBusy} initialFocus={initialFocus} onKeyDown={keyDown} className={`outline-none ${className}`}>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  </BaseDialog.Root>;
}

// Portaled content still bubbles through the React tree, so paste and file drops inside a dialog must not reach page drop zones.
const stop = (event: SyntheticEvent) => event.stopPropagation();
const block = (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); };

/** Keyboard shortcuts on the page underneath must not act while any dialog or popover is open. */
export function overlayOpen() {
  return Boolean(document.querySelector('[role="dialog"][data-open], [role="alertdialog"][data-open]'));
}
