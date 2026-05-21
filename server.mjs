import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __dirname;
const LOCAL_CONFIG_PATH = path.join(ROOT, 'config', 'local.config.json');
const DEFAULT_MAX_REQUEST_BYTES = 80 * 1024 * 1024;
const authSessions = new Map();
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

function isAuthenticated(req) {
  const token = sessionTokenFromRequest(req);
  if (!token) return false;
  const session = authSessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token);
    return false;
  }
  return true;
}

function createAuthSession(config) {
  const token = randomBytes(32).toString('base64url');
  const maxAgeSeconds = Math.round(config.authSessionDays * 24 * 60 * 60);
  authSessions.set(token, { expiresAt: Date.now() + maxAgeSeconds * 1000 });
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
  json(res, 200, {
    required: Boolean(config.accessPassword),
    authenticated: !config.accessPassword || isAuthenticated(req),
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
  if (!config.accessPassword) {
    json(res, 200, { ok: true, required: false });
    return;
  }
  let payload = {};
  try {
    payload = JSON.parse((await readRequestBody(req)).toString('utf8') || '{}');
  } catch {
    json(res, 400, { error: '请求体不是有效 JSON' });
    return;
  }
  if (!safeEqualString(payload.password || '', config.accessPassword)) {
    logLine('WARN', `auth login failed from ${req.socket.remoteAddress || 'unknown'}`);
    json(res, 401, { error: '访问密码错误' });
    return;
  }
  const session = createAuthSession(config);
  logLine('INFO', `auth login success from ${req.socket.remoteAddress || 'unknown'}`);
  json(res, 200, { ok: true, required: true }, { 'Set-Cookie': session.cookie });
}

async function handleAuthLogout(req, res) {
  const config = await readLocalConfig();
  json(res, 200, { ok: true }, { 'Set-Cookie': clearAuthSession(req, config) });
}

async function requireApiAuth(req, res) {
  const config = await readLocalConfig();
  if (!config.accessPassword || isAuthenticated(req)) return true;
  json(res, 401, { error: '请先输入访问密码', authRequired: true });
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
    imageConcurrency: Math.max(1, Number(process.env.IMAGE_CONCURRENCY || fileConfig.imageConcurrency || 2)),
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

function extractChatText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || '').join('').trim();
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
  const upstream = await fetch(`${config.baseUrl}${upstreamPath}`, {
    method: 'POST',
    headers: upstreamHeaders(config, 'application/json'),
    body: JSON.stringify(payload),
  });
  if (!upstream.ok) throw new Error(await readUpstreamError(upstream));
  return upstream.json();
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
  for (const textProvider of config.textProviders) {
    const model = textProvider.textModel;
    try {
      const chatPayload = responsesPayloadToChatPayload({ ...payload, model }, textProvider);
      const data = await callJsonUpstream(textProvider, '/v1/chat/completions', chatPayload);
      const text = extractChatText(data);
      if (!text) throw new Error('Chat Completions API 未返回文本内容');
      if (errors.length) logLine('INFO', `[text-provider] fallback success provider=${textProvider.name} mode=chat_completions`);
      json(res, 200, { text, provider: 'chat_completions', providerName: textProvider.name });
      return;
    } catch (error) {
      const message = error.message || String(error);
      errors.push(`${textProvider.name} Chat Completions: ${message}`);
      logLine('WARN', `[text-provider] failed provider=${textProvider.name} mode=chat_completions error=${message.slice(0, 240)}`);
    }
    try {
      const responsesPayload = { ...payload, model, stream: false };
      const data = await callJsonUpstream(textProvider, '/v1/responses', responsesPayload);
      const text = extractResponsesText(data);
      if (!text) throw new Error('Responses API 未返回文本内容');
      if (errors.length) logLine('INFO', `[text-provider] fallback success provider=${textProvider.name} mode=responses`);
      json(res, 200, { text, provider: 'responses', providerName: textProvider.name });
      return;
    } catch (error) {
      const message = error.message || String(error);
      errors.push(`${textProvider.name} Responses: ${message}`);
      logLine('WARN', `[text-provider] failed provider=${textProvider.name} mode=responses error=${message.slice(0, 240)}`);
    }
  }
  json(res, 502, { error: errors.join(' | ') });
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
    });
    await pipeUpstream(res, upstream);
  } catch (error) {
    json(res, 502, { error: `上游请求失败: ${error.message || error}` });
  }
}


