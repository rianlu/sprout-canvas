import { useCallback, useEffect, useRef, useState } from 'react';
import { authStatus, login, logout, type AuthStatus } from '../lib/api/auth';
import { setCreditSession } from '../lib/credits';

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthStatus | null>(null);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const apply = useCallback((value: AuthStatus | null) => { setSession(value); setCreditSession(value?.authenticated ? value : null); }, []);
  const refresh = useCallback(async (visible = false) => {
    const version = ++revision.current;
    if (visible) { setLoading(true); setError(''); }
    try {
      const value = await authStatus();
      if (version === revision.current) { apply(value); setError(''); }
    } catch (cause) {
      if (visible && version === revision.current) setError(cause instanceof Error ? cause.message : '无法连接工作台');
    } finally { if (version === revision.current) setLoading(false); }
  }, [apply]);
  const signIn = useCallback(async (code: string) => {
    const value = await login(code.trim());
    revision.current++; apply(value); setLoading(false); setError('');
  }, [apply]);
  const signOut = useCallback(async () => {
    await logout(); revision.current++; apply(null); setLoading(false);
  }, [apply]);
  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => {
    const expired = () => { revision.current++; apply(null); void refresh(); };
    const changed = () => { void refresh(); };
    window.addEventListener('sprout:auth-expired', expired);
    window.addEventListener('sprout:credits-refresh', changed);
    const timer = window.setInterval(() => { if (session?.authenticated && !document.hidden) void refresh(); }, 5000);
    return () => { window.removeEventListener('sprout:auth-expired', expired); window.removeEventListener('sprout:credits-refresh', changed); window.clearInterval(timer); };
  }, [apply, refresh, session?.authenticated]);
  return { loading, required: true, authenticated: Boolean(session?.authenticated), userId: session?.userId || '', canGenerate: Boolean(session?.canGenerate), signIn, signOut, refresh, error };
}
