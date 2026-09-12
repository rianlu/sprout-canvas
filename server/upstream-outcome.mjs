import { redactProviderSecrets, stripHtml } from './http.mjs';

const CONNECT_FAILURES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
const UNCERTAIN_HTTP = new Set([408, 499, 504, 520, 522, 524]);
const UNCERTAIN_ERROR = /time[ _-]?out|timed[ _-]?out|超时|bad[ _-]?gateway|gateway[ _-]?(?:error|failure)|econnreset|epipe|connection[ _-]?(?:reset|closed)|socket[ _-]?(?:hang[ _-]?up|closed)|unexpected[ _-]?eof|broken[ _-]?pipe|连接(?:重置|中断)|结果未知|仍在(?:生成|处理)|already (?:running|being processed)/i;

export function isDefiniteConnectionFailure(error) {
  if (!error || typeof error !== 'object') return false;
  if (Array.isArray(error.errors) && error.errors.length) return error.errors.every(isDefiniteConnectionFailure);
  if (error.cause) return isDefiniteConnectionFailure(error.cause);
  return CONNECT_FAILURES.has(error.code);
}

// Classify connection errors only around fetch, never around response/image reads.
export async function fetchGeneration(url, options) {
  try { return await fetch(url, options); }
  catch (error) {
    const definiteFailure = isDefiniteConnectionFailure(error);
    throw Object.assign(error, { definiteFailure, outcomeUnknown: !definiteFailure });
  }
}

export function upstreamFailure(status, body) {
  let value = body, raw = '';
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    raw = body.toString();
    try { value = JSON.parse(raw); } catch { value = null; }
  }
  const response = value?.response || value;
  if (status < 400 && Array.isArray(value?.data) && value.data.some((item) => item?.b64_json || item?.url)) return null;
  const terminal = ['failed', 'incomplete', 'cancelled'].includes(response?.status)
    || ['response.failed', 'response.incomplete', 'response.cancelled'].includes(value?.type);
  const inner = response?.error || (value?.type === 'error' ? value : null);
  if (status < 400 && !inner && !terminal) return null;
  const incomplete = response?.status === 'incomplete' || value?.type === 'response.incomplete';
  const reason = response?.incomplete_details?.reason || '';
  const code = String(inner?.code || inner?.type || reason);
  const message = typeof inner === 'string' ? inner : inner?.message || reason || response?.message || raw || '上游未完成生成';
  const outcomeUnknown = UNCERTAIN_HTTP.has(status)
    || UNCERTAIN_ERROR.test(code + ' ' + message)
    || (incomplete && !['max_output_tokens', 'content_filter'].includes(reason))
    || (status >= 500 && !inner && !terminal);
  let effectiveStatus = status;
  if (status < 400) {
    effectiveStatus = /rate_limit|quota|overload|capacity/i.test(code) ? 429
      : /invalid|content_policy|content_filter|safety|max_output_tokens/i.test(code) ? 400 : 502;
  }
  return { status: effectiveStatus, upstreamStatus: status, message: String(message), outcomeUnknown };
}

export function formatUpstreamFailure(failure, config) {
  const message = redactProviderSecrets(stripHtml(failure.message), config).slice(0, 360);
  const prefix = failure.upstreamStatus >= 400 ? '上游 API 返回 HTTP ' + failure.upstreamStatus : '上游 API 返回生成错误';
  return prefix + ': ' + message + (failure.outcomeUnknown ? '. 结果待核实, 未自动重复调用.' : '');
}
