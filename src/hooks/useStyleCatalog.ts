import { useCallback, useEffect, useRef, useState } from 'react';
import { getStyles } from '../lib/api/styles';
import type { StyleCatalog } from '../../shared/style-contract.mjs';

export function useStyleCatalog(admin = false, enabled = true) {
  const [catalog, setCatalog] = useState<StyleCatalog>({ styles: [], categories: [], revision: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const data = await getStyles(admin);
      if (request === sequence.current) { setCatalog(data); setError(''); }
    } catch (error) {
      if (request === sequence.current) setError(error instanceof Error ? error.message : '风格库读取失败');
    } finally { if (request === sequence.current) setLoading(false); }
  }, [admin]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(visible, 30000);
    return () => { sequence.current++; window.clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [refresh, enabled]);
  return { ...catalog, loading, error, refresh };
}
