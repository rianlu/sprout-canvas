import type { ResultRecord } from '../../types/generation';
import type { GenerationSubmission } from '../../../shared/generation-contract.mjs';
import { dataUrlToBlob, imageFromDataUrl } from '../image/data-url';
import { dataUrlFormat, normalizeImageOutputFormat } from '../image/format';

const DB_NAME = 'img-gen-gallery';
const DB_VERSION = 4;
const LEGACY_KEY = 'sprout_canvas_gallery_v1';
type Metadata = Omit<ResultRecord, 'dataUrl'> & { legacyDataUrl?: string };
export type Outbox = { requestId: string; input: GenerationSubmission; jobId?: string; savedAt: number; error?: string; retryRequestId?: string };
let connection: Promise<IDBDatabase> | undefined;
let migration: Promise<void> | undefined;

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error || new Error('本地数据库操作失败'));
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('本地存储事务未完成'));
  });
}

async function transact<T>(db: IDBDatabase, stores: string[], operation: (tx: IDBTransaction) => T | Promise<T>): Promise<T> {
  const tx = db.transaction(stores, 'readwrite');
  const completion = done(tx);
  // Observe aborts immediately, including when an earlier request rejects before we await commit.
  void completion.catch(() => {});
  try {
    const result = await operation(tx);
    await completion;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
    await completion.catch(() => {});
    throw error;
  }
}

export function openGalleryDb(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      const tx = open.transaction!;
      const records = db.objectStoreNames.contains('records') ? tx.objectStore('records') : db.createObjectStore('records', { keyPath: 'id' });
      if (!records.indexNames.contains('createdAt')) records.createIndex('createdAt', ['createdAt', 'id']);
      if (!records.indexNames.contains('seriesId')) records.createIndex('seriesId', 'seriesId');
      if (!records.indexNames.contains('requestId')) records.createIndex('requestId', 'requestId');
      if (!records.indexNames.contains('jobId')) records.createIndex('jobId', 'jobId');
      for (const name of ['artifacts', 'thumbnails', 'consumed', 'outbox', 'drafts']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      const cursor = records.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const record = normalizeRecord(row.value);
        if (record) {
          const { dataUrl, ...meta } = record;
          if (dataUrl.startsWith('data:image/')) tx.objectStore('artifacts').put(dataUrlToBlob(dataUrl), record.id);
          row.update({ ...meta, ...(dataUrl && !dataUrl.startsWith('data:image/') ? { legacyDataUrl: dataUrl } : {}) });
        }
        row.continue();
      };
    };
    open.onsuccess = () => {
      open.result.onversionchange = () => { open.result.close(); connection = undefined; };
      resolve(open.result);
    };
    open.onerror = () => { connection = undefined; reject(open.error || new Error('无法打开本地展馆')); };
    open.onblocked = () => { connection = undefined; reject(new Error('请关闭其他旧版本工作台标签页后重试')); };
  });
  return connection;
}

function normalizeRecord(value: Partial<ResultRecord>, index = 0): ResultRecord | null {
  if (!value || typeof value !== 'object') return null;
  const id = value.id || `legacy_untracked_${index}`;
  const numeric = Number(value.createdAt);
  const timestamp = Number.isFinite(numeric) ? numeric : Date.parse(String(value.createdAt || ''));
  return { ...value, id, dataUrl: value.dataUrl || '', prompt: value.prompt || '', providerId: value.providerId || '', providerName: value.providerName || '自动调度', mode: value.mode || 'text', kind: value.kind || 'single', outputFormat: dataUrlFormat(value.dataUrl || '') || normalizeImageOutputFormat(value.outputFormat), createdAt: Number.isFinite(timestamp) ? timestamp : Number(id.match(/(?:^|_)(\d{13})(?:_|$)/)?.[1] || 0) };
}

