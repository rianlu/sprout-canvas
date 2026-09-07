import { useEffect, useRef, useState } from 'react';
import type { ResultRecord } from '../types/generation';

export interface ImageMetadata {
  width: number;
  height: number;
  size: string;
  ratio: string;
}

export function useImageMetadata(records: ResultRecord[]) {
  const [metadata, setMetadata] = useState<Record<string, ImageMetadata>>({});
  const sources = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    const pending: HTMLImageElement[] = [];
    for (const record of records) {
      if (sources.current.get(record.id) === record.dataUrl) continue;
      const image = new Image();
      const apply = (width: number, height: number) => {
        if (!active) return;
        sources.current.set(record.id, record.dataUrl);
        const ratios = [
          [1, 1],
          [16, 9],
          [9, 16],
          [4, 3],
          [3, 4],
          [3, 2],
          [2, 3],
          [21, 9],
        ];
        const nearest = ratios.find(([w, h]) => Math.abs(width / height - w / h) < 0.04);
        setMetadata((current) => ({
          ...current,
          [record.id]: {
            width,
            height,
            size: `${width}×${height}`,
            ratio: nearest ? nearest.join(':') : `${width}:${height}`,
          },
        }));
      };
      if (record.width && record.height) { apply(record.width, record.height); continue; }
      if (!record.dataUrl) continue;
      image.onload = () => apply(image.naturalWidth, image.naturalHeight);
      image.src = record.dataUrl;
      pending.push(image);
    }
    return () => {
      active = false;
      pending.forEach((image) => {
        image.onload = null;
      });
    };
  }, [records]);
  return metadata;
}
