import { requestError } from '../shared/generation-contract.mjs';
import { createFileLogger } from './logging.mjs';
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024 * 1024;
let fileLogger;

export function initLogging(filename) { fileLogger = filename ? createFileLogger(filename) : undefined; }
export async function flushLogs() { await fileLogger?.flush(); }

export function timeoutSignal(ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  timer.unref?.();
  return ac.signal;
}

export function isTimeoutError(error) {
  return error?.name === 'AbortError' || /aborted|timeout|timed out/i.test(error?.message || String(error));
}
export function json(res, status, data, extraHeaders = {}) {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(data));
}

export function setBaseHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if ((req.url || '').startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
}

export function logLine(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${String(message).replace(/[\r\n]+/g, ' ')}`;
  const writer = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  writer(line);
  fileLogger?.write(`${line}\n`);
}

export async function readRequestBody(req, maxBytes = DEFAULT_MAX_REQUEST_BYTES) {
  if (Number(req.headers['content-length']) > maxBytes) {
    req.resume();
    throw requestError('请求体超过允许的大小', 413);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total <= maxBytes) chunks.push(buffer);
  }
  if (total > maxBytes) throw requestError('请求体超过允许的大小', 413);
  return Buffer.concat(chunks);
}

function resolveHeaderValue(value) {
  return String(value)
    .replaceAll('{{timestamp}}', String(Date.now()))
    .replaceAll('{{sessionId}}', `browser-${Date.now()}`);
}

export function upstreamHeaders(config, contentType) {
  const headers = { Authorization: `Bearer ${config.apiKey}` };
  for (const [key, value] of Object.entries(config.requestHeaders || {})) {
    if (value === null || value === undefined) continue;
    headers[key] = resolveHeaderValue(value);
  }
  headers.Authorization = `Bearer ${config.apiKey}`;
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

export function stripHtml(input) {
  return String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function redactProviderSecrets(value, config) {
  let result = String(value || '');
  const secrets = [config?.apiKey, ...Object.entries(config?.requestHeaders || {}).filter(([name]) => /authorization|token|key|secret/i.test(name)).map(([, value]) => value)].filter((value) => typeof value === 'string' && value.length > 3);
  for (const secret of secrets) result = result.split(secret).join('[redacted]');
  return result;
}

export async function readUpstreamError(upstream, config) {
  const contentType = upstream.headers.get('content-type') || '';
  const body = await upstream.text().catch(() => '');
  const cleaned = contentType.includes('html') || /^\s*</.test(body) ? stripHtml(body) : body.trim();
  const shortText = redactProviderSecrets(cleaned, config).slice(0, 360) || upstream.statusText || '无错误正文';
  return `上游 API 返回 HTTP ${upstream.status}: ${shortText}`;
}


export async function readJson(req, maxBytes) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw requestError('请使用 application/json', 415);
  const raw = await readRequestBody(req, maxBytes);
  try { return JSON.parse(raw.toString('utf8')); } catch { throw requestError('请求体不是有效 JSON'); }
}
