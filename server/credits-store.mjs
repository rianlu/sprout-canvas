import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CREDIT_DEFAULTS, CREDIT_LIMITS, creditError, creditInteger, creditRequestId, creditText, validateCreditQuote } from '../shared/credits-contract.mjs';
import { requestError } from '../shared/generation-contract.mjs';

export const secretHash = (value) => createHash('sha256').update(String(value)).digest('hex');
const intentHash = (value) => secretHash(JSON.stringify(value));
const publicCharge = (row) => row && ({ id: row.id, kind: row.kind, points: row.points, state: row.state, priceVersion: row.price_version, unlimited: Boolean(row.unlimited) });
const DAY_MS = 86400000;
const REPORTING_OFFSET = 8 * 60 * 60 * 1000;
const emptyUsage = () => ({ images: 0, texts: 0, imagePoints: 0, textPoints: 0, points: 0, deducted: 0 });
const usageColumns = `coalesce(sum(CASE WHEN kind='image' THEN 1 ELSE 0 END),0) AS images,
  coalesce(sum(CASE WHEN kind!='image' THEN 1 ELSE 0 END),0) AS texts,
  coalesce(sum(CASE WHEN kind='image' THEN points ELSE 0 END),0) AS imagePoints,
  coalesce(sum(CASE WHEN kind!='image' THEN points ELSE 0 END),0) AS textPoints,
  coalesce(sum(points),0) AS points, coalesce(sum(CASE WHEN unlimited=0 THEN points ELSE 0 END),0) AS deducted`;

