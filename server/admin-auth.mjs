import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { requestError } from '../shared/generation-contract.mjs';
import { createLoginLimiter, requireSameOrigin } from './request-guards.mjs';

const SESSION_SECONDS = 12 * 60 * 60;
const digest = (value) => createHash('sha256').update(String(value)).digest();

export function createAdminAuth(store, namespace = '') {
  const name = 'sprout_admin' + (namespace ? '_' + namespace : '');
  const attempts = createLoginLimiter();
  function token(req) {
    const value = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1) || '';
    return /^[a-zA-Z0-9_-]{43}$/.test(value) ? value : '';
  }
  function cookie(value, config) {
    return `${name}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${value ? SESSION_SECONDS : 0}${config.secureCookies ? '; Secure' : ''}`;
  }
  function authenticated(req, config) { return Boolean(config.adminPassword && token(req) && store.adminSession(token(req), config.adminPassword)); }
  return {
    status(req, config) { return { configured: Boolean(config.adminPassword), authenticated: authenticated(req, config) }; },
    require(req, config) {
      if (!config.adminPassword) throw requestError('管理员入口尚未启用', 503);
      if (!authenticated(req, config)) throw requestError('请先登录管理后台', 401);
      if (!['GET', 'HEAD'].includes(req.method)) requireSameOrigin(req);
    },
    login(req, config, password) {
      requireSameOrigin(req);
      if (!config.adminPassword) throw requestError('管理员入口尚未启用', 503);
      const address = req.socket.remoteAddress || 'local';
      const message = '尝试次数过多, 请 10 分钟后重试';
      attempts.check(address, message);
      if (typeof password !== 'string' || password.length > 256 || !timingSafeEqual(digest(password), digest(config.adminPassword))) {
        attempts.take(address, message);
        throw requestError('管理员密码不正确', 401);
      }
      attempts.reset(address);
      if (token(req)) store.deleteAdminSession(token(req));
      const value = randomBytes(32).toString('base64url');
      store.createAdminSession(value, config.adminPassword, Date.now() + SESSION_SECONDS * 1000);
      return cookie(value, config);
    },
    logout(req, config) {
      requireSameOrigin(req);
      if (token(req)) store.deleteAdminSession(token(req));
      return cookie('', config);
    },
  };
}
