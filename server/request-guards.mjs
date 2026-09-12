import { requestError } from '../shared/generation-contract.mjs';

export function requireSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site') throw requestError('操作只允许从当前站点发起', 403);
  const value = req.headers.origin;
  if (!value) {
    // Non-browser clients have no Origin; browsers must not omit a cross-origin source.
    if (site && site !== 'same-origin' && site !== 'none') throw requestError('请求来源无效', 403);
    return;
  }
  try {
    const origin = new URL(value);
    const host = req.headers.host;
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value || typeof host !== 'string' || /[\s/\\?#@]/.test(host)) throw new Error();
    // Use the preserved Host, never a client-supplied forwarding header.
    if (origin.origin !== new URL(`${origin.protocol}//${host}`).origin) throw new Error();
  } catch {
    throw requestError('操作来源与当前站点不匹配', 403);
  }
}

function limited(message, seconds) {
  return Object.assign(requestError(message, 429), { retryAfterSeconds: Math.max(1, Math.ceil(seconds)) });
}

export function createWindowLimiter({ limit, windowMs, maxKeys = 2048, now = Date.now }) {
  const entries = new Map();
  function check(key, message) {
    const time = now();
    if (entries.get(key)?.until <= time) entries.delete(key);
    if (entries.size >= maxKeys && !entries.has(key)) {
      for (const [id, item] of entries) if (item.until <= time) entries.delete(id);
      if (entries.size >= maxKeys) throw limited(message, windowMs / 1000);
    }
    const item = entries.get(key);
    if (item && item.count >= limit) throw limited(message, (item.until - time) / 1000);
  }
  return {
    check,
    take(key, message) {
      check(key, message);
      const item = entries.get(key) || { count: 0, until: now() + windowMs };
      item.count++;
      entries.set(key, item);
    },
    reset(key) { entries.delete(key); },
    clear() { entries.clear(); },
  };
}

export function createLoginLimiter() {
  return createWindowLimiter({ limit: 8, windowMs: 10 * 60 * 1000 });
}

export function createTextLimiter({ now = Date.now } = {}) {
  const activeUsers = new Set();
  const userRate = createWindowLimiter({ limit: 10, windowMs: 60000, now });
  const globalRate = createWindowLimiter({ limit: 30, windowMs: 60000, now });
  return {
    acquire(userId) {
      if (activeUsers.has(userId)) throw limited('当前文字任务正在处理, 请等待完成后再试', 1);
      if (activeUsers.size >= 2) throw limited('文字服务正忙, 请稍后重试', 1);
      const message = '文字请求过于频繁, 请稍后重试';
      userRate.check(userId, message);
      globalRate.check('all', message);
      userRate.take(userId, message);
      globalRate.take('all', message);
      activeUsers.add(userId);
      let released = false;
      return () => {
        if (!released) activeUsers.delete(userId);
        released = true;
      };
    },
  };
}
