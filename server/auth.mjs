import { readLocalConfig } from './config.mjs';
import { json, readJson } from './http.mjs';
import { requestError } from '../shared/generation-contract.mjs';
import { createLoginLimiter } from './request-guards.mjs';

let stateStore;
let cookieName = 'img_auth_max';
let browserCookieName = 'sprout_browser';
const loginFailures = createLoginLimiter();
const authorizedRequests = new WeakMap();

export function initAuth(store, namespace = '') {
  stateStore = store;
  cookieName = 'img_auth_max' + (namespace ? '_' + namespace : '');
  browserCookieName = 'sprout_browser' + (namespace ? '_' + namespace : '');
  loginFailures.clear();
}
function cookies(req) {
  const values = new Map();
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    try { values.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())); }
    catch { throw requestError('Cookie 编码无效'); }
  }
  return values;
}
function cookie(name, value, maxAge, config) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? '; Secure' : ''}`;
}
export function sessionFromRequest(req) {
  return authorizedRequests.get(req) || stateStore.identities.session(cookies(req).get(cookieName));
}
function status(session) {
  return {
    required: true, authenticated: Boolean(session), userId: session?.userId || '',
    accessCodeId: session?.accessCodeId || '', accessName: session?.accessName || '', canGenerate: Boolean(session?.canGenerate),
    credits: session ? stateStore.credits.balance(session.accessCodeId) : null,
    prices: session ? stateStore.credits.prices() : null,
  };
}
export async function handleAuthStatus(req, res) { json(res, 200, status(sessionFromRequest(req))); }
export async function handleAuthLogin(req, res) {
  const address = req.socket.remoteAddress || 'local';
  const message = '尝试次数过多, 请 10 分钟后重试';
  loginFailures.check(address, message);
  let input;
  try {
    input = await readJson(req, 16 * 1024);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'code')) throw requestError('请使用访问码登录');
  } catch (error) { loginFailures.take(address, message); throw error; }
  const config = await readLocalConfig();
  const values = cookies(req);
  let created;
  try {
    created = stateStore.identities.login(typeof input.code === 'string' ? input.code.trim() : input.code, {
      browserToken: values.get(browserCookieName), previousToken: values.get(cookieName), sessionDays: config.authSessionDays,
    });
  } catch (error) { if (error.statusCode === 401) loginFailures.take(address, message); throw error; }
  loginFailures.reset(address);
  json(res, 200, { ok: true, ...status(created.session) }, { 'Set-Cookie': [cookie(cookieName, created.token, created.maxAge, config), cookie(browserCookieName, created.browserToken, created.browserMaxAge, config)] });
}
export async function handleAuthLogout(req, res) {
  stateStore.identities.logout(cookies(req).get(cookieName));
  json(res, 200, { ok: true }, { 'Set-Cookie': cookie(cookieName, '', 0, await readLocalConfig()) });
}
export async function requireApiAuth(req, res) {
  const session = sessionFromRequest(req);
  if (!session) { json(res, 401, { error: '请先使用访问码登录', authRequired: true }); return false; }
  // Revocation stops new work but retains the original browser's result retrieval capability.
  if (!session.canGenerate && !['GET', 'HEAD'].includes(req.method) && !/^\/api\/jobs\/[A-Za-z0-9_-]+\/ack$/.test((req.url || '').split('?')[0])) {
    json(res, 403, { error: '访问码已停用或重置, 请更换访问码后继续', code: 'ACCESS_CODE_UNAVAILABLE' }); return false;
  }
  authorizedRequests.set(req, session);
  return true;
}
