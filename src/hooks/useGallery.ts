import { useCallback, useEffect, useRef, useState } from 'react';
import { clearGalleryRecords, deleteGalleryRecords, loadGalleryRecords, saveGalleryRecords } from '../lib/storage/gallery-db';
import type { ResultRecord } from '../types/generation';

export function useGallery() {
  const [records, setRecords] = useState<ResultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      let version: number;
      let loaded: ResultRecord[];
      do { version = revision.current; loaded = await loadGalleryRecords(); } while (version !== revision.current);
      setRecords(loaded);
      setError('');
    } catch (error) { setError(error instanceof Error ? error.message : '无法读取本地展馆'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback(async (incoming: ResultRecord[], jobId: string) => {
    const saved = await saveGalleryRecords(incoming, jobId);
    revision.current++;
    setRecords((current) => [...new Map([...current, ...saved].map((record) => [record.id, record])).values()].sort((a, b) => b.createdAt - a.createdAt));
    return saved;
  }, []);
  const removeMany = useCallback(async (ids: string[]) => {
    await deleteGalleryRecords(ids);
    revision.current++;
    setRecords((current) => current.filter((record) => !ids.includes(record.id)));
  }, []);
  const remove = useCallback((id: string) => removeMany([id]), [removeMany]);
  const clear = useCallback(async () => {
    await clearGalleryRecords();
    revision.current++;
    setRecords([]);
  }, []);
  return { records, loading, error, add, remove, removeMany, clear, refresh };
}