const imageQueue = [];
const imageJobs = new Map();
const recentImageDurations = [];
let activeImageJobs = 0;
let imageJobSeq = 0;
let maxImageConcurrency = 2;
let providerPickSeq = 0;
const DEFAULT_IMAGE_DURATION_MS = 90000;
const JOB_TTL_MS = 30 * 60 * 1000;

function averageImageDurationMs() {
  if (!recentImageDurations.length) return DEFAULT_IMAGE_DURATION_MS;
  return Math.round(recentImageDurations.reduce((sum, value) => sum + value, 0) / recentImageDurations.length);
}

function publicJob(job) {
  const queuedIndex = imageQueue.findIndex((item) => item.id === job.id);
  const position = job.status === 'queued' && queuedIndex >= 0 ? queuedIndex + 1 : 0;
  const averageMs = averageImageDurationMs();
  return {
    id: job.id,
    status: job.status,
    position,
    activeCount: activeImageJobs,
    queuedCount: imageQueue.length,
    maxConcurrency: maxImageConcurrency,
    averageMs,
    estimatedWaitMs: position ? Math.ceil(position / maxImageConcurrency) * averageMs : 0,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt || 0,
    finishedAt: job.finishedAt || 0,
    elapsedMs: job.startedAt ? ((job.finishedAt || Date.now()) - job.startedAt) : 0,
    error: job.error || '',
    providerId: job.providerId || '',
    providerName: job.providerName || '',
  };
}

function cleanupJobLater(jobId) {
  setTimeout(() => imageJobs.delete(jobId), JOB_TTL_MS).unref?.();
}

function isRetryableUpstreamStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504, 524].includes(status);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatThrownError(error) {
  const parts = [error?.message || String(error)];
  if (error?.cause?.code) parts.push(error.cause.code);
  if (error?.cause?.message && error.cause.message !== error.message) parts.push(error.cause.message);
  return parts.filter(Boolean).join(' | ');
}

function failedImageJobResult(status, message) {
  return {
    status,
    statusText: 'Upstream request failed',
    contentType: 'application/json; charset=utf-8',
    cacheControl: '',
    body: Buffer.from(JSON.stringify({ error: message })),
    ok: false,
    error: message,
  };
}

function modeForUpstreamPath(upstreamPath) {
  if (upstreamPath.startsWith('/v1/responses')) return 'responses';
  if (upstreamPath.startsWith('/v1/images/')) return 'images';
  return '';
}

function providerLoad(providerId) {
  let count = 0;
  for (const job of imageJobs.values()) {
    if (job.providerId === providerId && (job.status === 'queued' || job.status === 'running')) count += 1;
  }
  return count;
}

function compatibleProviders(config, upstreamPath, contentType) {
  const mode = modeForUpstreamPath(upstreamPath);
  let candidates = config.providers.filter((provider) => !mode || provider.generationMode === mode);
  if (upstreamPath === '/v1/images/generations' && String(contentType || '').includes('application/json')) {
    candidates = config.providers.filter((provider) => provider.generationMode === 'images' || provider.generationMode === 'responses');
  }
  if (upstreamPath === '/v1/images/edits' && !String(contentType || '').includes('application/json')) {
    candidates = candidates.filter((provider) => provider.imageModel === config.imageModel);
  }
  return candidates.length ? candidates : [config];
}

function rankedImageProviders(config, upstreamPath, contentType) {
  const candidates = compatibleProviders(config, upstreamPath, contentType);
  providerPickSeq += 1;
  return candidates
    .map((provider, index) => ({ provider, load: providerLoad(provider.id), order: (index + providerPickSeq) % candidates.length }))
    .sort((left, right) => left.load - right.load || left.order - right.order)
    .map((item) => item.provider);
}

