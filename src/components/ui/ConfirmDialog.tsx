import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { DIALOG_BACKDROP, DIALOG_VIEWPORT } from './Dialog';

export interface ConfirmOptions {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);
// A confirm can be raised from inside an open dialog (z-50), so it stacks one level above it.
const CONFIRM_BACKDROP = DIALOG_BACKDROP.replace('z-50', 'z-[60]');
const CONFIRM_VIEWPORT = DIALOG_VIEWPORT.replace('z-50', 'z-[60]');

/** In-page replacement for window.confirm, shared by every page and library caller. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  // The last request stays rendered while the popup plays its exit transition.
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
  }, []);
  const confirm = useCallback<Confirm>((options) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setRequest(options);
    setOpen(true);
  }), []);
  return <ConfirmContext.Provider value={confirm}>
    {children}
    <AlertDialog.Root open={open} onOpenChange={(next) => { if (!next) settle(false); }}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop forceRender className={CONFIRM_BACKDROP} />
        <AlertDialog.Viewport className={CONFIRM_VIEWPORT}>
          {request && <AlertDialog.Popup className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-space-lg shadow-xl outline-none space-y-space-md">
            <AlertDialog.Title className="font-headline-sm text-headline-sm text-on-surface">{request.title}</AlertDialog.Title>
            <AlertDialog.Description className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">{request.description}</AlertDialog.Description>
            <div className="flex justify-end gap-space-sm pt-space-xs">
              <AlertDialog.Close className="px-space-md py-2 rounded-xl bg-surface-container text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high">{request.cancelLabel || '取消'}</AlertDialog.Close>
              <button type="button" className={`px-space-md py-2 rounded-xl font-body-sm text-body-sm font-medium ${request.danger ? 'bg-error text-on-error hover:bg-error/90' : 'bg-primary text-on-primary hover:bg-primary-container'}`} onClick={() => settle(true)}>{request.confirmLabel || '确认'}</button>
            </div>
          </AlertDialog.Popup>}
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </ConfirmContext.Provider>;
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside ConfirmProvider');
  return confirm;
}
