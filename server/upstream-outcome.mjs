import { redactProviderSecrets, stripHtml } from './http.mjs';

const CONNECT_FAILURES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
const UNCERTAIN_HTTP = new Set([408, 499, 504, 520, 522, 524]);
const UNCERTAIN_ERROR = /time[ _-]?out|timed[ _-]?out|超时|bad[ _-]?gateway|gateway[ _-]?(?:error|failure)|econnreset|epipe|connection[ _-]?(?:reset|closed)|socket[ _-]?(?:hang[ _-]?up|closed)|unexpected[ _-]?eof|broken[ _-]?pipe|deadline[ _-]?exceeded|context[ _-]?canceled|\beof\b|\bstream[ _-]?error|goaway|upstream[ _-]?connect|reset[ _-]?before[ _-]?headers|连接(?:重置|中断)|结果未知|仍在(?:生成|处理)|already (?:running|being processed)/i;

// A 5xx may come from a relay that already forwarded the request, so for images only refusals that prove nothing ran may switch channels.
const NOT_STARTED_ERROR = /overload|capacity|rate[ _-]?limit|too many requests|quota|no available (?:channel|provider)|负载已?(?:饱和|已满|过高)|无可用(?:渠道|通道)|限流|配额|余额不足/i;

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

// Text replies are cheap and settled once, so text also treats a structured 5xx error body as a refusal and may switch channels.
export function upstreamFailure(status, body, { strictServerErrors = true } = {}) {
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
    || (status >= 500 && !NOT_STARTED_ERROR.test(code + ' ' + message) && (strictServerErrors || (!inner && !terminal)));
  let effectiveStatus = status;
  if (status < 400) {
    effectiveStatus = /rate_limit|quota|overload|capacity/i.test(code) ? 429
      : /invalid|content_policy|content_filter|safety|max_output_tokens/i.test(code) ? 400 : 502;
  }
  return { status: effectiveStatus, upstreamStatus: status, message: String(message), outcomeUnknown };
}

const STATUS_LABELS = new Map([[400, '拒绝了请求'], [401, '鉴权失败'], [403, '拒绝访问'], [404, '接口或模型不存在'], [408, '响应超时'], [413, '请求内容过大'], [429, '请求过多'], [500, '内部错误'], [502, '网关错误'], [503, '暂时不可用'], [504, '响应超时'], [520, '网关错误'], [522, '连接超时'], [524, '响应超时']]);
const HTML_BODY = /<\s*(?:!doctype|html|head|body|title|div|p|h\d)\b/i;
const URL_TEXT = /\b(?:https?|wss?):\/\/[^\s"'<>)\]]+/gi;
const HOST_TEXT = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ai|app|dev|cn|top|xyz|si|me|cc|co|info|site|online|cloud|tech|pro|vip|link|club|shop|icu|ink|fun|work|live|world|one|run|so|im|tw|hk|jp|us|uk|de|sg|kr|ru)\b(?::\d+)?/gi;
const IP_TEXT = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;

// Error bodies from relays often carry their own hostnames, IPs and gateway pages; users only need the reason.
export function publicUpstreamText(text, config) {
  let value = redactProviderSecrets(String(text || ''), config);
  try { const host = new URL(config?.baseUrl).host; if (host) value = value.split(host).join('上游服务'); } catch {}
  return value.replace(URL_TEXT, '上游服务').replace(HOST_TEXT, '上游服务').replace(IP_TEXT, '上游服务');
}

export function formatUpstreamFailure(failure, config, service = '生图服务') {
  const status = failure.upstreamStatus;
  const html = HTML_BODY.test(failure.message);
  const message = html ? '' : publicUpstreamText(stripHtml(failure.message), config).slice(0, 360);
  const label = STATUS_LABELS.get(status) || (status >= 500 ? '服务异常' : '拒绝了请求');
  const reason = status >= 400 ? `${service}${label} (HTTP ${status})${message ? ': ' + message : ''}` : `${service}返回生成错误: ${message || '上游未完成生成'}`;
  return reason + (failure.outcomeUnknown ? '. 结果未知, 本次不扣点, 未自动重复调用.' : '');
}

// The server log keeps the stripped original so operators can still see which gateway answered.
export function upstreamFailureDetail(failure, config) {
  return `HTTP ${failure.upstreamStatus}: ${redactProviderSecrets(stripHtml(failure.message), config).slice(0, 360)}`;
}
