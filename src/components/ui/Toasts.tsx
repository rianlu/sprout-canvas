import { useCallback, type ReactNode } from 'react';
import { Toast } from '@base-ui/react/toast';
import { CircleAlert, CircleCheck, Info } from './icons';

export type ToastType = 'info' | 'success' | 'error';

/**
 * One app-level toast region on Base UI (live announcements, F6 landmark, pause on focus).
 * The stack keeps the Stitch #toast-container look and sits above every dialog; pills are not
 * clickable, so a press on a toast can never count as an outside press that closes a dialog.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return <Toast.Provider limit={4} timeout={3200}>
    {children}
    <Toast.Portal>
      <Toast.Viewport id="toast-container" className="fixed bottom-space-lg left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-space-xs w-max max-w-[calc(100vw-2rem)] pointer-events-none outline-none">
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  </Toast.Provider>;
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => {
    const Icon = toast.type === 'error' ? CircleAlert : toast.type === 'success' ? CircleCheck : Info;
    return <Toast.Root key={toast.id} toast={toast} swipeDirection={[]} className="px-space-md py-space-xs rounded-full bg-inverse-surface/90 text-inverse-on-surface backdrop-blur-md shadow-[0_12px_36px_rgba(85,95,75,0.15)] flex items-center gap-2 outline-none transition-[opacity,transform] duration-200 data-[starting-style]:opacity-0 data-[starting-style]:translate-y-2 data-[ending-style]:opacity-0 data-[limited]:hidden">
      <Icon className={toast.type === 'error' ? 'text-error' : 'text-primary-fixed-dim'} size={16} aria-hidden />
      <Toast.Description className="font-body-sm text-body-sm" />
    </Toast.Root>;
  });
}

/** Page notices; `duration` keeps each caller's previous display time. */
export function useToasts(duration = 3200) {
  const { add } = Toast.useToastManager();
  const pushToast = useCallback((type: ToastType, message: string) => {
    add({ type, description: message, timeout: duration, priority: type === 'error' ? 'high' : 'low' });
  }, [add, duration]);
  return { pushToast };
}
