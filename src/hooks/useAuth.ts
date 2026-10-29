import { useCallback, useEffect, useRef, useState } from 'react';
import { authStatus, login, logout, type AuthStatus } from '../lib/api/auth';
import { setCreditSession } from '../lib/credits';

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthStatus | null>(null);
  const [error, setError] = useState('');
  // Set when a signed-in session ends without the user signing out, so the page can say why the account controls changed.
  const [expired, setExpired] = useState(false);
  const revision = useRef(0);
  const signedIn = useRef(false);
  const apply = useCallback((value: AuthStatus | null) => {
    signedIn.current = Boolean(value?.authenticated);
    setSession(value); setCreditSession(value?.authenticated ? value : null);
  }, []);
  const refresh = useCallback(async (visible = false) => {
    const version = ++revision.current;
    if (visible) { setLoading(true); setError(''); }
    try {
      const value = await authStatus();
      if (version === revision.current) {
        if (signedIn.current && !value.authenticated) setExpired(true);
        apply(value); setError('');
      }
    } catch (cause) {
      if (visible && version === revision.current) setError(cause instanceof Error ? cause.message : '无法连接工作台');
    } finally { if (version === revision.current) setLoading(false); }
  }, [apply]);
  const signIn = useCallback(async (code: string) => {
    const value = await login(code.trim());
    revision.current++; apply(value); setLoading(false); setError(''); setExpired(false);
  }, [apply]);
  const signOut = useCallback(async () => {
    await logout(); revision.current++; apply(null); setLoading(false); setExpired(false);
  }, [apply]);
  const dismissExpired = useCallback(() => setExpired(false), []);
  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => {
    const ended = () => { if (signedIn.current) setExpired(true); revision.current++; apply(null); void refresh(); };
    const changed = () => { void refresh(); };
    window.addEventListener('sprout:auth-expired', ended);
    window.addEventListener('sprout:credits-refresh', changed);
    const timer = window.setInterval(() => { if (session?.authenticated && !document.hidden) void refresh(); }, 5000);
    return () => { window.removeEventListener('sprout:auth-expired', ended); window.removeEventListener('sprout:credits-refresh', changed); window.clearInterval(timer); };
  }, [apply, refresh, session?.authenticated]);
  return { loading, authenticated: Boolean(session?.authenticated), userId: session?.userId || '', canGenerate: Boolean(session?.canGenerate), expired, dismissExpired, signIn, signOut, refresh, error };
}
