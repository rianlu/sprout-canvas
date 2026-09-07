import { toImagesPayload } from '../shared/generation-contract.mjs';
import { readLimitedBody } from './image-result.mjs';
import { redactProviderSecrets } from './http.mjs';
let upstreamHeaders, timeoutSignal, stripHtml;
let IMAGE_UPSTREAM_TIMEOUT_MS = 180000;
let RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS = 420000;
export function initProviderAdapter(deps) {
  ({ upstreamHeaders, timeoutSignal, stripHtml } = deps);
  IMAGE_UPSTREAM_TIMEOUT_MS = deps.IMAGE_UPSTREAM_TIMEOUT_MS || IMAGE_UPSTREAM_TIMEOUT_MS;
  RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS = deps.RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS || RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS;
}

export function isJsonContent(contentType) {
  return String(contentType || '').includes('application/json');
}

export function isMultipartEdit(contentType) {
  return String(contentType || '').includes('multipart/form-data');
}

function parseJsonBody(body) {
  try {
    return JSON.parse(Buffer.from(body).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

function referenceImagesFromPayload(payload) {
  const refs = Array.isArray(payload?.ref_images) ? payload.ref_images : Array.isArray(payload?.input_images) ? payload.input_images : [];
  return refs
    .map((ref, index) => ({
      name: String(ref?.name || `reference-${index + 1}.jpg`),
      imageUrl: String(ref?.image_url || ref?.dataUrl || ref?.data_url || ''),
      maskUrl: String(ref?.mask_url || ref?.maskDataUrl || ref?.mask_data_url || ''),
    }))
    .filter((ref) => ref.imageUrl.startsWith('data:image/'));
}

function payloadHasReferenceImages(payload) {
  return referenceImagesFromPayload(payload).length > 0;
}

function payloadHasReferenceMask(payload) {
  return referenceImagesFromPayload(payload).some((ref) => ref.maskUrl.startsWith('data:image/'));
}

function jobJsonPayload(job) {
  return job.submission ? toImagesPayload(job.submission) : parseJsonBody(job.originalBody || job.body);
}

function isSemanticImageGeneration(job) {
  return job.upstreamPath === '/v1/images/generations' && isJsonContent(job.contentType);
}

function isSemanticImageEdit(job) {
  return isSemanticImageGeneration(job) && payloadHasReferenceImages(jobJsonPayload(job));
}

export function modeForUpstreamPath(upstreamPath) {
  if (upstreamPath.startsWith('/v1/responses')) return 'responses';
  if (upstreamPath.startsWith('/v1/images/')) return 'images';
  return '';
}

function multipartBoundary(contentType) {
  const match = String(contentType || '').match(/boundary=(?:("[^"]+")|([^;]+))/i);
  return (match?.[1] || match?.[2] || '').replace(/^"|"$/g, '').trim();
}

export function rewriteMultipartFormField(body, contentType, fieldName, value) {
  const boundary = multipartBoundary(contentType);
  if (!boundary) return body;
  const source = Buffer.from(body).toString('latin1');
  const pattern = new RegExp('(Content-Disposition: form-data;[^\\r\\n]*name="' + fieldName + '"[^\\r\\n]*\\r?\\n(?:[^\\r\\n]+\\r?\\n)*\\r?\\n)([^\\r\\n]*)');
  if (pattern.test(source)) {
    return Buffer.from(source.replace(pattern, `$1${value}`), 'latin1');
  }
  const closing = `--${boundary}--`;
  const fieldPart = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"\r\n\r\n${value}\r\n`;
  if (source.includes(closing)) return Buffer.from(source.replace(closing, `${fieldPart}${closing}`), 'latin1');
  return body;
}


// ----- Upstream execution -----

export async function executeImageJobWithProvider(job, config) {
  if (isSemanticImageGeneration(job) && config.generationMode === 'responses') {
    return processResponsesBackedImagesJob(job, config);
  }
  if (isSemanticImageEdit(job) && config.generationMode === 'images') {
    return processImagesEditBackedGenerationJob(job, config);
  }
  if (job.upstreamPath === '/v1/responses') {
    return callResponsesAndExtractImage(job.body, config);
  }
  const timeoutMs = job.upstreamPath.startsWith('/v1/responses') ? RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS : IMAGE_UPSTREAM_TIMEOUT_MS;
  const upstream = await fetch(`${config.baseUrl}${job.upstreamPath}`, {
    method: job.method,
    headers: upstreamHeaders(config, job.contentType),
    body: job.submission ? JSON.stringify({ ...jobJsonPayload(job), model: config.imageModel }) : job.body,
    signal: timeoutSignal(timeoutMs),
  });
  const body = await readLimitedBody(upstream);
  return {
    status: upstream.status,
    statusText: upstream.statusText,
    contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    cacheControl: upstream.headers.get('cache-control') || '',
    body,
    ok: upstream.ok,
    error: upstream.ok ? '' : await formatUpstreamErrorFromBody(upstream, body, config),
  };
}

async function callResponsesAndExtractImage(payloadBuffer, config) {
  const upstream = await fetch(`${config.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: upstreamHeaders(config, 'application/json'),
    body: payloadBuffer,
    signal: timeoutSignal(RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS),
  });
  const upstreamBody = await readLimitedBody(upstream);
  if (!upstream.ok) {
    return {
      status: upstream.status,
      statusText: upstream.statusText,
      contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      cacheControl: upstream.headers.get('cache-control') || '',
      body: upstreamBody,
      ok: false,
      error: await formatUpstreamErrorFromBody(upstream, upstreamBody, config),
    };
  }
  const images = extractImagesFromResponsesBody(upstreamBody);
  if (!images.length) {
    const error = 'Responses API 已返回, 但未找到图片数据';
    return {
      status: 502,
      statusText: 'Image not found in responses stream',
      contentType: 'application/json; charset=utf-8',
      cacheControl: '',
      body: Buffer.from(JSON.stringify({ error })),
      ok: false,
      outcomeUnknown: true,
      error,
    };
  }
  return {
    status: 200,
    statusText: 'OK',
    contentType: 'application/json; charset=utf-8',
    cacheControl: '',
    body: Buffer.from(JSON.stringify({ data: images })),
    ok: true,
    error: '',
  };
}

async function processImagesEditBackedGenerationJob(job, config) {
  const imagesPayload = jobJsonPayload(job);
  const { body, contentType } = buildImagesEditMultipartFromPayload(config, imagesPayload);
  const upstream = await fetch(`${config.baseUrl}/v1/images/edits`, {
    method: 'POST',
    headers: upstreamHeaders(config, contentType),
    body,
    signal: timeoutSignal(IMAGE_UPSTREAM_TIMEOUT_MS),
  });
  const upstreamBody = await readLimitedBody(upstream);
  return {
    status: upstream.status,
    statusText: upstream.statusText,
    contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    cacheControl: upstream.headers.get('cache-control') || '',
    body: upstreamBody,
    ok: upstream.ok,
    error: upstream.ok ? '' : await formatUpstreamErrorFromBody(upstream, upstreamBody, config),
  };
}

function dataUrlToImagePart(ref) {
  const match = ref.imageUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = match[1] || 'image/jpeg';
  const raw = match[3] || '';
  const buffer = match[2] ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw));
  return { name: ref.name, mime, buffer };
}

function appendMultipartField(parts, boundary, name, value) {
  if (value === undefined || value === null || value === '' || value === 'auto') return;
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
}

function appendMultipartFile(parts, boundary, name, file) {
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${String(file.name).replace(/[\r\n\"]/g, '_')}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
  parts.push(file.buffer);
  parts.push(Buffer.from('\r\n'));
}


export function buildImagesEditMultipartFromPayload(provider, imagesPayload) {
  const boundary = `----sprout-canvas-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const parts = [];
  appendMultipartField(parts, boundary, 'model', provider.imageModel);
  appendMultipartField(parts, boundary, 'prompt', imagesPayload.prompt || '');
  appendMultipartField(parts, boundary, 'n', imagesPayload.n || 1);
  appendMultipartField(parts, boundary, 'size', imagesPayload.size);
  appendMultipartField(parts, boundary, 'quality', imagesPayload.quality);
  appendMultipartField(parts, boundary, 'background', imagesPayload.background);
  appendMultipartField(parts, boundary, 'output_format', imagesPayload.output_format);
  appendMultipartField(parts, boundary, 'output_compression', imagesPayload.output_compression);
  const references = referenceImagesFromPayload(imagesPayload);
  for (const ref of references) {
    const file = dataUrlToImagePart(ref);
    if (file) appendMultipartFile(parts, boundary, references.length > 1 ? 'image[]' : 'image', file);
    if (ref.maskUrl?.startsWith('data:image/')) {
      const mask = dataUrlToImagePart({ name: `mask-${file?.name || ref.name}`, imageUrl: ref.maskUrl });
      if (mask) appendMultipartFile(parts, boundary, 'mask', mask);
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function processResponsesBackedImagesJob(job, config) {
  const imagesPayload = jobJsonPayload(job);
  const responsesPayload = buildResponsesPayloadFromImagesPayload(config, imagesPayload);
  return callResponsesAndExtractImage(Buffer.from(JSON.stringify(responsesPayload)), config);
}

export function buildResponsesPayloadFromImagesPayload(provider, imagesPayload) {
  const prompt = String(imagesPayload?.prompt || '').trim();
  const refs = referenceImagesFromPayload(imagesPayload);
  const firstMaskRef = refs.find((ref) => ref.maskUrl?.startsWith('data:image/'));
  const tool = { type: 'image_generation' };
  if (firstMaskRef) {
    tool.action = 'edit';
    tool.input_image_mask = { image_url: firstMaskRef.maskUrl };
  }
  if (imagesPayload?.output_format) tool.output_format = imagesPayload.output_format;
  if (imagesPayload?.size) tool.size = imagesPayload.size;
  if (imagesPayload?.quality) tool.quality = imagesPayload.quality;
  if (imagesPayload?.background) tool.background = imagesPayload.background;
  if (imagesPayload?.moderation) tool.moderation = imagesPayload.moderation;
  if (imagesPayload?.output_compression !== undefined) tool.output_compression = imagesPayload.output_compression;
  const contentParts = refs.map((ref) => ({ type: 'input_image', image_url: ref.imageUrl }));
  const instruction = firstMaskRef
    ? `请只编辑蒙版透明区域。保持未透明区域尽量不变。编辑要求: ${prompt}`
    : `请根据参考图片生成新图片。要求: ${prompt}`;
  const userContent = refs.length
    ? [
      { type: 'input_text', text: instruction },
      ...contentParts,
    ]
    : `请生成以下描述的图片: ${prompt}`;
  return {
    model: provider.imageModel,
    input: [
      { role: 'system', content: '你是一个图片生成助手。用户要求你生成图片时, 必须调用 image_generation 工具来生成图片, 不要用文字描述图片内容。直接生成图片, 不要多说任何话。' },
      { role: 'user', content: userContent },
    ],
    tools: [tool],
    tool_choice: { type: 'image_generation' },
    stream: true,
  };
}

function extractImagesFromResponsesBody(body) {
  const raw = body.toString('utf8');
  const images = new Map();
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'image_generation_call' && typeof value.result === 'string' && value.result.length > 32) images.set(value.id || value.result, { b64_json: value.result, revised_prompt: value.revised_prompt || '' });
    if (Array.isArray(value.output)) value.output.forEach(collect);
    if (value.item) collect(value.item);
    if (value.response) collect(value.response);
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const dataText = trimmed.slice(5).trim();
    if (!dataText || dataText === '[DONE]') continue;
    try {
      const event = JSON.parse(dataText);
      if (['response.output_item.done', 'response.completed'].includes(event.type)) collect(event);
    } catch {}
  }
  try {
    collect(JSON.parse(raw));
  } catch {}
  return [...images.values()];
}

// ----- Error helpers -----

function isRetryableUpstreamStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504, 524].includes(status);
}

// 某些 router/网关把限流类错误误标成 400. 通过错误消息关键词识别, 让队列切到下一个 provider.
const RATE_LIMIT_HINTS = [
  '服务部署已超过最大限制',
  '超过最大限制',
  '超过限制',
  '限流',
  '配额',
  '已超额',
  '余额不足',
  '余额',
  'rate limit',
  'rate-limit',
  'ratelimit',
  'quota',
  'too many requests',
  'overloaded',
  'capacity',
];

// 有些上游的图片接口会把一次失败的图片生成错误包装成 400, 但正文不是参数错误,
// 而是一段类似聊天回复的自然语言说明. 这类情况通常说明上游路由到了文本回复
// 或没有返回图片数据, 应该切换到下一个生图服务商继续尝试.
const ASSISTANT_TEXT_400_HINTS = [
  '如果你想',
  '我可以',
  '可以帮你',
  '画面呈现',
  '这张图',
  '这幅图',
  '其他方向',
  '帮你把',
];

const NON_RETRYABLE_400_HINTS = [
  'content_policy_violation',
  'invalid_request_error',
  'invalid parameter',
  'invalid value',
  'unsupported',
  'not supported',
  '缺少',
  '无效',
  '不支持',
];

function looksLikeRateLimit(message) {
  if (!message) return false;
  const lower = String(message).toLowerCase();
  return RATE_LIMIT_HINTS.some((hint) => lower.includes(hint.toLowerCase()));
}

function looksLikeAssistantTextInsteadOfImage(message) {
  if (!message) return false;
  const value = String(message);
  const lower = value.toLowerCase();
  if (NON_RETRYABLE_400_HINTS.some((hint) => lower.includes(hint.toLowerCase()))) return false;
  return ASSISTANT_TEXT_400_HINTS.some((hint) => value.includes(hint));
}

export function isRetryableJobResult(jobResult) {
  if (!jobResult || jobResult.outcomeUnknown) return false;
  if (isRetryableUpstreamStatus(jobResult.status)) return true;
  if (jobResult.status === 400 && looksLikeRateLimit(jobResult.error)) return true;
  if (jobResult.status === 400 && looksLikeAssistantTextInsteadOfImage(jobResult.error)) return true;
  return false;
}

export function formatThrownError(error) {
  const parts = [error?.message || String(error)];
  if (error?.cause?.code) parts.push(error.cause.code);
  if (error?.cause?.message && error.cause.message !== error.message) parts.push(error.cause.message);
  return parts.filter(Boolean).join(' | ');
}

export function failedImageJobResult(status, message) {
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

async function formatUpstreamErrorFromBody(upstream, body, config) {
  const contentType = upstream.headers.get('content-type') || '';
  const raw = body.toString('utf8');
  let cleaned = contentType.includes('html') || /^\s*</.test(raw) ? stripHtml(raw) : raw.trim();
  if (contentType.includes('json') || /^\s*\{/.test(cleaned)) {
    try {
      const parsed = JSON.parse(cleaned);
      const inner = parsed?.error?.message || parsed?.error || parsed?.message;
      if (inner) cleaned = typeof inner === 'string' ? inner : JSON.stringify(inner);
    } catch {}
  }
  return `上游 API 返回 HTTP ${upstream.status}: ${redactProviderSecrets(cleaned || upstream.statusText || '无错误正文', config).slice(0, 360)}`;
}