export function createCreditsStore(db, transaction) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_codes (
      id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, tail TEXT NOT NULL, note TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      points INTEGER NOT NULL CHECK(points >= 0), reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= points),
      spent INTEGER NOT NULL DEFAULT 0 CHECK(spent >= 0), version INTEGER NOT NULL DEFAULT 1, epoch INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS credit_prices (id INTEGER PRIMARY KEY CHECK(id=1), image INTEGER NOT NULL, text INTEGER NOT NULL, version INTEGER NOT NULL);
    INSERT OR IGNORE INTO credit_prices VALUES (1, ${CREDIT_DEFAULTS.image}, ${CREDIT_DEFAULTS.text}, 1);
    CREATE TABLE IF NOT EXISTS credit_operations (
      id TEXT PRIMARY KEY, code_id TEXT NOT NULL REFERENCES access_codes(id), user_id TEXT NOT NULL,
      request_id TEXT NOT NULL, request_hash TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('image','prompt','series')),
      points INTEGER NOT NULL CHECK(points > 0), price_version INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('reserved','running','charged','refunded','unknown')),
      result TEXT, error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(user_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS credit_operations_code ON credit_operations(code_id, state, created_at);
    CREATE INDEX IF NOT EXISTS credit_operations_charged_time ON credit_operations(updated_at) WHERE state='charged';
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id INTEGER PRIMARY KEY, code_id TEXT NOT NULL REFERENCES access_codes(id), operation_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL, event TEXT NOT NULL, points INTEGER NOT NULL, available INTEGER NOT NULL, reserved INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS credit_ledger_code ON credit_ledger(code_id, id);
    CREATE TABLE IF NOT EXISTS credit_admin_actions (id TEXT PRIMARY KEY, intent_hash TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
  transaction(() => {
    for (const [table, fields] of [
      ['access_codes', [['unlimited', 'INTEGER NOT NULL DEFAULT 0 CHECK(unlimited IN (0,1))'], ['deleted_at', 'INTEGER NOT NULL DEFAULT 0']]],
      ['credit_operations', [['unlimited', 'INTEGER NOT NULL DEFAULT 0 CHECK(unlimited IN (0,1))']]],
      ['credit_ledger', [['unlimited', 'INTEGER NOT NULL DEFAULT 0 CHECK(unlimited IN (0,1))']]],
    ]) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
      for (const [name, type] of fields) if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  });
  function code(id) { return db.prepare('SELECT * FROM access_codes WHERE id=?').get(id); }
  function balance(row) {
    return row && { accessCodeId: row.id, tail: row.tail, available: row.points - row.reserved, reserved: row.reserved, spent: row.spent, enabled: Boolean(row.enabled), unlimited: Boolean(row.unlimited) };
  }
  function publicCode(row) {
    return row && { ...balance(row), id: row.id, note: row.note, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, lastUsedAt: row.last_used_at };
  }
  function requiredCode(id, version) {
    const row = code(id);
    if (!row || row.deleted_at) throw requestError('访问码不存在或已删除', 404);
    if (version !== undefined && row.version !== creditInteger(version, '访问码版本', 1, Number.MAX_SAFE_INTEGER)) throw creditError('访问码已被更新, 请刷新后重试', 'VERSION_CONFLICT');
    return row;
  }
  function prices() { const { image, text, version } = db.prepare('SELECT * FROM credit_prices WHERE id=1').get(); return { image, text, version }; }
  function ledger(row, event, points, { id = '', kind = 'admin', reason = '' } = {}) {
    db.prepare('INSERT INTO credit_ledger (code_id,operation_id,kind,event,points,available,reserved,reason,created_at,unlimited) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(row.id, id, kind, event, points, row.points - row.reserved, row.reserved, reason, Date.now(), row.unlimited);
  }
  function adminAction(requestId, action, input, callback) {
    creditRequestId(requestId);
    const hash = intentHash({ action, input });
    return transaction(() => {
      const previous = db.prepare('SELECT * FROM credit_admin_actions WHERE id=?').get(requestId);
      if (previous) {
        if (previous.intent_hash !== hash) throw creditError('请求编号已用于其他管理操作', 'REQUEST_CONFLICT');
        return { ...JSON.parse(previous.result), replayed: true };
      }
      const result = callback();
      // Bearer credentials may only be returned by the original mutation. Never persist plaintext codes.
      const saved = JSON.parse(JSON.stringify(result, (key, value) => key === 'code' ? undefined : value));
      db.prepare('INSERT INTO credit_admin_actions VALUES (?,?,?,?)').run(requestId, hash, JSON.stringify(saved), Date.now());
      return result;
    });
  }
  function randomCode() {
    let value;
    do { value = `sc_${randomBytes(24).toString('base64url')}`; } while (db.prepare('SELECT 1 FROM access_codes WHERE code_hash=?').get(secretHash(value)));
    return value;
  }
  function operation(id) { return db.prepare('SELECT * FROM credit_operations WHERE id=?').get(id); }
  function byRequest(userId, requestId) { return db.prepare('SELECT * FROM credit_operations WHERE user_id=? AND request_id=?').get(userId, requestId); }
  function authorized(session) {
    const row = session && code(session.accessCodeId);
    if (!row || row.deleted_at || !row.enabled || row.epoch !== session.codeEpoch) throw creditError('访问码已失效 (停用或重置或删除), 请更换访问码后继续', 'ACCESS_CODE_UNAVAILABLE', 403);
    return row;
  }
  function checkQuote(session, quote, requireCurrent = true) {
    const normalized = validateCreditQuote(quote);
    const row = authorized(session);
    if (normalized.accessCodeId !== row.id) throw creditError('此请求属于另一个访问码, 请切换回原访问码处理', 'ACCESS_CODE_MISMATCH', 409);
    if (normalized.userId !== session.userId) throw creditError('浏览器身份已变化, 请确认后以新请求重新创建任务', 'BROWSER_IDENTITY_CHANGED', 409);
    const current = prices();
    if (requireCurrent && normalized.version !== current.version) throw creditError('灵感点消耗已调整, 请检查最新点数后再次确认', 'PRICE_CHANGED', 409, { prices: current });
    if (requireCurrent && normalized.unlimited !== Boolean(row.unlimited)) throw creditError('访问码额度模式已调整, 请检查最新额度后再次确认', 'CREDIT_MODE_CHANGED', 409, { credits: balance(row), prices: current });
    return { row, prices: current };
  }
  function reserve({ id, session, requestId, requestHash, kind, quote }) {
    const existing = byRequest(session.userId, requestId);
    if (existing) {
      checkQuote(session, quote, false);
      if (existing.request_hash !== requestHash || existing.kind !== kind) throw creditError('请求编号已用于不同内容', 'REQUEST_CONFLICT');
      return existing;
    }
    const { row, prices: current } = checkQuote(session, quote);
    const points = kind === 'image' ? current.image : current.text;
    if (!row.unlimited && row.points - row.reserved < points) throw creditError(`灵感点不足, 本次需要 ${points} 点, 当前可用 ${row.points - row.reserved} 点`, 'INSUFFICIENT_CREDITS', 402, { required: points, available: row.points - row.reserved });
    const now = Date.now();
    const reserved = row.unlimited ? 0 : points;
    db.prepare('UPDATE access_codes SET reserved=reserved+?,last_used_at=? WHERE id=?').run(reserved, now, row.id);
    db.prepare('INSERT INTO credit_operations (id,code_id,user_id,request_id,request_hash,kind,points,price_version,state,created_at,updated_at,unlimited) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, row.id, session.userId, creditRequestId(requestId), requestHash, kind, points, current.version, 'reserved', now, now, row.unlimited);
    ledger(code(row.id), 'reserve', -reserved, { id, kind });
    return operation(id);
  }
  function settle(id, state, { result = null, error = '', reason = '', manual = false } = {}) {
    const op = operation(id);
    if (!op) throw new Error('任务缺少灵感点预占记录');
    if (op.state === state || ['charged', 'refunded'].includes(op.state)) return op;
    if (op.state === 'unknown' && !manual) return op;
    const reserved = op.unlimited ? 0 : op.points;
    if (state === 'charged' || state === 'refunded') {
      if (state === 'charged') {
        const row = code(op.code_id);
        if (!Number.isSafeInteger(row.spent + op.points)) throw new Error('灵感点累计值超出安全范围');
        db.prepare('UPDATE access_codes SET reserved=reserved-?,points=points-?,spent=spent+? WHERE id=?').run(reserved, reserved, op.points, op.code_id);
      } else db.prepare('UPDATE access_codes SET reserved=reserved-? WHERE id=?').run(reserved, op.code_id);
      ledger(code(op.code_id), state === 'charged' ? 'charge' : 'refund', state === 'refunded' ? reserved : 0, { ...op, reason });
    } else if (state === 'unknown') ledger(code(op.code_id), 'unknown', 0, { ...op, reason });
    db.prepare('UPDATE credit_operations SET state=?,result=?,error=?,updated_at=? WHERE id=?').run(state, result ? JSON.stringify(result) : op.result, error, Date.now(), id);
    return operation(id);
  }
  return {
    prices, authorized, checkQuote, operation, byRequest,
    balance(id) { return balance(code(id)); },
    publicCharge(id) { return publicCharge(operation(id)); },
    getCode(id) { return publicCode(requiredCode(id)); },
    overview(now = Date.now()) {
      const accessCodes = { ...db.prepare(`SELECT count(*) AS total, coalesce(sum(enabled),0) AS enabled,
        coalesce(sum(1-enabled),0) AS disabled, coalesce(sum(unlimited),0) AS unlimited
        FROM access_codes WHERE deleted_at=0`).get() };
      // Charged updated_at is stable across replays, result cleanup and restarts. Manual resolutions count on their settlement date.
      // Use Beijing dates explicitly so host and Docker timezone settings cannot change the reporting boundaries.
      const dateKey = (timestamp) => new Date(timestamp + REPORTING_OFFSET).toISOString().slice(0, 10);
      const endDate = dateKey(now);
      const dayStart = Date.parse(`${endDate}T00:00:00+08:00`);
      const historyStart = dayStart - 364 * DAY_MS;
      const monthStart = `${endDate.slice(0, 7)}-01`;
      const usage = { ...db.prepare(`SELECT ${usageColumns} FROM credit_operations WHERE state='charged' AND updated_at<=?`).get(now) };
      const daily = db.prepare(`SELECT date(updated_at/1000.0,'unixepoch','+8 hours') AS date, ${usageColumns}
        FROM credit_operations WHERE state='charged' AND updated_at>=? AND updated_at<=? GROUP BY date ORDER BY date`).all(historyStart, now);
      const usagePeriods = { today: emptyUsage(), month: emptyUsage() };
      const byDate = new Map(daily.map((row) => [row.date, row]));
      for (const { date, ...totals } of daily) {
        if (date === endDate) usagePeriods.today = { ...totals };
        if (date >= monthStart) for (const key of Object.keys(usagePeriods.month)) usagePeriods.month[key] += totals[key];
      }
      const activity = { timeZone: 'Asia/Shanghai', startDate: dateKey(historyStart), endDate,
        days: Array.from({ length: 365 }, (_, index) => {
          const date = dateKey(historyStart + index * DAY_MS);
          const row = byDate.get(date) || emptyUsage();
          return { date, images: row.images, texts: row.texts, points: row.points };
        }),
      };
      const pendingReview = { ...db.prepare(`SELECT count(*) AS total, count(DISTINCT code_id) AS codeCount,
        coalesce(sum(CASE WHEN unlimited=0 THEN points ELSE 0 END),0) AS reserved
        FROM credit_operations WHERE state='unknown'`).get() };
      pendingReview.codes = db.prepare(`SELECT c.id, c.note, c.tail, count(*) AS count,
        sum(CASE WHEN o.unlimited=0 THEN o.points ELSE 0 END) AS reserved, min(o.updated_at) AS oldestAt
        FROM credit_operations o JOIN access_codes c ON c.id=o.code_id WHERE o.state='unknown'
        GROUP BY c.id ORDER BY oldestAt,c.id LIMIT 6`).all().map((row) => ({ ...row }));
      return { accessCodes, usage, usagePeriods, activity, pendingReview, prices: prices() };
    },
    list({ search = '', status = 'all', cursor = 0, limit = 30 } = {}) {
      creditInteger(cursor, '页码', 0, Number.MAX_SAFE_INTEGER); creditInteger(limit, '每页数量', 1, 100);
      if (!['all', 'enabled', 'disabled'].includes(status)) throw requestError('状态筛选无效');
      const query = `%${creditText(search, '搜索内容', CREDIT_LIMITS.note).replace(/[\\%_]/g, '\\$&')}%`;
      const where = "deleted_at=0 AND (note LIKE ? ESCAPE '\\' OR tail LIKE ? ESCAPE '\\') AND (?='all' OR enabled=?)";
      const args = [query, query, status, status === 'enabled' ? 1 : 0];
      const rows = db.prepare(`SELECT * FROM access_codes WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(...args, limit + 1, cursor);
      return { codes: rows.slice(0, limit).map(publicCode), nextCursor: rows.length > limit ? cursor + limit : null, total: db.prepare(`SELECT count(*) AS count FROM access_codes WHERE ${where}`).get(...args).count };
    },
    create(input) {
      const count = creditInteger(input.count ?? 1, '数量', 1, CREDIT_LIMITS.batch);
      const points = creditInteger(input.initialPoints, '初始灵感点');
      const note = creditText(input.note ?? '', '备注', CREDIT_LIMITS.note);
      if (input.unlimited !== undefined && typeof input.unlimited !== 'boolean') throw requestError('额度模式无效');
      const unlimited = Number(input.unlimited ?? false);
      if (unlimited && points !== 0) throw requestError('创建无限额度码时初始点数应为 0');
      return adminAction(input.requestId, 'create', { count, points, note, ...(unlimited ? { unlimited } : {}) }, () => ({ codes: Array.from({ length: count }, (_, index) => {
        const id = randomUUID(); const value = randomCode(); const now = Date.now();
        db.prepare('INSERT INTO access_codes (id,code_hash,tail,note,points,created_at,updated_at,unlimited) VALUES (?,?,?,?,?,?,?,?)').run(id, secretHash(value), value.slice(-6), count > 1 && note ? `${note.slice(0, 112)} ${index + 1}` : note, points, now, now, unlimited);
        ledger(code(id), 'create', points, { reason: unlimited ? '创建无限额度访问码' : '初始灵感点' });
        return { ...publicCode(code(id)), code: value };
      }) }));
    },
    update(id, input) {
      creditInteger(input.version, '访问码版本', 1, Number.MAX_SAFE_INTEGER);
      const note = input.note === undefined ? undefined : creditText(input.note, '备注', CREDIT_LIMITS.note);
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw requestError('启用状态无效');
      if (input.unlimited !== undefined && typeof input.unlimited !== 'boolean') throw requestError('额度模式无效');
      const delta = creditInteger(input.delta ?? 0, '调整点数', -CREDIT_LIMITS.points, CREDIT_LIMITS.points);
      const reason = creditText(input.reason ?? '', '调整原因', CREDIT_LIMITS.reason, Boolean(delta));
      return adminAction(input.requestId, `update:${id}`, { note, enabled: input.enabled, unlimited: input.unlimited, delta: input.delta === undefined ? undefined : delta, reason: input.reason === undefined ? undefined : reason, version: input.version }, () => {
        const row = requiredCode(id, input.version);
        const enabled = input.enabled === undefined ? row.enabled : Number(input.enabled);
        const changed = enabled !== row.enabled;
        const unlimited = input.unlimited === undefined ? row.unlimited : Number(input.unlimited);
        if (unlimited && delta) throw requestError('无限额度不需要调整点数, 请先选择有限额度');
        if (row.points + delta < row.reserved) throw requestError('扣减不能超过当前可用灵感点');
        creditInteger(row.points + delta, '调整后的总点数');
        db.prepare('UPDATE access_codes SET note=?,enabled=?,unlimited=?,points=points+?,epoch=epoch+?,version=version+1,updated_at=? WHERE id=?').run(note ?? row.note, enabled, unlimited, delta, changed ? 1 : 0, Date.now(), id);
        if (changed) ledger(code(id), enabled ? 'enable' : 'disable', 0, { reason: enabled ? '启用访问码' : '停用访问码' });
        if (unlimited !== row.unlimited) ledger(code(id), 'quota', 0, { reason: unlimited ? '切换为无限额度, 保留原余额' : '切换为有限额度, 使用保留的余额' });
        if (delta) ledger(code(id), 'adjust', delta, { reason });
        return { accessCode: publicCode(code(id)), revoked: changed };
      });
    },
    adjust(id, input) {
      creditInteger(input.version, '访问码版本', 1, Number.MAX_SAFE_INTEGER);
      const delta = creditInteger(input.delta, '调整点数', -CREDIT_LIMITS.points, CREDIT_LIMITS.points);
      if (!delta) throw requestError('调整点数不能为 0');
      const reason = creditText(input.reason, '调整原因', CREDIT_LIMITS.reason, true);
      return adminAction(input.requestId, `adjust:${id}`, { delta, reason, version: input.version }, () => {
        const row = requiredCode(id, input.version);
        if (row.unlimited) throw requestError('无限额度不需要调整点数, 请先选择有限额度');
        if (row.points + delta < row.reserved) throw requestError('扣减不能超过当前可用灵感点');
        creditInteger(row.points + delta, '调整后的总点数');
        db.prepare('UPDATE access_codes SET points=points+?,version=version+1,updated_at=? WHERE id=?').run(delta, Date.now(), id);
        ledger(code(id), 'adjust', delta, { reason });
        return { accessCode: publicCode(code(id)) };
      });
    },
    reset(id, input) {
      creditInteger(input.version, '访问码版本', 1, Number.MAX_SAFE_INTEGER);
      const reason = creditText(input.reason ?? '管理员重置访问码', '重置原因', CREDIT_LIMITS.reason, true);
      return adminAction(input.requestId, `reset:${id}`, { reason, version: input.version }, () => {
        requiredCode(id, input.version); const value = randomCode();
        db.prepare('UPDATE access_codes SET code_hash=?,tail=?,epoch=epoch+1,version=version+1,updated_at=? WHERE id=?').run(secretHash(value), value.slice(-6), Date.now(), id);
        ledger(code(id), 'reset', 0, { reason });
        return { accessCode: publicCode(code(id)), code: value, revoked: true };
      });
    },
    remove(id, input) {
      creditInteger(input.version, '访问码版本', 1, Number.MAX_SAFE_INTEGER);
      const reason = creditText(input.reason ?? '管理员删除访问码', '删除原因', CREDIT_LIMITS.reason, true);
      return adminAction(input.requestId, `delete:${id}`, { reason, version: input.version }, () => {
        requiredCode(id, input.version);
        const active = db.prepare("SELECT count(*) AS count FROM credit_operations WHERE code_id=? AND state IN ('running','unknown')").get(id).count;
        if (active) throw creditError('此访问码还有执行中或待核实任务, 请先停用并在任务结束或核实后删除', 'ACCESS_CODE_HAS_UNSETTLED_TASKS');
        db.prepare('UPDATE access_codes SET enabled=0,deleted_at=?,epoch=epoch+1,version=version+1,updated_at=? WHERE id=?').run(Date.now(), Date.now(), id);
        for (const op of db.prepare("SELECT id FROM credit_operations WHERE code_id=? AND state='reserved'").all(id)) settle(op.id, 'refunded', { reason: '删除访问码, 取消未执行任务' });
        ledger(code(id), 'delete', 0, { reason });
        return { id, deleted: true, revoked: true };
      });
    },
    setPrices(input) {
      const image = creditInteger(input.image, '图片点值', 1, CREDIT_LIMITS.price);
      const text = creditInteger(input.text, '文字点值', 1, CREDIT_LIMITS.price);
      const version = creditInteger(input.version, '点值版本', 1, Number.MAX_SAFE_INTEGER);
      return adminAction(input.requestId, 'prices', { image, text, version }, () => {
        if (prices().version !== version) throw creditError('点值已被修改, 请刷新后重试', 'VERSION_CONFLICT');
        db.prepare('UPDATE credit_prices SET image=?,text=?,version=version+1 WHERE id=1').run(image, text);
        return { prices: prices() };
      });
    },
    ledger(id, { cursor = Number.MAX_SAFE_INTEGER, limit = 30 } = {}) {
      requiredCode(id); creditInteger(cursor, '流水游标', 1, Number.MAX_SAFE_INTEGER); creditInteger(limit, '每页数量', 1, 100);
      const rows = db.prepare('SELECT l.*,o.points AS operation_points,o.unlimited AS operation_unlimited FROM credit_ledger l LEFT JOIN credit_operations o ON o.id=l.operation_id WHERE l.code_id=? AND l.id<? ORDER BY l.id DESC LIMIT ?').all(id, cursor, limit + 1);
      return { entries: rows.slice(0, limit).map((row) => ({ id: row.id, operationId: row.operation_id, operationPoints: row.operation_points || undefined, operationUnlimited: row.operation_unlimited === null ? undefined : Boolean(row.operation_unlimited), kind: row.kind, event: row.event, points: row.points, available: row.available, reserved: row.reserved, unlimited: Boolean(row.unlimited), reason: row.reason, createdAt: row.created_at })), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
    },
    unresolved(id, { cursor = Number.MAX_SAFE_INTEGER, limit = 30 } = {}) {
      requiredCode(id);
      creditInteger(cursor, '任务游标', 1, Number.MAX_SAFE_INTEGER); creditInteger(limit, '每页数量', 1, 100);
      const rows = db.prepare("SELECT rowid AS cursor,* FROM credit_operations WHERE code_id=? AND state='unknown' AND rowid<? ORDER BY rowid DESC LIMIT ?").all(id, cursor, limit + 1);
      return { operations: rows.slice(0, limit).map((op) => ({ ...publicCharge(op), requestId: op.request_id, createdAt: op.created_at, updatedAt: op.updated_at })), nextCursor: rows.length > limit ? rows[limit - 1].cursor : null };
    },
    resolve(id, input) {
      if (!['charge', 'refund'].includes(input.decision)) throw requestError('结算选项无效');
      const reason = creditText(input.reason, '核实原因', CREDIT_LIMITS.reason, true);
      return adminAction(input.requestId, `resolve:${id}`, { decision: input.decision, reason }, () => {
        const op = operation(id);
        if (!op || op.state !== 'unknown') throw creditError('此任务不再需要核实, 请刷新明细', 'VERSION_CONFLICT');
        return { charge: publicCharge(settle(id, input.decision === 'charge' ? 'charged' : 'refunded', { reason, manual: true })) };
      });
    },
    reserveBatch(jobs, session) {
      return transaction(() => {
        const row = authorized(session); const current = prices();
        const fresh = jobs.filter((job) => !byRequest(session.userId, job.requestId));
        for (const job of jobs) checkQuote(session, job.submission.creditQuote, fresh.includes(job));
        const total = fresh.length * current.image;
        if (!row.unlimited && row.points - row.reserved < total) throw creditError(`灵感点不足, 本次需要 ${total} 点, 当前可用 ${row.points - row.reserved} 点`, 'INSUFFICIENT_CREDITS', 402, { required: total, available: row.points - row.reserved });
        for (const job of jobs) {
          const op = reserve({ id: job.id, session, requestId: job.requestId, requestHash: job.requestHash, kind: 'image', quote: job.submission.creditQuote });
          if (op.id !== job.id) throw creditError('该请求已受理, 请通过原请求编号恢复任务', 'REQUEST_ALREADY_ACCEPTED');
          job.creditId = op.id; job.accessCodeId = op.code_id; job.codeEpoch = session.codeEpoch;
        }
      });
    },
    reserveText(input, session, hash) { return transaction(() => reserve({ id: `text_${randomUUID()}`, session, requestId: input.requestId, requestHash: hash, kind: input.kind, quote: input.creditQuote })); },
    settle(id, state, options) { return transaction(() => settle(id, state, options)); },
    resume(job, session, quote) {
      return transaction(() => {
        checkQuote(session, quote, false);
        const op = operation(job.creditId);
        if (!op || op.user_id !== session.userId || op.code_id !== session.accessCodeId || op.state !== 'refunded') throw creditError('任务无法恢复预占', 'CREDIT_STATE_CONFLICT');
        const row = authorized(session);
        const reserved = op.unlimited ? 0 : op.points;
        if (row.points - row.reserved < reserved) throw creditError(`灵感点不足, 恢复需要 ${op.points} 点, 当前可用 ${row.points - row.reserved} 点`, 'INSUFFICIENT_CREDITS', 402, { required: op.points, available: row.points - row.reserved });
        db.prepare('UPDATE access_codes SET reserved=reserved+? WHERE id=?').run(reserved, row.id);
        db.prepare("UPDATE credit_operations SET state='reserved',error='',updated_at=? WHERE id=?").run(Date.now(), op.id);
        ledger(code(row.id), 'reserve', -reserved, { ...op, reason: '恢复未执行任务, 沿用原额度模式' });
      });
    },
    reconcileJob(job) {
      if (!job.creditId) return;
      const op = operation(job.creditId);
      if (op && job.status === 'pending' && op.state === 'reserved' && op.request_hash !== job.requestHash) db.prepare('UPDATE credit_operations SET request_hash=? WHERE id=?').run(job.requestHash, job.creditId);
      if (job.status === 'running') settle(job.creditId, 'running');
      else if (job.status === 'succeeded' || job.status === 'expired') settle(job.creditId, 'charged');
      else if (['failed', 'interrupted', 'canceled'].includes(job.status)) settle(job.creditId, job.outcomeUnknown ? 'unknown' : 'refunded', { error: job.error || '' });
    },
    recoverText() {
      transaction(() => {
        for (const op of db.prepare("SELECT * FROM credit_operations WHERE kind!='image' AND state IN ('reserved','running')").all()) {
          const unknown = op.state === 'running';
          const error = unknown ? '服务重启前的文字处理结果未知, 占用点数待管理员核实. 不会自动重新调用' : '文字任务在发出前中断, 已返还占用点数';
          settle(op.id, unknown ? 'unknown' : 'refunded', { error, result: { status: unknown ? 409 : 503, unknown, body: { error, code: unknown ? 'OUTCOME_UNKNOWN' : 'TEXT_FAILED' } } });
        }
      });
    },
    pruneResults() { db.prepare("UPDATE credit_operations SET result=NULL WHERE result IS NOT NULL AND updated_at<?").run(Date.now() - 7 * 86400000); },
  };
}
