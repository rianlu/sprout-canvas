import type { ResultRecord } from '../../types/generation';
import { imageFileExtension } from './format';
import { buildZip } from './zip';
import { getRecordBlob } from '../storage/gallery-db';

export interface SeriesCard {
  kind: 'series';
  seriesId: string;
  masterPrompt: string;
  records: ResultRecord[];
  latestAt: number;
  versions?: ResultRecord[];
}

export interface SingleCard {
  kind: 'single';
  record: ResultRecord;
}
export type GalleryCard = SeriesCard | SingleCard;

export function cardRecords(card: GalleryCard) {
  return card.kind === 'series' ? card.records : [card.record];
}

export function cardTitle(card: GalleryCard) {
  return (card.kind === 'series' ? card.masterPrompt : card.record.prompt) || '未命名作品';
}

export function cardTimestamp(card: GalleryCard) {
  return card.kind === 'series' ? card.latestAt : card.record.createdAt;
}

export async function downloadRecord(record: ResultRecord) {
  const blob = await getRecordBlob(record);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sprout-${record.id}.${imageFileExtension(record.dataUrl, record.outputFormat)}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function downloadRecords(records: ResultRecord[], name = 'sprout-artworks') {
  const entries = [];
  for (const [index, record] of records.entries()) entries.push({ name: `scene-${String(index + 1).padStart(2, '0')}-${record.id}.${imageFileExtension(record.dataUrl, record.outputFormat)}`, data: new Uint8Array(await (await getRecordBlob(record)).arrayBuffer()) });
  const url = URL.createObjectURL(buildZip(entries));
  const link = document.createElement('a');
  link.href = url; link.download = `${name}.zip`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function supportsFileSharing() { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function'; }
export async function shareRecords(records: ResultRecord[]) {
  const files: File[] = [];
  for (const record of records) {
    const blob = await getRecordBlob(record);
    files.push(new File([blob], `sprout-${record.id}.${imageFileExtension('', record.outputFormat)}`, { type: blob.type }));
  }
  if (!supportsFileSharing() || !navigator.canShare({ files })) throw new Error('当前浏览器不支持分享这些文件, 可下载后分享');
  await navigator.share({ files, title: '芽绘台作品' });
}

export function latestSceneVersions(records: ResultRecord[]) {
  const latest = new Map<string, ResultRecord>();
  for (const record of records) {
    const key = record.sceneId || record.id;
    const previous = latest.get(key);
    if (!previous || (record.version || 1) > (previous.version || 1) || (record.version || 1) === (previous.version || 1) && record.createdAt > previous.createdAt) latest.set(key, record);
  }
  return [...latest.values()].sort((a, b) => (a.sceneIndex ?? a.createdAt) - (b.sceneIndex ?? b.createdAt));
}