async function ensureMigration() {
  migration ??= (async () => {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('旧展馆数据格式无效, 原始数据已保留');
    const records = parsed.map(normalizeRecord);
    if (records.some((record) => !record?.dataUrl)) throw new Error('部分旧作品缺少图片数据, 原始记录已保留');
    await saveGalleryRecords(records as ResultRecord[]);
    localStorage.removeItem(LEGACY_KEY);
  })().catch((error) => { migration = undefined; throw error; });
  await migration;
}

async function thumbnail(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = await imageFromDataUrl(url);
    const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建作品缩略图');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const preview = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('作品缩略图生成失败')), 'image/webp', 0.8));
    return { preview, width: image.naturalWidth, height: image.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

export async function getArtifact(id: string): Promise<Blob | undefined> {
  const db = await openGalleryDb();
  return request(db.transaction('artifacts').objectStore('artifacts').get(id));
}

export async function getRecordBlob(record: ResultRecord): Promise<Blob> {
  const saved = await getArtifact(record.id);
  if (saved) return saved;
  if (!record.previewOnly && record.dataUrl.startsWith('data:image/')) return dataUrlToBlob(record.dataUrl);
  const db = await openGalleryDb();
  const meta: Metadata | undefined = await request(db.transaction('records').objectStore('records').get(record.id));
  if (meta?.legacyDataUrl) {
    const response = await fetch(meta.legacyDataUrl);
    if (!response.ok) throw new Error('旧作品链接已失效');
    return response.blob();
  }
  throw new Error('此作品的本地原图不存在');
}

export async function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取本地图片失败'));
    reader.readAsDataURL(blob);
  });
}

export async function getRecordDataUrl(record: ResultRecord) { return blobDataUrl(await getRecordBlob(record)); }

export async function attachLocalReference(input: GenerationSubmission): Promise<GenerationSubmission> {
  if (!input.referenceJobId || input.referenceImage) return input;
  const db = await openGalleryDb();
  const records = db.transaction('records').objectStore('records');
  const byRequest: Metadata | undefined = await request(records.index('requestId').get(input.referenceJobId));
  const meta = byRequest || await request(db.transaction('records').objectStore('records').index('jobId').get(input.referenceJobId));
  if (!meta) return input;
  const dataUrl = await getRecordDataUrl({ ...meta, dataUrl: '', previewOnly: true });
  return { ...input, referenceImage: { id: meta.id, recordId: meta.id, name: '首镜主体参考', dataUrl } };
}

export async function getRecordThumbnail(record: ResultRecord): Promise<Blob> {
  const db = await openGalleryDb();
  const saved: Blob | undefined = await request(db.transaction('thumbnails').objectStore('thumbnails').get(record.id));
  if (saved) return saved;
  const blob = await getRecordBlob(record);
  const thumb = await thumbnail(blob);
  await transact(db, ['records', 'artifacts', 'thumbnails'], async (tx) => {
    const meta: Metadata | undefined = await request(tx.objectStore('records').get(record.id));
    if (meta) {
      delete meta.legacyDataUrl;
      tx.objectStore('records').put({ ...meta, width: thumb.width, height: thumb.height, bytes: blob.size });
      tx.objectStore('artifacts').put(blob, record.id);
      tx.objectStore('thumbnails').put(thumb.preview, record.id);
    }
  });
  return thumb.preview;
}

export async function loadGalleryPage(before?: [number, string], limit = 100): Promise<{ records: ResultRecord[]; cursor?: [number, string] }> {
  const db = await openGalleryDb();
  const tx = db.transaction('records');
  const entries = await new Promise<Metadata[]>((resolve, reject) => {
    const rows: Metadata[] = [];
    const operation = tx.objectStore('records').index('createdAt').openCursor(before ? IDBKeyRange.upperBound(before, true) : undefined, 'prev');
    operation.onerror = () => reject(operation.error);
    operation.onsuccess = () => {
      const cursor = operation.result;
      if (!cursor || rows.length >= limit) { resolve(rows); return; }
      rows.push(cursor.value);
      cursor.continue();
    };
  });
  const records: ResultRecord[] = entries.map((entry) => ({ ...entry, dataUrl: '', previewOnly: true }));
  const last = entries.at(-1);
  return { records, ...(entries.length === limit && last ? { cursor: [last.createdAt, last.id] as [number, string] } : {}) };
}