function chooseImageProvider(config, upstreamPath, contentType) {
  return rankedImageProviders(config, upstreamPath, contentType)[0];
}

function rewriteImageJobBody(provider, body, contentType) {
  if (!String(contentType || '').includes('application/json')) return body;
  try {
    const payload = JSON.parse(Buffer.from(body).toString('utf8') || '{}');
    payload.model = provider.imageModel;
    return Buffer.from(JSON.stringify(payload));
  } catch {
    return body;
  }
}

function applyJobProvider(job, provider) {
  job.providerId = provider.id;
  job.providerName = provider.name;
  job.body = rewriteImageJobBody(provider, job.originalBody || job.body, job.contentType);
}

function buildResponsesPayloadFromImagesPayload(provider, imagesPayload) {
  const prompt = String(imagesPayload?.prompt || '').trim();
  const tool = { type: 'image_generation' };
  if (imagesPayload?.output_format) tool.output_format = imagesPayload.output_format;
  if (imagesPayload?.size) tool.size = imagesPayload.size;
  if (imagesPayload?.quality) tool.quality = imagesPayload.quality;
  if (imagesPayload?.background) tool.background = imagesPayload.background;
  if (imagesPayload?.output_compression) tool.output_compression = imagesPayload.output_compression;
  return {
    model: provider.imageModel,
    input: [
      {
        role: 'system',
        content: '你是一个图片生成助手。用户要求你生成图片时, 必须调用 image_generation 工具来生成图片, 不要用文字描述图片内容。直接生成图片, 不要多说任何话。',
      },
      { role: 'user', content: `请生成以下描述的图片: ${prompt}` },
    ],
    tools: [tool],
    stream: true,
  };
}

function extractImageBase64(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractImageBase64(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'result' || key === 'image_base64' || key === 'b64_json') && typeof child === 'string' && child.length > 1000) return child;
      const found = extractImageBase64(child);
      if (found) return found;
    }
  }
  return '';
}

function extractImageBase64FromResponsesBody(body) {
  const raw = body.toString('utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const dataText = trimmed.slice(6);
    if (!dataText || dataText === '[DONE]') continue;
    try {
      const found = extractImageBase64(JSON.parse(dataText));
      if (found) return found;
    } catch {}
  }
  try {
    return extractImageBase64(JSON.parse(raw));
  } catch {
    return '';
  }
}

async function processResponsesBackedImagesJob(job, config) {
  let imagesPayload = {};
  try {
    imagesPayload = JSON.parse(Buffer.from(job.body).toString('utf8') || '{}');
  } catch {}
  const responsesPayload = buildResponsesPayloadFromImagesPayload(config, imagesPayload);
  const upstream = await fetch(`${config.baseUrl}/v1/responses`, {
    method: job.method,
    headers: upstreamHeaders(config, 'application/json'),
    body: Buffer.from(JSON.stringify(responsesPayload)),
  });
  const upstreamBody = Buffer.from(await upstream.arrayBuffer());
  if (!upstream.ok) {
    return {
      status: upstream.status,
      statusText: upstream.statusText,
      contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      cacheControl: upstream.headers.get('cache-control') || '',
      body: upstreamBody,
      ok: false,
      error: await formatUpstreamErrorFromBody(upstream, upstreamBody),
    };
  }
  const imageBase64 = extractImageBase64FromResponsesBody(upstreamBody);
  if (!imageBase64) {
    const error = 'Responses API 已返回, 但未找到图片数据';
    return {
      status: 502,
      statusText: 'Image not found in responses stream',
      contentType: 'application/json; charset=utf-8',
      cacheControl: '',
      body: Buffer.from(JSON.stringify({ error })),
      ok: false,
      error,
    };
  }
  return {
    status: 200,
    statusText: 'OK',
    contentType: 'application/json; charset=utf-8',
    cacheControl: '',
    body: Buffer.from(JSON.stringify({ data: [{ b64_json: imageBase64 }] })),
    ok: true,
    error: '',
  };
}

function enqueueImageJob(job) {
  imageJobs.set(job.id, job);
  imageQueue.push(job);
  runImageQueue();
  return publicJob(job);
}

