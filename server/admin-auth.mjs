import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { requestError } from '../shared/generation-contract.mjs';

const SESSION_SECONDS = 12 * 60 * 60;
const digest = (value) => createHash('sha256').update(String(value)).digest();

export function createAdminAuth(store, namespace = '') {
  const name = 'sprout_admin' + (namespace ? '_' + namespace : '');
  const attempts = new Map();
  function token(req) {
    const value = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1) || '';
    return /^[a-zA-Z0-9_-]{43}$/.test(value) ? value : '';
  }
  function cookie(value, config) {
    return `${name}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${value ? SESSION_SECONDS : 0}${config.secureCookies ? '; Secure' : ''}`;
  }
  function sameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') throw requestError('管理操作只允许从当前站点发起', 403);
    if (req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { throw requestError('请求来源无效', 403); }
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw requestError('管理操作来源不匹配', 403);
    }
  }
  function authenticated(req, config) { return Boolean(config.adminPassword && token(req) && store.adminSession(token(req), config.adminPassword)); }
  return {
    status(req, config) { return { configured: Boolean(config.adminPassword), authenticated: authenticated(req, config) }; },
    require(req, config) {
      if (!config.adminPassword) throw requestError('管理员入口尚未启用', 503);
      if (!authenticated(req, config)) throw requestError('请先登录管理后台', 401);
      if (!['GET', 'HEAD'].includes(req.method)) sameOrigin(req);
    },
    login(req, config, password) {
      sameOrigin(req);
      if (!config.adminPassword) throw requestError('管理员入口尚未启用', 503);
      const now = Date.now();
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
      const address = req.socket.remoteAddress || 'local';
      const prior = attempts.get(address);
      if ((prior?.count || 0) >= 8) throw requestError('尝试次数过多, 请 10 分钟后重试', 429);
      if (typeof password !== 'string' || password.length > 256 || !timingSafeEqual(digest(password), digest(config.adminPassword))) {
        attempts.set(address, { count: (prior?.count || 0) + 1, until: prior?.until || now + 600000 });
        throw requestError('管理员密码不正确', 401);
      }
      attempts.delete(address);
      if (token(req)) store.deleteAdminSession(token(req));
      const value = randomBytes(32).toString('base64url');
      store.createAdminSession(value, config.adminPassword, now + SESSION_SECONDS * 1000);
      return cookie(value, config);
    },
    logout(req, config) {
      sameOrigin(req);
      if (token(req)) store.deleteAdminSession(token(req));
      return cookie('', config);
    },
  };
}
