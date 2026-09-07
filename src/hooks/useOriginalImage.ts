import { useEffect, useState } from 'react';
import { getRecordBlob } from '../lib/storage/gallery-db';
import type { ResultRecord } from '../types/generation';

export function useOriginalImage(record?: ResultRecord) {
  const [state, setState] = useState<{ id: string; url: string; error: string }>({ id: '', url: '', error: '' });
  useEffect(() => {
    if (!record) return;
    let disposed = false;
    let url = '';
    void getRecordBlob(record).then((blob) => {
      if (disposed) return;
      url = URL.createObjectURL(blob);
      setState({ id: record.id, url, error: '' });
    }).catch(() => { if (!disposed) setState({ id: record.id, url: '', error: '本地原图读取失败' }); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [record?.id, record?.dataUrl]);
  return state.id === record?.id ? state : { id: record?.id || '', url: '', error: '' };
}