function runImageQueue() {
  while (activeImageJobs < maxImageConcurrency && imageQueue.length) {
    const job = imageQueue.shift();
    activeImageJobs += 1;
    job.status = 'running';
    job.startedAt = Date.now();
    processImageJob(job).finally(() => {
      activeImageJobs = Math.max(0, activeImageJobs - 1);
      runImageQueue();
    });
  }
}

async function executeImageJobWithProvider(job, config) {
  if (job.upstreamPath === '/v1/images/generations' && config.generationMode === 'responses' && String(job.contentType || '').includes('application/json')) {
    return processResponsesBackedImagesJob(job, config);
  }
  let upstream;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    upstream = await fetch(`${config.baseUrl}${job.upstreamPath}`, {
      method: job.method,
      headers: upstreamHeaders(config, job.contentType),
      body: job.body,
    });
    if (upstream.ok || !isRetryableUpstreamStatus(upstream.status) || attempt === 1) break;
    await upstream.arrayBuffer().catch(() => null);
    await wait(1200);
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  return {
    status: upstream.status,
    statusText: upstream.statusText,
    contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    cacheControl: upstream.headers.get('cache-control') || '',
    body,
    ok: upstream.ok,
    error: upstream.ok ? '' : await formatUpstreamErrorFromBody(upstream, body),
  };
}

async function processImageJob(job) {
  try {
    const initialConfig = await readLocalConfig(job.providerId);
    maxImageConcurrency = initialConfig.imageConcurrency;
    const providers = job.autoProviderRouting ? rankedImageProviders(initialConfig, job.upstreamPath, job.contentType) : [initialConfig];
    let jobResult = null;
    let lastConfig = initialConfig;
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      applyJobProvider(job, provider);
      const config = await readLocalConfig(provider.id);
      lastConfig = config;
      logLine('INFO', `[image-job] start ${job.id} provider=${config.name} mode=${config.generationMode} path=${job.upstreamPath}${index ? ' fallback' : ''}`);
      try {
        jobResult = await executeImageJobWithProvider(job, config);
      } catch (error) {
        const message = `上游请求异常: ${formatThrownError(error)}`;
        jobResult = failedImageJobResult(502, message);
      }
      if (jobResult.ok || !isRetryableUpstreamStatus(jobResult.status) || index === providers.length - 1) break;
      logLine('WARN', `[image-job] retryable ${job.id} provider=${config.name} status=${jobResult.status} error=${jobResult.error}`);
    }
    job.finishedAt = Date.now();
    job.result = jobResult;
    job.status = jobResult.ok ? 'succeeded' : 'failed';
    if (!jobResult.ok) {
      job.error = jobResult.error;
      logLine('WARN', `[image-job] failed ${job.id} provider=${lastConfig.name} status=${jobResult.status} error=${job.error}`);
    }
    if (jobResult.ok) {
      logLine('INFO', `[image-job] done ${job.id} provider=${lastConfig.name} duration=${job.finishedAt - job.startedAt}ms`);
      recentImageDurations.push(job.finishedAt - job.startedAt);
      while (recentImageDurations.length > 30) recentImageDurations.shift();
    }
  } catch (error) {
    logLine('ERROR', `[image-job] crashed ${job.id} provider=${job.providerName || job.providerId} error=${error.message || error}`);
    job.finishedAt = Date.now();
    job.status = 'failed';
    job.error = error.message || String(error);
    job.result = {
      status: 502,
      statusText: 'Queue job failed',
      contentType: 'application/json; charset=utf-8',
      cacheControl: '',
      body: Buffer.from(JSON.stringify({ error: job.error })),
    };
  } finally {
    cleanupJobLater(job.id);
  }
}

async function formatUpstreamErrorFromBody(upstream, body) {
  const contentType = upstream.headers.get('content-type') || '';
  const raw = body.toString('utf8');
  const cleaned = contentType.includes('html') || /^\s*</.test(raw) ? stripHtml(raw) : raw.trim();
  return `上游 API 返回 HTTP ${upstream.status}: ${(cleaned || upstream.statusText || '无错误正文').slice(0, 360)}`;
}