export async function loadGalleryRecords(): Promise<ResultRecord[]> {
  await ensureMigration();
  const records: ResultRecord[] = [];
  let cursor: [number, string] | undefined;
  do {
    const page = await loadGalleryPage(cursor);
    records.push(...page.records);
    cursor = page.cursor;
  } while (cursor);
  return records;
}

export async function isJobConsumed(jobId: string): Promise<boolean> {
  const db = await openGalleryDb();
  return Boolean(await request(db.transaction('consumed').objectStore('consumed').get(jobId)));
}

export async function saveGalleryRecords(records: ResultRecord[], jobId?: string): Promise<ResultRecord[]> {
  const db = await openGalleryDb();
  const prepared: Array<{ meta: Metadata; blob: Blob; preview: Blob; refs: Array<{ id: string; blob: Blob }> }> = [];
  for (const record of records) {
    const blob = record.dataUrl.startsWith('data:') ? dataUrlToBlob(record.dataUrl) : await getRecordBlob(record);
    const thumb = await thumbnail(blob);
    const { dataUrl: _image, previewOnly: _preview, ...meta } = record;
    const refs: Array<{ id: string; blob: Blob }> = [];
    for (const ref of record.recipe?.references || []) {
      const refBlob = await getArtifact(`ref-${ref.id}`) || (ref.recordId ? await getArtifact(ref.recordId) : undefined);
      if (refBlob) refs.push({ id: `ref-${ref.id}`, blob: refBlob });
    }
    prepared.push({ meta: { ...meta, width: thumb.width, height: thumb.height, bytes: blob.size }, blob, preview: thumb.preview, refs });
  }
  return transact(db, ['records', 'artifacts', 'thumbnails', 'consumed'], async (tx) => {
    if (jobId && await request(tx.objectStore('consumed').get(jobId))) return [];
    for (const item of prepared) {
      tx.objectStore('records').put(item.meta);
      tx.objectStore('artifacts').put(item.blob, item.meta.id);
      tx.objectStore('thumbnails').put(item.preview, item.meta.id);
      item.refs.forEach((ref) => tx.objectStore('artifacts').put(ref.blob, ref.id));
    }
    if (jobId) tx.objectStore('consumed').put({ savedAt: Date.now() }, jobId);
    return prepared.map((item) => ({ ...item.meta, dataUrl: '', previewOnly: true }));
  });
}

export async function deleteGalleryRecords(ids: string[]): Promise<void> {
  const db = await openGalleryDb();
  await transact(db, ['records', 'artifacts', 'thumbnails', 'consumed', 'outbox'], async (tx) => {
    for (const id of ids) {
      const record: Metadata | undefined = await request(tx.objectStore('records').get(id));
      if (record?.jobId) tx.objectStore('consumed').put({ deletedAt: Date.now() }, record.jobId);
      tx.objectStore('records').delete(id);
      tx.objectStore('artifacts').delete(id);
      tx.objectStore('thumbnails').delete(id);
    }
    await collectReferencesInTransaction(tx);
  });
}

export async function clearGalleryRecords(): Promise<void> {
  const db = await openGalleryDb();
  const ids = await request(db.transaction('records').objectStore('records').getAllKeys());
  await deleteGalleryRecords(ids.map(String));
}
export function deleteGalleryRecord(id: string) { return deleteGalleryRecords([id]); }
export function saveGalleryRecord(record: ResultRecord) { return saveGalleryRecords([record], record.jobId); }

