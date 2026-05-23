import { useCallback, useEffect, useState } from 'react';
import { clearGalleryRecords, deleteGalleryRecord, loadGalleryRecords, saveGalleryRecord } from '../lib/storage/gallery-db';
import type { ResultRecord } from '../types/generation';

function logFailure(operation: string, error: unknown) {
  console.error(`[gallery] ${operation} failed`, error);
}

export function useGallery() {
  const [records, setRecords] = useState<ResultRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setRecords(await loadGalleryRecords()); }
    catch (error) { logFailure('load', error); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback((record: ResultRecord) => {
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    void saveGalleryRecord(record).catch((error) => logFailure('save', error));
  }, []);

  const remove = useCallback((id: string) => {
    setRecords((current) => current.filter((record) => record.id !== id));
    void deleteGalleryRecord(id).catch((error) => logFailure('delete', error));
  }, []);

  const clear = useCallback(() => {
    setRecords([]);
    void clearGalleryRecords().catch((error) => logFailure('clear', error));
  }, []);

  return { records, loading, add, remove, clear, refresh };
}