async function handleQueuedImageJob(req, res, upstreamPath) {
  let config;
  try {
    config = await readLocalConfig(providerIdFromRequest(req));
    maxImageConcurrency = config.imageConcurrency;
  } catch (error) {
    json(res, 500, { error: error.message });
    return;
  }
  const contentType = req.headers['content-type'] || '';
  const rawBody = await readRequestBody(req);
  const autoProviderRouting = !providerIdFromRequest(req);
  const selectedProvider = autoProviderRouting ? chooseImageProvider(config, upstreamPath, contentType) : config;
  const body = rewriteImageJobBody(selectedProvider, rawBody, contentType);
  const job = {
    id: `img_${Date.now()}_${++imageJobSeq}`,
    status: 'queued',
    method: 'POST',
    upstreamPath,
    contentType,
    body,
    originalBody: rawBody,
    autoProviderRouting,
    queuedAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
    error: '',
    result: null,
    providerId: selectedProvider.id,
    providerName: selectedProvider.name,
  };
  logLine('INFO', `[image-job] queued ${job.id} provider=${selectedProvider.name} mode=${selectedProvider.generationMode} path=${upstreamPath}`);
  json(res, 202, enqueueImageJob(job));
}

function handleJobStatus(res, jobId) {
  const job = imageJobs.get(jobId);
  if (!job) {
    json(res, 404, { error: '任务不存在或已过期' });
    return;
  }
  json(res, 200, publicJob(job));
}

function handleJobResult(res, jobId) {
  const job = imageJobs.get(jobId);
  if (!job) {
    json(res, 404, { error: '任务不存在或已过期' });
    return;
  }
  if (job.status === 'queued' || job.status === 'running') {
    json(res, 202, publicJob(job));
    return;
  }
  const result = job.result || {
    status: 500,
    contentType: 'application/json; charset=utf-8',
    body: Buffer.from(JSON.stringify({ error: job.error || '任务失败' })),
  };
  const headers = { 'Content-Type': result.contentType };
  if (result.cacheControl) headers['Cache-Control'] = result.cacheControl;
  res.writeHead(result.status, headers);
  res.end(result.body);
}

async function serveStatic(req, res, pathname) {
  const cleanPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  if (cleanPath.startsWith('/config/') || cleanPath.includes('/.') || path.basename(cleanPath).startsWith('.')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const filePath = path.resolve(ROOT, `.${cleanPath}`);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES.get(path.extname(filePath)) || 'application/octet-stream' });
    res.end(data);
  } catch {
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
    if (url.pathname === '/api/images/generations' && req.method === 'POST') return proxyRequest(req, res, '/v1/images/generations');
    if (url.pathname === '/api/images/edits' && req.method === 'POST') return proxyRequest(req, res, '/v1/images/edits');
    if (url.pathname === '/api/jobs/responses' && req.method === 'POST') return handleQueuedImageJob(req, res, '/v1/responses');
    if (url.pathname === '/api/jobs/images/generations' && req.method === 'POST') return handleQueuedImageJob(req, res, '/v1/images/generations');
    if (url.pathname === '/api/jobs/images/edits' && req.method === 'POST') return handleQueuedImageJob(req, res, '/v1/images/edits');
    const jobStatusMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobStatusMatch && req.method === 'GET') return handleJobStatus(res, jobStatusMatch[1]);
    const jobResultMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/result$/);
    if (jobResultMatch && req.method === 'GET') return handleJobResult(res, jobResultMatch[1]);
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
  maxImageConcurrency = bootConfig.imageConcurrency;
  logLine('INFO', `芽绘台 SproutCanvas 已启动: http://${bootConfig.host}:${bootConfig.port}`);
  logLine('INFO', `默认生图服务商: ${bootConfig.name} (${bootConfig.id}), 生图模型: ${bootConfig.imageModel}`);
  logLine('INFO', `文本服务商: ${bootConfig.textProviders.map((provider) => `${provider.name}(${provider.textModel})`).join(' -> ')}`);
  logLine('INFO', `生图队列并发: ${bootConfig.imageConcurrency}`);
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
