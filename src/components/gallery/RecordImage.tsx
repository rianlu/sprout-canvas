import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { getRecordThumbnail } from '../../lib/storage/gallery-db';
import type { ResultRecord } from '../../types/generation';
import { BLUR_FILL } from '../image/StyleExampleImage';

type Props = ImgHTMLAttributes<HTMLImageElement> & { record: ResultRecord };

/** Read the thumbnail only when its card approaches the viewport. Originals stay in IndexedDB. */
function useRecordThumbnail(record: ResultRecord) {
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
  return { element, source, error };
}

export function RecordImage({ record, ...props }: Props) {
  const { element, source, error } = useRecordThumbnail(record);
  return <img ref={element} {...props} src={source || undefined} title={error || props.title} aria-label={error || props['aria-label']} />;
}

/**
 * Fills a fixed-ratio, `relative overflow-hidden` frame with the whole work: the thumbnail is fitted, never cropped,
 * and a blurred copy covers the margins, as on style cards. `className` adds effects such as a hover zoom.
 */
export function RecordFrameImage({ record, className = '', ...props }: Props) {
  const { element, source, error } = useRecordThumbnail(record);
  return (
    <>
      {source && <img src={source} alt="" aria-hidden className={`pointer-events-none ${BLUR_FILL}`} />}
      <img
        ref={element}
        {...props}
        src={source || undefined}
        title={error || props.title}
        aria-label={error || props['aria-label']}
        className={`absolute inset-0 h-full w-full object-contain ${className}`}
      />
    </>
  );
}
