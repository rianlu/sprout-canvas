import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { getRecordThumbnail } from '../../lib/storage/gallery-db';
import type { ResultRecord } from '../../types/generation';

/** Read thumbnails only when their card approaches the viewport. Originals stay in IndexedDB. */
export function RecordImage({ record, ...props }: ImgHTMLAttributes<HTMLImageElement> & { record: ResultRecord }) {
  const element = useRef<HTMLImageElement>(null);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let url = '';
    setSource(''); setError('');
    const load = () => {
      void getRecordThumbnail(record).then((blob) => {
        if (disposed) return;
        url = URL.createObjectURL(blob);
        setSource(url);
      }).catch(() => { if (!disposed) setError('本地缩略图读取失败'); });
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: '240px' });
    if (element.current) observer.observe(element.current);
    return () => { disposed = true; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  }, [record.id]);
  return <img ref={element} {...props} src={source || undefined} title={error || props.title} aria-label={error || props['aria-label']} />;
}
