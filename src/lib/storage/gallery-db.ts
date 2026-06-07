import type { ResultRecord } from '../../types/generation';
import { dataUrlFormat, normalizeImageOutputFormat } from '../image/format';

const DB_NAME = 'img-gen-gallery';
const STORE_NAME = 'records';
const DB_VERSION = 2;
const LEGACY_KEY = 'sprout_canvas_gallery_v1';

type StoredResultRecord = Partial<Omit<ResultRecord, 'createdAt' | 'kind'>> & {
  createdAt?: unknown;
  kind?: ResultRecord['kind'];
};

function coerceTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function timestampFromId(id: unknown): number {
  if (typeof id !== 'string') return 0;
  const match = id.match(/(?:^|_)(\d{13})(?:_|$)/);
  return match ? coerceTimestamp(match[1]) : 0;
}

function fallbackId(record: StoredResultRecord, index: number): string {
  if (typeof record.id === 'string' && record.id.trim()) return record.id;
  return `legacy_untracked_${index}`;
}

function isGeneratedLegacyId(id: string, createdAt: number) {
  return id.startsWith('legacy_') && createdAt > 0 && timestampFromId(id) === createdAt;
}

function normalizeRecord(record: StoredResultRecord, index = 0): ResultRecord | null {
  if (!record || typeof record.dataUrl !== 'string' || !record.dataUrl) return null;
  const id = fallbackId(record, index);
  const storedCreatedAt = coerceTimestamp(record.createdAt);
  const createdAt = isGeneratedLegacyId(id, storedCreatedAt) ? 0 : storedCreatedAt || timestampFromId(id);
  return {
    id,
    prompt: typeof record.prompt === 'string' ? record.prompt : '',
    dataUrl: record.dataUrl,
    providerId: typeof record.providerId === 'string' ? record.providerId : '',
    providerName: typeof record.providerName === 'string' ? record.providerName : '自动调度',
    mode: record.mode === 'reference' || record.mode === 'edit' ? record.mode : 'text',
    kind: record.kind || 'single',
    outputFormat: dataUrlFormat(record.dataUrl) || normalizeImageOutputFormat(record.outputFormat),
    createdAt,
  };
}

function normalizeRecords(records: StoredResultRecord[]): ResultRecord[] {
  return records
    .map((record, index) => normalizeRecord(record, index))
    .filter((record): record is ResultRecord => Boolean(record))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function openGalleryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('展馆数据库打开失败'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('展馆数据库事务失败'));
  });
}

async function migrateLocalStorageRecords(db: IDBDatabase) {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  let records: StoredResultRecord[] = [];
  try { records = JSON.parse(raw) as StoredResultRecord[]; } catch { records = []; }
  if (!records.length) return;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  normalizeRecords(records).forEach((record) => store.put(record));
  await txDone(tx);
  localStorage.removeItem(LEGACY_KEY);
}

export async function loadGalleryRecords(): Promise<ResultRecord[]> {
  try {
    const db = await openGalleryDb();
    await migrateLocalStorageRecords(db);
    const tx = db.transaction(STORE_NAME, 'readonly');
    const records = await new Promise<StoredResultRecord[]>((resolve, reject) => {
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result || []) as StoredResultRecord[]);
      request.onerror = () => reject(request.error || new Error('展馆读取失败'));
    });
    db.close();
    return normalizeRecords(records);
  } catch {
    return [];
  }
}

export async function saveGalleryRecord(record: ResultRecord): Promise<void> {
  const db = await openGalleryDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(normalizeRecord(record) || record);
  await txDone(tx);
  db.close();
}

export async function deleteGalleryRecord(id: string): Promise<void> {
  const db = await openGalleryDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await txDone(tx);
  db.close();
}

export async function clearGalleryRecords(): Promise<void> {
  const db = await openGalleryDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  await txDone(tx);
  db.close();
}
