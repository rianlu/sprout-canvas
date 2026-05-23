import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as queue from './server/queue.mjs';
import { rankedTextProviders, recordTextProviderFailure, recordTextProviderSuccess } from './server/text-routing.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __dirname;
const LOCAL_CONFIG_PATH = path.join(ROOT, 'config', 'local.config.json');
const DEFAULT_MAX_REQUEST_BYTES = 80 * 1024 * 1024;
const TEXT_UPSTREAM_TIMEOUT_MS = 60_000;
const IMAGE_UPSTREAM_TIMEOUT_MS = 180_000;
const RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS = 420_000;
const authSessions = new Map();

function timeoutSignal(ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  timer.unref?.();
  return ac.signal;
}

function isTimeoutError(error) {
  return error?.name === 'AbortError' || /aborted|timeout|timed out/i.test(error?.message || String(error));
}
let shuttingDown = false;

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(data));
}

function setBaseHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if ((req.url || '').startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
}

function logLine(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  const writer = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  writer(line);
  const target = globalThis.__LOG_FILE__;
  if (!target) return;
  mkdir(path.dirname(target), { recursive: true })
    .then(() => appendFile(target, `${line}\n`))
    .catch(() => {});
}

function normalizeBaseUrl(input) {
  let base = String(input || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('baseUrl 不能为空');
  if (base.endsWith('/v1')) base = base.slice(0, -3);
  if (!/^https?:\/\//i.test(base)) throw new Error('baseUrl 必须以 http:// 或 https:// 开头');
  return base;
}

function normalizeProviderId(input, fallback) {
  const raw = String(input || fallback || '').trim();
  const id = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || fallback;
}

function normalizeImageProvider(provider, index) {
  const id = normalizeProviderId(provider.id || provider.name, `image-provider-${index + 1}`);
  const name = String(provider.name || provider.id || `生图服务商 ${index + 1}`).trim();
  const config = {
    id,
    name,
    baseUrl: normalizeBaseUrl(provider.baseUrl || 'https://api.openai.com'),
    apiKey: String(provider.apiKey || '').trim(),
    imageModel: String(provider.imageModel || provider.model || 'gpt-image-2').trim(),
    generationMode: String(provider.generationMode || 'images').trim(),
    requestHeaders: provider.requestHeaders && typeof provider.requestHeaders === 'object' ? provider.requestHeaders : {},
  };
  if (!config.apiKey) throw new Error(`生图服务商 ${name} 缺少 apiKey. 请检查 ${path.relative(ROOT, LOCAL_CONFIG_PATH)}`);
  if (!['images', 'responses'].includes(config.generationMode)) throw new Error(`生图服务商 ${name} 的 generationMode 只能是 images 或 responses`);
  return config;
}

function normalizeTextProvider(provider = {}) {
  const id = normalizeProviderId(provider.id || provider.name, 'text');
  const name = String(provider.name || provider.id || '文本服务商').trim();
  const config = {
    id,
    name,
    baseUrl: normalizeBaseUrl(provider.baseUrl || 'https://api.openai.com'),
    apiKey: String(provider.apiKey || '').trim(),
    textModel: String(provider.textModel || provider.model || 'gpt-5-mini').trim(),
    requestHeaders: provider.requestHeaders && typeof provider.requestHeaders === 'object' ? provider.requestHeaders : {},
  };
  if (!config.apiKey) throw new Error(`文本服务商 ${name} 缺少 apiKey. 请检查 ${path.relative(ROOT, LOCAL_CONFIG_PATH)}`);
  if (!config.textModel) throw new Error(`文本服务商 ${name} 缺少 model/textModel. 请检查 ${path.relative(ROOT, LOCAL_CONFIG_PATH)}`);
  return config;
}

function normalizeLegacyProvider(provider, index) {
  return normalizeImageProvider(provider, index);
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function isPlaceholderSecret(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text || text.includes('change-this') || text.includes('your-') || text.includes('example');
}

function validateProductionConfig(config) {
  if (!isProduction()) return;
  if (isPlaceholderSecret(config.accessPassword) || config.accessPassword.length < 10) {
    throw new Error('生产环境必须在 config/local.config.json 设置至少 10 位的 accessPassword');
  }
  const placeholderTextProvider = config.textProviders.find((provider) => isPlaceholderSecret(provider.apiKey));
  if (placeholderTextProvider) {
    throw new Error(`生产环境文本服务商 ${placeholderTextProvider.name} 仍使用占位 API Key`);
  }
  const placeholderProvider = config.imageProviders.find((provider) => isPlaceholderSecret(provider.apiKey));
  if (placeholderProvider) {
    throw new Error(`生产环境生图服务商 ${placeholderProvider.name} 仍使用占位 API Key`);
  }
}

function providerIdFromRequest(req) {
  const raw = req.headers['x-provider-id'];
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = new Map();
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
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
    `img_auth_max=${maxAgeSeconds ? '{{token}}' : ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    config.secureCookies ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function sessionTokenFromRequest(req) {
  return parseCookies(req).get('img_auth_max') || '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUserId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function sessionFromRequest(req) {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token);
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
  authSessions.set(token, {
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
  if (token) authSessions.delete(token);
  return authCookieOptions(config, 0).replace('{{token}}', '');
}

async function handleAuthStatus(req, res) {
  const config = await readLocalConfig();
  const session = sessionFromRequest(req);
  json(res, 200, {
    required: Boolean(config.accessPassword),
    authenticated: !config.accessPassword || session !== null,
    userId: session?.userId || '',
  });
}

async function handleHealth(req, res, detailed = false) {
  if (!detailed) {
    json(res, 200, { ok: true, uptimeSec: Math.round(process.uptime()) });
    return;
  }
  try {
    const config = await readLocalConfig();
    json(res, 200, {
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      providerCount: config.providers.length,
      imageConcurrency: config.imageConcurrency,
      authRequired: Boolean(config.accessPassword),
    });
  } catch (error) {
    json(res, 503, { ok: false, error: error.message || String(error) });
  }
}

async function handleAuthLogin(req, res) {
  const config = await readLocalConfig();
  let payload = {};
  try {
    payload = JSON.parse((await readRequestBody(req)).toString('utf8') || '{}');
  } catch {
    json(res, 400, { error: '请求体不是有效 JSON' });
    return;
  }
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

async function handleAuthLogout(req, res) {
  const config = await readLocalConfig();
  json(res, 200, { ok: true }, { 'Set-Cookie': clearAuthSession(req, config) });
}

async function requireApiAuth(req, res) {
  if (sessionFromRequest(req)) return true;
  const config = await readLocalConfig();
  json(res, 401, {
    error: '请先登录',
    authRequired: true,
    passwordRequired: Boolean(config.accessPassword),
  });
  return false;
}

async function readLocalConfig(providerId) {
  let fileConfig = {};
  if (existsSync(LOCAL_CONFIG_PATH)) {
    fileConfig = JSON.parse(await readFile(LOCAL_CONFIG_PATH, 'utf8'));
  }

  const legacyProviders = Array.isArray(fileConfig.providers) ? fileConfig.providers.filter(Boolean) : [];
  const fileImageProviders = Array.isArray(fileConfig.imageProviders) ? fileConfig.imageProviders.filter(Boolean) : [];
  const envApiKey = process.env.OPENAI_API_KEY || process.env.ANYROUTER_API_KEY;
  const imageProviders = fileImageProviders.length
    ? fileImageProviders.map(normalizeImageProvider)
    : legacyProviders.length
      ? legacyProviders.map(normalizeLegacyProvider)
      : [normalizeImageProvider({
        id: fileConfig.providerId || 'default',
        name: fileConfig.providerName || '默认生图服务商',
        baseUrl: process.env.OPENAI_BASE_URL || process.env.ANYROUTER_BASE_URL || fileConfig.baseUrl || 'https://api.openai.com',
        apiKey: envApiKey || fileConfig.apiKey || '',
        imageModel: process.env.IMAGE_MODEL || fileConfig.imageModel || 'gpt-image-2',
        generationMode: process.env.GENERATION_MODE || fileConfig.generationMode || 'images',
      }, 0)];

  const legacyTextProvider = legacyProviders.find((provider) => String(provider.textModel || '').trim()) || legacyProviders[0] || {};
  const primaryTextProvider = {
    id: fileConfig.textProvider?.id || fileConfig.textProviderId || legacyTextProvider.id || 'text',
    name: fileConfig.textProvider?.name || fileConfig.textProviderName || legacyTextProvider.name || '文本服务商',
    baseUrl: process.env.TEXT_BASE_URL || fileConfig.textProvider?.baseUrl || process.env.OPENAI_BASE_URL || fileConfig.textBaseUrl || legacyTextProvider.baseUrl || fileConfig.baseUrl || 'https://api.openai.com',
    apiKey: process.env.TEXT_API_KEY || fileConfig.textProvider?.apiKey || envApiKey || fileConfig.textApiKey || legacyTextProvider.apiKey || fileConfig.apiKey || '',
    textModel: process.env.TEXT_MODEL || fileConfig.textProvider?.model || fileConfig.textProvider?.textModel || fileConfig.textModel || legacyTextProvider.textModel || 'gpt-5-mini',
    requestHeaders: fileConfig.textProvider?.requestHeaders || legacyTextProvider.requestHeaders || {},
  };
  const configuredTextProviders = Array.isArray(fileConfig.textProviders) ? fileConfig.textProviders.filter(Boolean) : [];
  const rawTextProviders = configuredTextProviders.length ? configuredTextProviders : [primaryTextProvider];
  const textProviders = rawTextProviders.map((provider, index) => normalizeTextProvider({
    ...provider,
    id: provider.id || (index === 0 ? primaryTextProvider.id : `text-${index + 1}`),
    name: provider.name || (index === 0 ? primaryTextProvider.name : `文本服务商 ${index + 1}`),
    baseUrl: provider.baseUrl || primaryTextProvider.baseUrl,
    apiKey: provider.apiKey || primaryTextProvider.apiKey,
    textModel: provider.textModel || provider.model || primaryTextProvider.textModel,
    requestHeaders: provider.requestHeaders || {},
  }));
  const textProvider = textProviders[0];

  const defaultImageProvider = normalizeProviderId(process.env.DEFAULT_IMAGE_PROVIDER || process.env.DEFAULT_PROVIDER || fileConfig.defaultImageProvider || fileConfig.defaultProvider || imageProviders[0].id, imageProviders[0].id);
  const requestedProvider = normalizeProviderId(providerId || defaultImageProvider, defaultImageProvider);
  const activeProvider = imageProviders.find((provider) => provider.id === requestedProvider);
  if (!activeProvider) throw new Error(`生图服务商不存在: ${requestedProvider}. 请检查 config/local.config.json 的 imageProviders 配置`);

  const config = {
    ...activeProvider,
    providers: imageProviders,
    imageProviders,
    textProvider,
    textProviders,
    textModel: textProvider.textModel,
    defaultProvider: defaultImageProvider,
    defaultImageProvider,
    host: String(process.env.HOST || fileConfig.host || '127.0.0.1').trim(),
    port: Number(process.env.PORT || fileConfig.port || 8787),
    imageConcurrency: Math.max(1, Number(process.env.IMAGE_CONCURRENCY || fileConfig.imageConcurrency || 1)),
    accessPassword: String(process.env.ACCESS_PASSWORD || fileConfig.accessPassword || '').trim(),
    authSessionDays: Math.max(1, Number(process.env.AUTH_SESSION_DAYS || fileConfig.authSessionDays || 7)),
    secureCookies: process.env.SECURE_COOKIES === '1' || fileConfig.secureCookies === true,
    logFile: String(process.env.LOG_FILE || fileConfig.logFile || path.join(ROOT, 'logs', 'server.log')).trim(),
  };
  validateProductionConfig(config);
  return config;
}

function publicConfig(config) {
  return {
    baseUrl: '/api',
    activeProvider: config.id,
    defaultProvider: config.defaultImageProvider,
    defaultImageProvider: config.defaultImageProvider,
    keyConfigured: Boolean(config.apiKey),
    textModel: config.textModel,
    textProviderName: config.textProvider.name,
    textProviderCount: config.textProviders.length,
    imageModel: config.imageModel,
    generationMode: config.generationMode,
    imageConcurrency: config.imageConcurrency,
    autoProviderRouting: true,
    providerCount: config.imageProviders.length,
    imageProviderCount: config.imageProviders.length,
    providers: config.imageProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      imageModel: provider.imageModel,
      generationMode: provider.generationMode,
      textModel: config.textModel,
    })),
  };
}

async function readRequestBody(req, maxBytes = DEFAULT_MAX_REQUEST_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      const error = new Error(`请求体超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 限制`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function resolveHeaderValue(value) {
  return String(value)
    .replaceAll('{{timestamp}}', String(Date.now()))
    .replaceAll('{{sessionId}}', `browser-${Date.now()}`);
}

function upstreamHeaders(config, contentType) {
  const headers = { Authorization: `Bearer ${config.apiKey}` };
  for (const [key, value] of Object.entries(config.requestHeaders || {})) {
    if (value === null || value === undefined) continue;
    headers[key] = resolveHeaderValue(value);
  }
  headers.Authorization = `Bearer ${config.apiKey}`;
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

async function pipeUpstream(res, upstream) {
  const headers = {
    'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
  };
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  res.writeHead(upstream.status, headers);
  if (!upstream.body) {
    res.end(await upstream.text());
    return;
  }
  try {
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (error) {
    res.destroy(error);
  }
}

function stripHtml(input) {
  return String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readUpstreamError(upstream) {
  const contentType = upstream.headers.get('content-type') || '';
  const body = await upstream.text().catch(() => '');
  const cleaned = contentType.includes('html') || /^\s*</.test(body) ? stripHtml(body) : body.trim();
  const shortText = cleaned.slice(0, 360) || upstream.statusText || '无错误正文';
  return `上游 API 返回 HTTP ${upstream.status}: ${shortText}`;
}

function extractResponsesText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  if (Array.isArray(data?.output)) {
    for (const output of data.output) {
      if (Array.isArray(output?.content)) {
        for (const item of output.content) {
          if (typeof item?.text === 'string' && item.text.trim()) return item.text.trim();
        }
      }
    }
  }
  return '';
}

function sanitizeTextOutput(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();
}

function extractChatText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return sanitizeTextOutput(content);
  if (Array.isArray(content)) {
    return sanitizeTextOutput(content.map((item) => item?.text || '').join(''));
  }
  return '';
}

function inputItemToText(item) {
  if (typeof item?.content === 'string') return item.content;
  if (!Array.isArray(item?.content)) return '';
  return item.content
    .map((part) => part?.text || part?.input_text || '')
    .filter(Boolean)
    .join('\n');
}

function responsesPayloadToChatPayload(payload, config) {
  const messages = Array.isArray(payload?.input)
    ? payload.input.map((item) => ({ role: item.role || 'user', content: inputItemToText(item) })).filter((item) => item.content)
    : [{ role: 'user', content: String(payload?.input || '') }];
  return {
    model: payload?.model || config.textModel,
    messages,
    stream: false,
  };
}

async function callJsonUpstream(config, upstreamPath, payload) {
  try {
    const upstream = await fetch(`${config.baseUrl}${upstreamPath}`, {
      method: 'POST',
      headers: upstreamHeaders(config, 'application/json'),
      body: JSON.stringify(payload),
      signal: timeoutSignal(TEXT_UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok) throw new Error(await readUpstreamError(upstream));
    return upstream.json();
  } catch (error) {
    if (isTimeoutError(error)) {
      const timeoutError = new Error(`文本上游 ${Math.round(TEXT_UPSTREAM_TIMEOUT_MS / 1000)}s 内未响应, 已切换备用服务商`);
      timeoutError.isTextTimeout = true;
      throw timeoutError;
    }
    throw error;
  }
}

async function handleTextGeneration(req, res) {
  let config;
  try {
    config = await readLocalConfig();
  } catch (error) {
    json(res, 500, { error: error.message });
    return;
  }
  let payload;
  try {
    payload = JSON.parse((await readRequestBody(req)).toString('utf8') || '{}');
  } catch {
    json(res, 400, { error: '请求体不是有效 JSON' });
    return;
  }
  const errors = [];
  const attempts = [];
  const textProviders = rankedTextProviders(config.textProviders);
  if (!textProviders.length) {
    json(res, 503, { error: '没有健康的文本服务商', attempts });
    return;
  }
  for (const textProvider of textProviders) {
    const model = textProvider.textModel;
    try {
      const chatPayload = responsesPayloadToChatPayload({ ...payload, model }, textProvider);
      const data = await callJsonUpstream(textProvider, '/v1/chat/completions', chatPayload);
      const text = extractChatText(data);
      if (!text) throw new Error('Chat Completions API 未返回文本内容');
      recordTextProviderSuccess(textProvider.id);
      if (errors.length) logLine('INFO', `[text-provider] fallback success provider=${textProvider.name} mode=chat_completions`);
      json(res, 200, { text, provider: 'chat_completions', providerName: textProvider.name, attempts });
      return;
    } catch (error) {
      const message = error.message || String(error);
      errors.push(`${textProvider.name} Chat Completions: ${message}`);
      attempts.push({ providerName: textProvider.name, mode: 'chat_completions', timeout: Boolean(error.isTextTimeout), error: message.slice(0, 180) });
      logLine('WARN', `[text-provider] failed provider=${textProvider.name} mode=chat_completions error=${message.slice(0, 240)}`);
      recordTextProviderFailure(textProvider.id, message, logLine);
    }
  }
  json(res, 502, { error: errors.join(' | '), attempts });
}

async function proxyRequest(req, res, upstreamPath) {
  let config;
  try {
    config = await readLocalConfig(providerIdFromRequest(req));
  } catch (error) {
    json(res, 500, { error: error.message });
    return;
  }
  try {
    const body = req.method === 'GET' ? undefined : await readRequestBody(req);
    const contentType = req.headers['content-type'];
    const upstream = await fetch(`${config.baseUrl}${upstreamPath}`, {
      method: req.method,
      headers: upstreamHeaders(config, contentType),
      body,
      signal: timeoutSignal(TEXT_UPSTREAM_TIMEOUT_MS),
    });
    await pipeUpstream(res, upstream);
  } catch (error) {
    json(res, 502, { error: `上游请求失败: ${error.message || error}` });
  }
}


queue.init({
  readLocalConfig,
  upstreamHeaders,
  timeoutSignal,
  stripHtml,
  logLine,
  IMAGE_UPSTREAM_TIMEOUT_MS,
  RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS,
});

function decodeClientContextHeader(req) {
  const raw = req.headers['x-client-context'];
  if (!raw) return null;
  try {
    const decoded = Buffer.from(String(raw), 'base64').toString('utf8');
    return decoded ? JSON.parse(decoded) : null;
  } catch {
    return null;
  }
}

async function handleQueuedImageJob(req, res, upstreamPath) {
  const session = sessionFromRequest(req);
  if (!session) {
    json(res, 401, { error: '请先登录', authRequired: true });
    return;
  }
  let config;
  try {
    config = await readLocalConfig(providerIdFromRequest(req));
  } catch (error) {
    json(res, 500, { error: error.message });
    return;
  }
  const contentType = req.headers['content-type'] || '';
  const rawBody = await readRequestBody(req);
  const autoProviderRouting = !providerIdFromRequest(req);
  const excludeProviderId = String(req.headers['x-exclude-provider-id'] || '').trim();
  const clientContext = decodeClientContextHeader(req);
  let selectedProvider;
  try {
    selectedProvider = autoProviderRouting
      ? queue.chooseImageProvider(config, upstreamPath, contentType, excludeProviderId, rawBody)
      : config;
    if (!autoProviderRouting && !queue.providerSupportsRequest(selectedProvider, upstreamPath, contentType, rawBody)) {
      json(res, 400, { error: `服务商 ${selectedProvider.name} 不支持当前请求类型` });
      return;
    }
  } catch (error) {
    json(res, 400, { error: error.message || String(error) });
    return;
  }
  const body = queue.rewriteImageJobBody(selectedProvider, rawBody, contentType);
  const job = {
    id: queue.nextJobId(),
    userId: session.userId,
    status: 'pending',
    method: 'POST',
    upstreamPath,
    contentType,
    body,
    originalBody: rawBody,
    autoProviderRouting,
    excludeProviderId,
    clientContext,
    queuedAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
    error: '',
    result: null,
    providerId: selectedProvider.id,
    providerName: selectedProvider.name,
  };
  json(res, 202, queue.enqueue(job));
}

function handleJobStatus(req, res, jobId) {
  const session = sessionFromRequest(req);
  if (!session) {
    json(res, 401, { error: '请先登录', authRequired: true });
    return;
  }
  const status = queue.getJobStatus(jobId, session.userId);
  if (!status) {
    json(res, 404, { error: '任务不存在或已过期' });
    return;
  }
  json(res, 200, status);
}

function handleJobResult(req, res, jobId) {
  const session = sessionFromRequest(req);
  if (!session) {
    json(res, 401, { error: '请先登录', authRequired: true });
    return;
  }
  const outcome = queue.getJobResult(jobId, session.userId);
  if (outcome.kind === 'missing') {
    json(res, 404, { error: '任务不存在或已过期' });
    return;
  }
  if (outcome.kind === 'progress') {
    json(res, 202, outcome.job);
    return;
  }
  const headers = { 'Content-Type': outcome.contentType };
  if (outcome.cacheControl) headers['Cache-Control'] = outcome.cacheControl;
  res.writeHead(outcome.status, headers);
  res.end(outcome.body);
}

function handleListMyJobs(req, res) {
  const session = sessionFromRequest(req);
  if (!session) {
    json(res, 401, { error: '请先登录', authRequired: true });
    return;
  }
  json(res, 200, queue.getJobsForUser(session.userId));
}

function handleCancelJob(req, res, jobId) {
  const session = sessionFromRequest(req);
  if (!session) {
    json(res, 401, { error: '请先登录', authRequired: true });
    return;
  }
  const result = queue.cancel(jobId, session.userId);
  if (!result.ok) {
    json(res, result.status || 400, { error: result.error });
    return;
  }
  json(res, 200, { ok: true, job: result.job });
}

function handleRetryJob(req, res, jobId) {
  const session = sessionFromRequest(req);
  if (!session) {
    json(res, 401, { error: '请先登录', authRequired: true });
    return;
  }
  const result = queue.retryFailedJob(jobId, session.userId);
  if (!result.ok) {
    json(res, result.status || 400, { error: result.error });
    return;
  }
  json(res, 202, { ok: true, job: result.job });
}

async function serveStatic(req, res, pathname) {
  const cleanPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  if (cleanPath.startsWith('/config/') || cleanPath.includes('/.') || path.basename(cleanPath).startsWith('.')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const distRoot = path.join(ROOT, 'dist');
  const staticRoot = existsSync(path.join(distRoot, 'index.html')) ? distRoot : ROOT;
  let filePath = path.resolve(staticRoot, `.${cleanPath}`);
  if (!filePath.startsWith(staticRoot)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES.get(path.extname(filePath)) || 'application/octet-stream' });
    res.end(data);
  } catch {
    if (staticRoot === distRoot && !path.extname(cleanPath)) {
      const data = await readFile(path.join(distRoot, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  setBaseHeaders(req, res);
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/health' && req.method === 'GET') return handleHealth(req, res);
    if (url.pathname === '/ready' && req.method === 'GET') return handleHealth(req, res, true);
    if (shuttingDown) return json(res, 503, { error: '服务正在重启, 请稍后重试' });
    if (url.pathname === '/api/auth/status' && req.method === 'GET') return handleAuthStatus(req, res);
    if (url.pathname === '/api/auth/login' && req.method === 'POST') return handleAuthLogin(req, res);
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') return handleAuthLogout(req, res);
    if (url.pathname.startsWith('/api/') && !(await requireApiAuth(req, res))) return;
    if (url.pathname === '/api/config' && req.method === 'GET') {
      try {
        const config = await readLocalConfig();
        json(res, 200, publicConfig(config));
      } catch (error) {
        json(res, 500, { error: error.message, baseUrl: '/api', keyConfigured: false });
      }
      return;
    }
    if (url.pathname === '/api/models' && req.method === 'GET') return proxyRequest(req, res, '/v1/models');
    if (url.pathname === '/api/text' && req.method === 'POST') return handleTextGeneration(req, res);
    if (url.pathname === '/api/responses' && req.method === 'POST') return proxyRequest(req, res, '/v1/responses');
    if (url.pathname === '/api/images/generations' && req.method === 'POST') return handleQueuedImageJob(req, res, '/v1/images/generations');
    if (url.pathname === '/api/images/edits' && req.method === 'POST') return handleQueuedImageJob(req, res, '/v1/images/edits');
    if (url.pathname === '/api/jobs/responses' && req.method === 'POST') return handleQueuedImageJob(req, res, '/v1/responses');
    if (url.pathname === '/api/jobs/images/generations' && req.method === 'POST') return handleQueuedImageJob(req, res, '/v1/images/generations');
    if (url.pathname === '/api/jobs/images/edits' && req.method === 'POST') return handleQueuedImageJob(req, res, '/v1/images/edits');
    if (url.pathname === '/api/jobs/me' && req.method === 'GET') return handleListMyJobs(req, res);
    const jobStatusMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobStatusMatch && req.method === 'GET') return handleJobStatus(req, res, jobStatusMatch[1]);
    if (jobStatusMatch && req.method === 'DELETE') return handleCancelJob(req, res, jobStatusMatch[1]);
    const jobRetryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);
    if (jobRetryMatch && req.method === 'POST') return handleRetryJob(req, res, jobRetryMatch[1]);
    const jobResultMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/result$/);
    if (jobResultMatch && req.method === 'GET') return handleJobResult(req, res, jobResultMatch[1]);
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    json(res, 500, { error: error.message || String(error) });
  }
});

const bootConfig = await readLocalConfig().catch((error) => {
  console.error(error.message);
  console.error('请复制 config/local.config.example.json 为 config/local.config.json 后填写真实配置.');
  process.exit(1);
});

globalThis.__LOG_FILE__ = bootConfig.logFile;

server.listen(bootConfig.port, bootConfig.host, () => {
  logLine('INFO', `芽绘台 SproutCanvas 已启动: http://${bootConfig.host}:${bootConfig.port}`);
  logLine('INFO', `默认生图服务商: ${bootConfig.name} (${bootConfig.id}), 生图模型: ${bootConfig.imageModel}`);
  logLine('INFO', `文本服务商: ${bootConfig.textProviders.map((provider) => `${provider.name}(${provider.textModel})`).join(' -> ')}`);
  logLine('INFO', `生图队列: 单 worker 严格顺序, 按用户公平轮询`);
  logLine('INFO', `访问密码保护: ${bootConfig.accessPassword ? '已启用' : '未启用'}`);
  logLine('INFO', `日志文件: ${bootConfig.logFile}`);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logLine('INFO', `收到 ${signal}, 正在停止服务...`);
  server.close(() => {
    logLine('INFO', 'HTTP 服务已停止');
    process.exit(0);
  });
  setTimeout(() => {
    logLine('WARN', '等待连接关闭超时, 强制退出');
    process.exit(1);
  }, 10000).unref?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
