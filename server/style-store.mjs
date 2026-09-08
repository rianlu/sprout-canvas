import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { imageInfo } from './image-result.mjs';
import { requestError } from '../shared/generation-contract.mjs';
import { STYLE_ARCHIVE_FORMAT, STYLE_ID, STYLE_IMAGE_FILE, STYLE_LIMITS, validateStyleInput } from '../shared/style-contract.mjs';

const EDITABLE = ['name', 'prompt', 'author', 'category', 'sourceUrl', 'published', 'sortOrder'];
const STORED = [...EDITABLE, 'id', 'imageFile', 'imageBytes', 'imageWidth', 'imageHeight', 'license', 'licenseUrl', 'collectionUrl', 'version', 'createdAt', 'updatedAt'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const mimeForFile = (file) => file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.png') ? 'image/png' : 'image/webp';

function archiveEnvelope(records, images) {
  return { format: STYLE_ARCHIVE_FORMAT, version: 1, exportedAt: new Date().toISOString(), styles: records, images };
}

// Include UTF-8 metadata, base64 expansion and formatted export overhead before accepting writes.
function assertPortableCatalog(records) {
  const images = new Map(records.map((record) => [record.imageFile, record.imageBytes]));
  const stubs = [...images.keys()].map((file) => ({ file, dataUrl: 'data:' + mimeForFile(file) + ';base64,' }));
  const metadataBytes = Buffer.byteLength(JSON.stringify(archiveEnvelope(records, stubs), null, 2));
  const encodedBytes = [...images.values()].reduce((sum, bytes) => sum + Math.ceil(bytes / 3) * 4, 0);
  if (metadataBytes + encodedBytes > STYLE_LIMITS.archiveBytes - 1024) throw requestError('风格库已达到 64 MB 备份容量, 请缩小示例图或清理不用的风格后再保存', 413);
}

function imageBytes(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw requestError('请选择有效的 PNG, JPEG 或 WebP 示例图');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) throw requestError('示例图编码无效');
  const info = validateImage(bytes);
  if (info.mime_type !== `image/${match[1]}`) throw requestError('示例图内容与文件类型不一致');
  return { bytes, ...info };
}

function validateImage(bytes) {
  if (!bytes.length || bytes.length > STYLE_LIMITS.imageBytes) throw requestError('示例图不能超过 12 MB', 413);
  let info;
  try { info = imageInfo(bytes); } catch { throw requestError('示例图内容无效, 请重新选择图片'); }
  if (!info.width || !info.height || info.width > 12000 || info.height > 12000 || info.width * info.height > 40000000) throw requestError('示例图尺寸过大, 请先缩小图片');
  return info;
}

function recordImage(image) {
  return { imageFile: `${hash(image.bytes)}.${image.mime_type === 'image/jpeg' ? 'jpg' : image.mime_type.slice(6)}`, imageBytes: image.bytes.length, imageWidth: image.width, imageHeight: image.height };
}

