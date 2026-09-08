import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readLocalConfig } from './config.mjs';
import { json, logLine, readRequestBody } from './http.mjs';
import { requestError } from '../shared/generation-contract.mjs';
let stateStore;
let cookieName = 'img_auth_max';
export function initAuth(store, namespace = '') { stateStore = store; cookieName = 'img_auth_max' + (namespace ? '_' + namespace : ''); }

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = new Map();
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    try { cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())); } catch { throw requestError('Cookie 编码无效'); }
  });
  return cookies;
}

function safeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function authCookieOptions(config, maxAgeSeconds) {
  return [
    `${cookieName}=${maxAgeSeconds ? '{{token}}' : ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    config.secureCookies ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function sessionTokenFromRequest(req) {
  return parseCookies(req).get(cookieName) || '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUserId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function sessionFromRequest(req) {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  const session = stateStore.getSession(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    stateStore.deleteSession(token);
    return null;
  }
  return session;
}

function isAuthenticated(req) {
  return sessionFromRequest(req) !== null;
}

function createAuthSession(config, userId) {
  const token = randomBytes(32).toString('base64url');
  const maxAgeSeconds = Math.round(config.authSessionDays * 24 * 60 * 60);
  stateStore.createSession(token, {
    userId: String(userId || ''),
    createdAt: Date.now(),
    expiresAt: Date.now() + maxAgeSeconds * 1000,
  });
  return {
    token,
    cookie: authCookieOptions(config, maxAgeSeconds).replace('{{token}}', encodeURIComponent(token)),
  };
}

function clearAuthSession(req, config) {
  const token = sessionTokenFromRequest(req);
  if (token) stateStore.deleteSession(token);
  return authCookieOptions(config, 0).replace('{{token}}', '');
}

export async function handleAuthStatus(req, res) {
  const config = await readLocalConfig();
  const session = sessionFromRequest(req);
  json(res, 200, {
    required: Boolean(config.accessPassword),
    authenticated: session !== null,
    userId: session?.userId || '',
  });
}

export async function handleAuthLogin(req, res) {
  const config = await readLocalConfig();
  let payload = {};
  try {
    payload = JSON.parse((await readRequestBody(req, 16 * 1024)).toString('utf8') || '{}');
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 400;
    json(res, statusCode, { error: statusCode === 400 ? '请求体不是有效 JSON' : error.message || String(error) });
    return;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json(res, 400, { error: '登录请求必须是 JSON 对象' });
  const userId = String(payload.userId || '').trim();
  if (!isValidUserId(userId)) {
    json(res, 400, { error: '缺少或无效的 userId (应为 UUID 形式)' });
    return;
  }
  if (!config.accessPassword) {
    const session = createAuthSession(config, userId);
    json(res, 200, { ok: true, required: false, userId }, { 'Set-Cookie': session.cookie });
    return;
  }
  if (!safeEqualString(payload.password || '', config.accessPassword)) {
    logLine('WARN', `auth login failed from ${req.socket.remoteAddress || 'unknown'}`);
    json(res, 401, { error: '访问密码错误' });
    return;
  }
  const session = createAuthSession(config, userId);
  logLine('INFO', `auth login success user=${userId} from ${req.socket.remoteAddress || 'unknown'}`);
  json(res, 200, { ok: true, required: true, userId }, { 'Set-Cookie': session.cookie });
}

export async function handleAuthLogout(req, res) {
  const config = await readLocalConfig();
  json(res, 200, { ok: true }, { 'Set-Cookie': clearAuthSession(req, config) });
}

export async function requireApiAuth(req, res) {
  if (sessionFromRequest(req)) return true;
  const config = await readLocalConfig();
  json(res, 401, {
    error: '请先登录',
    authRequired: true,
    passwordRequired: Boolean(config.accessPassword),
  });
  return false;
}
