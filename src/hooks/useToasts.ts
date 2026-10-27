import { useCallback, useState } from 'react';
import { randomId } from '../lib/random/id';

export type ToastType = 'info' | 'success' | 'error';
export interface Toast { id: string; type: ToastType; message: string }

/** Page-level notices that each disappear after `duration` milliseconds. */
export function useToasts(duration = 3200) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((type: ToastType, message: string) => {
    const id = randomId();
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), duration);
  }, [duration]);
  return { toasts, pushToast };
}
