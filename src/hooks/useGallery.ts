import { useCallback, useEffect, useState } from 'react';
import { clearGalleryRecords, deleteGalleryRecord, loadGalleryRecords, saveGalleryRecord } from '../lib/storage/gallery-db';
import type { ResultRecord } from '../types/generation';

export function useGallery() {
  const [records, setRecords] = useState<ResultRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setRecords(await loadGalleryRecords()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback((record: ResultRecord) => {
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    void saveGalleryRecord(record).catch(() => undefined);
  }, []);

  const remove = useCallback((id: string) => {
    setRecords((current) => current.filter((record) => record.id !== id));
    void deleteGalleryRecord(id).catch(() => undefined);
  }, []);

  const clear = useCallback(() => {
    setRecords([]);
    void clearGalleryRecords().catch(() => undefined);
  }, []);

  return { records, loading, add, remove, clear, refresh };
}