export async function saveOutbox(input: GenerationSubmission, jobId?: string) {
  const db = await openGalleryDb();
  const snapshot = structuredClone(input);
  const images = snapshot.request.references.map((ref) => ({ id: `ref-${ref.id}`, blob: dataUrlToBlob(ref.dataUrl) }));
  if (snapshot.referenceImage) {
    images.push({ id: `ref-${snapshot.referenceImage.id}`, blob: dataUrlToBlob(snapshot.referenceImage.dataUrl) });
    snapshot.referenceImage.dataUrl = '';
  }
  if (snapshot.request.mask) images.push({ id: `mask-${input.requestId}`, blob: dataUrlToBlob(snapshot.request.mask) });
  snapshot.request.references.forEach((ref) => { ref.dataUrl = ''; });
  if (snapshot.request.mask) snapshot.request.mask = '@local';
  await transact(db, ['outbox', 'artifacts'], async (tx) => {
    images.forEach(({ id, blob }) => tx.objectStore('artifacts').put(blob, id));
    const previous: Outbox | undefined = await request(tx.objectStore('outbox').get(input.requestId));
    tx.objectStore('outbox').put({ ...previous, requestId: input.requestId, input: snapshot, jobId: jobId || previous?.jobId, savedAt: previous?.savedAt || Date.now() }, input.requestId);
  });
}

export async function listOutbox(): Promise<Outbox[]> {
  const db = await openGalleryDb();
  return request(db.transaction('outbox').objectStore('outbox').getAll());
}

export async function getOutboxInput(requestId: string): Promise<GenerationSubmission | undefined> {
  const db = await openGalleryDb();
  const row: Outbox | undefined = await request(db.transaction('outbox').objectStore('outbox').get(requestId));
  if (!row) return undefined;
  const input = row.input;
  for (const ref of input.request.references) {
    const blob = await getArtifact(`ref-${ref.id}`);
    if (!blob) throw new Error('原始参考图已从本地删除');
    ref.dataUrl = await blobDataUrl(blob);
  }
  if (input.referenceImage) {
    const blob = await getArtifact(`ref-${input.referenceImage.id}`);
    if (!blob) throw new Error('首镜参考图片已从本地删除');
    input.referenceImage.dataUrl = await blobDataUrl(blob);
  }
  if (input.request.mask) {
    const blob = await getArtifact(`mask-${requestId}`);
    if (!blob) throw new Error('原始蒙版已从本地删除');
    input.request.mask = await blobDataUrl(blob);
  }
  return input;
}

export async function removeOutbox(requestId: string) {
  const db = await openGalleryDb();
  await transact(db, ['outbox'], (tx) => { tx.objectStore('outbox').delete(requestId); });
}

export async function collectUnusedReferences() {
  const db = await openGalleryDb();
  await transact(db, ['records', 'outbox', 'artifacts'], collectReferencesInTransaction);
}

async function collectReferencesInTransaction(tx: IDBTransaction) {
  const records: Metadata[] = await request(tx.objectStore('records').getAll());
  const outbox: Outbox[] = await request(tx.objectStore('outbox').getAll());
  const keys = await request(tx.objectStore('artifacts').getAllKeys());
  const used = new Set(records.flatMap((record) => [record.id, ...(record.recipe?.references.map((ref) => `ref-${ref.id}`) || []), ...(record.requestId && record.recipe?.hasMask ? [`mask-${record.requestId}`] : [])]));
  for (const row of outbox) {
    row.input.request.references.forEach((ref) => used.add(`ref-${ref.id}`));
    if (row.input.referenceImage) used.add(`ref-${row.input.referenceImage.id}`);
    if (row.input.request.mask) used.add(`mask-${row.requestId}`);
  }
  for (const key of keys) if (!used.has(String(key))) tx.objectStore('artifacts').delete(key);
}

export async function readWorkspaceDraft<T>(key: string): Promise<T | undefined> {
  const db = await openGalleryDb();
  const value = await request(db.transaction('drafts').objectStore('drafts').get(key));
  return value?.version === 1 ? value.data as T : undefined;
}

export async function writeWorkspaceDraft(key: string, data: unknown) {
  const db = await openGalleryDb();
  await transact(db, ['drafts'], (tx) => {
    if (data === undefined) tx.objectStore('drafts').delete(key);
    else tx.objectStore('drafts').put({ version: 1, data }, key);
  });
}