export function createStyleStore(directory, { seedDirectory = new URL('./style-seed/', import.meta.url), log = () => {} } = {}) {
  const images = path.join(directory, 'images');
  mkdirSync(images, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'library.sqlite');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (schemaVersion > 1) { db.close(); throw new Error('风格数据库版本较新, 请使用对应版本的程序'); }
  if (schemaVersion === 0) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE styles (id TEXT PRIMARY KEY, data TEXT NOT NULL, published INTEGER NOT NULL, sort_order INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX styles_order ON styles(published, sort_order, updated_at);
    CREATE TABLE library_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT INTO library_meta VALUES ('revision', 0);
    CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, credential_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
    PRAGMA user_version = 1;
    COMMIT;`);
  const put = db.prepare('INSERT INTO styles VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, published=excluded.published, sort_order=excluded.sort_order, updated_at=excluded.updated_at');
  const all = () => db.prepare('SELECT data FROM styles ORDER BY sort_order, updated_at DESC, id').all().map((row) => JSON.parse(row.data));
  const get = (id) => { const row = db.prepare('SELECT data FROM styles WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; };
  const revision = () => db.prepare("SELECT value FROM library_meta WHERE key='revision'").get().value;
  const saveRow = (record) => put.run(record.id, JSON.stringify(record), Number(record.published), record.sortOrder, record.updatedAt);
  const serialize = (record, admin = false) => {
    const { imageFile, ...value } = record;
    return { ...value, image: `/api/${admin ? 'admin/' : ''}styles/images/${imageFile}` };
  };
  function cleanup() {
    let used, files;
    try { used = new Set(all().map((record) => record.imageFile)); files = readdirSync(images); }
    catch (error) { log('WARN', '风格素材清理未完成: ' + (error.code || 'unknown')); return; }
    for (const file of files) {
      if ((STYLE_IMAGE_FILE.test(file) && !used.has(file)) || /^[a-f0-9-]+\.tmp$/.test(file)) {
        try { unlinkSync(path.join(images, file)); } catch (error) { log('WARN', `风格素材清理失败: ${error.code || 'unknown'}`); }
      }
    }
  }
  function writeImage(file, bytes) {
    const destination = path.join(images, file);
    if (existsSync(destination)) {
      if (hash(readFileSync(destination)) !== hash(bytes)) throw new Error('风格图片完整性检查失败');
      return;
    }
    const temporary = path.join(images, `${randomUUID()}.tmp`);
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, destination);
  }
  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    let result;
    try {
      result = action();
      db.prepare("UPDATE library_meta SET value=value+1 WHERE key='revision'").run();
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (rollbackError) { log('ERROR', '风格事务回滚失败: ' + (rollbackError.code || 'unknown')); }
      cleanup();
      throw error;
    }
    cleanup();
    return result;
  }
  function checkVersion(record, version) {
    if (!record) throw requestError('风格不存在或已删除', 404);
    if (record.version !== version) throw requestError('这条风格已在其他页面修改, 请重新打开后编辑', 409);
  }
  function archivePlan(archive) {
    if (!archive || archive.format !== STYLE_ARCHIVE_FORMAT || archive.version !== 1 || !Array.isArray(archive.styles) || !Array.isArray(archive.images)) throw requestError('请选择芽绘台导出的风格备份文件');
    if (archive.styles.length > STYLE_LIMITS.entries || archive.images.length > STYLE_LIMITS.entries) throw requestError('备份最多包含 1000 条风格');
    const files = new Map();
    for (const image of archive.images) {
      if (!image || !STYLE_IMAGE_FILE.test(image.file) || files.has(image.file)) throw requestError('备份图片编号无效或重复');
      const decoded = imageBytes(image.dataUrl);
      if (recordImage(decoded).imageFile !== image.file) throw requestError('备份图片校验失败');
      files.set(image.file, decoded);
    }
    const ids = new Set();
    let added = 0, updated = 0, unchanged = 0;
    const records = archive.styles.map((item) => {
      if (!item || !STYLE_ID.test(item.id) || ids.has(item.id) || Object.keys(item).some((key) => !STORED.includes(key))) throw requestError('备份风格编号无效, 重复或含未知字段');
      ids.add(item.id);
      const value = validateStyleInput(Object.fromEntries(EDITABLE.map((key) => [key, item[key]])));
      const image = files.get(item.imageFile);
      if (!image) throw requestError('备份缺少风格对应的示例图');
      for (const key of ['license', 'licenseUrl', 'collectionUrl']) {
        if (typeof item[key] !== 'string' || item[key].length > 2048) throw requestError('备份来源信息无效');
      }
      for (const key of ['licenseUrl', 'collectionUrl']) if (item[key]) validateStyleInput({ prompt: '校验来源', sourceUrl: item[key] });
      if (![item.createdAt, item.updatedAt, item.version].every((value) => Number.isSafeInteger(value) && value > 0)) throw requestError('备份版本或时间无效');
      const prior = get(item.id);
      const content = { ...value, ...recordImage(image), license: item.license, licenseUrl: item.licenseUrl, collectionUrl: item.collectionUrl };
      const identical = prior && Object.entries(content).every(([key, value]) => prior[key] === value);
      if (identical) { unchanged++; return prior; }
      if (prior) updated++; else added++;
      return { ...content, id: item.id, createdAt: prior?.createdAt || item.createdAt, updatedAt: Date.now(), version: (prior?.version || 0) + 1 };
    });
    const mergedCount = all().length + added;
    if (mergedCount > STYLE_LIMITS.entries) throw requestError('风格库最多保存 1000 条内容');
    assertPortableCatalog([...all().filter((record) => !ids.has(record.id)), ...records]);
    return { records, files, summary: { added, updated, unchanged, total: records.length, revision: revision() } };
  }

  try {
    if (!db.prepare("SELECT value FROM library_meta WHERE key='seeded'").get()) {
      const seed = JSON.parse(readFileSync(new URL('catalog.json', seedDirectory), 'utf8'));
      transaction(() => {
        seed.styles.forEach((item, index) => {
          const bytes = readFileSync(new URL(`images/${item.id}.webp`, seedDirectory));
          const image = { bytes, ...validateImage(bytes) };
          const record = { ...validateStyleInput({ name: item.name, prompt: item.prompt, author: item.author, category: item.category, sourceUrl: item.sourceUrl, sortOrder: index }), id: item.id, ...recordImage(image), license: item.license, licenseUrl: item.licenseUrl, collectionUrl: item.collectionUrl, version: 1, createdAt: Date.now(), updatedAt: Date.now() };
          writeImage(record.imageFile, bytes);
          saveRow(record);
        });
        db.prepare("INSERT INTO library_meta VALUES ('seeded', 1)").run();
      });
    }
    cleanup();
    db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(Date.now());
  } catch (error) { db.close(); throw error; }

  return {
    catalog(admin = false) {
      const records = all().filter((record) => admin || record.published);
      return { styles: records.map((record) => serialize(record, admin)), categories: [...new Set(records.map((record) => record.category).filter(Boolean))], revision: revision() };
    },
    image(file, admin = false) {
      if (!STYLE_IMAGE_FILE.test(file) || !all().some((record) => record.imageFile === file && (admin || record.published))) throw requestError('示例图不存在', 404);
      let bytes;
      try { bytes = readFileSync(path.join(images, file)); } catch { throw requestError('示例图文件缺失, 请在管理页重新上传', 404); }
      return { bytes, mime: mimeForFile(file) };
    },
    create(input) {
      const value = validateStyleInput(input);
      if (all().length >= STYLE_LIMITS.entries) throw requestError('风格库最多保存 1000 条内容');
      const image = imageBytes(input.imageDataUrl);
      const record = { ...value, ...recordImage(image), id: randomUUID(), license: '', licenseUrl: '', collectionUrl: '', version: 1, createdAt: Date.now(), updatedAt: Date.now() };
      assertPortableCatalog([...all(), record]);
      transaction(() => { writeImage(record.imageFile, image.bytes); saveRow(record); });
      return serialize(record, true);
    },
    update(id, input) {
      const value = validateStyleInput(input);
      const prior = get(id);
      checkVersion(prior, input.version);
      const image = input.imageDataUrl === undefined ? null : imageBytes(input.imageDataUrl);
      const sourceChanged = value.author !== prior.author || value.sourceUrl !== prior.sourceUrl || (image && recordImage(image).imageFile !== prior.imageFile);
      const record = { ...prior, ...value, ...(image ? recordImage(image) : {}), ...(sourceChanged ? { license: '', licenseUrl: '', collectionUrl: '' } : {}), version: prior.version + 1, updatedAt: Date.now() };
      assertPortableCatalog(all().map((item) => item.id === id ? record : item));
      transaction(() => { if (image) writeImage(record.imageFile, image.bytes); saveRow(record); });
      return serialize(record, true);
    },
    remove(id, version) {
      checkVersion(get(id), version);
      transaction(() => db.prepare('DELETE FROM styles WHERE id=?').run(id));
    },
    export() {
      const records = all();
      assertPortableCatalog(records);
      return archiveEnvelope(records, [...new Set(records.map((record) => record.imageFile))].map((file) => {
        const bytes = readFileSync(path.join(images, file));
        return { file, dataUrl: `data:${validateImage(bytes).mime_type};base64,${bytes.toString('base64')}` };
      }));
    },
    previewImport(archive) { return archivePlan(archive).summary; },
    import(archive, expectedRevision) {
      const plan = archivePlan(archive);
      if (expectedRevision !== revision()) throw requestError('风格库已发生变化, 请重新预览导入', 409);
      if (plan.summary.added || plan.summary.updated) transaction(() => {
        for (const record of plan.records) { writeImage(record.imageFile, plan.files.get(record.imageFile).bytes); saveRow(record); }
      });
      return { ...plan.summary, revision: revision() };
    },
    createAdminSession(token, credential, expiresAt) { db.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?)').run(hash(token), hash(credential), expiresAt); },
    adminSession(token, credential) { return Boolean(db.prepare('SELECT 1 FROM admin_sessions WHERE token_hash=? AND credential_hash=? AND expires_at>?').get(hash(token), hash(credential), Date.now())); },
    deleteAdminSession(token) { db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hash(token)); },
    close() { db.close(); },
  };
}
