import { useCallback, useEffect, useState } from 'react';
import { authStatus, login, logout } from '../lib/api/auth';
import { randomId } from '../lib/random/id';

const USER_KEY = 'sprout_canvas_user_id';

function getUserId() {
  try {
    let id = localStorage.getItem(USER_KEY);
    if (!id) {
      id = randomId('user');
      localStorage.setItem(USER_KEY, id);
    }
    return id;
  } catch {
    throw new Error('浏览器存储不可用, 请允许此站点使用本地存储后重新连接');
  }
}

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setError('');
      const userId = getUserId();
      const status = await authStatus();
      setRequired(status.required);
      if (!status.required && !status.authenticated) {
        await login('', userId);
        setAuthenticated(true);
        return;
      }
      setAuthenticated(status.authenticated);
    } catch (cause) {
      setAuthenticated(false);
      setError(cause instanceof Error ? cause.message : '无法连接工作台');
    } finally {
      setLoading(false);
    }
  }, []);

  const signIn = useCallback(async (password: string) => {
    await login(password, getUserId());
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await logout();
    setAuthenticated(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const expired = () => { setAuthenticated(false); void refresh(); };
    window.addEventListener('sprout:auth-expired', expired);
    return () => window.removeEventListener('sprout:auth-expired', expired);
  }, [refresh]);
  return { loading, required, authenticated, signIn, signOut, refresh, error };
}
