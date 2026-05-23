import { useCallback, useEffect, useMemo, useState } from 'react';
import { authStatus, login } from '../lib/api/auth';

const USER_KEY = 'sprout_canvas_user_id';

function getUserId() {
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const userId = useMemo(getUserId, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await authStatus();
      setRequired(status.required);
      setAuthenticated(status.authenticated);
    } finally {
      setLoading(false);
    }
  }, []);

  const signIn = useCallback(async (password: string) => {
    await login(password, userId);
    await refresh();
  }, [refresh, userId]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { loading, required, authenticated, signIn };
}
