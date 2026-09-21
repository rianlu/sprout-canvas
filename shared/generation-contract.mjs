import { validateCreditQuote } from './credits-contract.mjs';

export const GENERATION_DEFAULTS = Object.freeze({
  size: '1024x1024', quality: 'auto', outputFormat: 'png', background: 'auto', outputCompression: 90,
});

export const IMAGE_SIZES = Object.freeze(['auto', '1024x1024', '1536x1024', '1024x1536']);
// Retain historical metadata when replaying accepted requests; new series do not select a template.
export const SERIES_TEMPLATES = Object.freeze(['picture-book', 'ecommerce', 'video-board', 'brand-ip']);
export const MAX_PROMPT_LENGTH = 24000;
export const MAX_REFERENCE_IMAGES = 4;
export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;

export function validateImageSize(size) {
  if (size === 'auto') return size;
  const match = typeof size === 'string' && /^(\d+)x(\d+)$/.exec(size);
  if (!match) throw requestError('图片尺寸格式无效');
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (width % 16 || height % 16 || width <= 0 || height <= 0 || Math.max(width, height) > 3840 || Math.max(width, height) / Math.min(width, height) > 3 || pixels < 655360 || pixels > 8294400) throw requestError('图片尺寸超出模型支持范围');
  return size;
}

export function requestError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw requestError(`${name} 必须是对象`);
  return value;
}

function text(value, name, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw requestError(`${name} 无效或过长`);
  return value;
}

function choice(value, values, fallback, name) {
  if (value === undefined) return fallback;
  if (!values.includes(value)) throw requestError(`${name} 不支持此选项`);
  return value;
}

function id(value, name, required = false) {
  const result = text(value, name, 128, required);
  if (result && !/^[a-zA-Z0-9_-]+$/.test(result)) throw requestError(`${name} 格式无效`);
  return result;
}

function image(value, name) {
  const result = text(value, name, Math.ceil(MAX_REFERENCE_BYTES * 4 / 3) + 128, true);
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(result)) throw requestError(`${name} 必须是 PNG, JPEG 或 WebP 图片`);
  return result;
}

function reference(value, name) {
  object(value, name);
  onlyKeys(value, ['id', 'name', 'dataUrl', 'recordId'], name);
  return { id: id(value.id, '参考图 ID', true), name: text(value.name, '参考图名称', 200, true), dataUrl: image(value.dataUrl, name), ...(value.recordId ? { recordId: id(value.recordId, '作品 ID') } : {}) };
}

function onlyKeys(value, keys, name) {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) throw requestError(`${name} 包含不支持的字段: ${unknown.join(', ')}`);
}

/** Keep one validated domain contract for browser requests and provider adapters. */
export function validateGenerationSubmission(value) {
  const input = object(value, '请求');
  onlyKeys(input, ['requestId', 'request', 'clientContext', 'providerId', 'referenceJobId', 'referenceImage', 'retryOf', 'creditQuote'], '请求');
  const request = object(input.request, '生成参数');
  onlyKeys(request, ['prompt', 'size', 'quality', 'outputFormat', 'background', 'outputCompression', 'references', 'mask'], '生成参数');
  const references = request.references ?? [];
  if (!Array.isArray(references) || references.length > MAX_REFERENCE_IMAGES) throw requestError(`最多使用 ${MAX_REFERENCE_IMAGES} 张参考图`);
  const normalized = {
    prompt: text(request.prompt, '提示词', MAX_PROMPT_LENGTH, true).trim(),
    size: validateImageSize(request.size ?? GENERATION_DEFAULTS.size),
    quality: choice(request.quality, ['auto', 'low', 'medium', 'high'], GENERATION_DEFAULTS.quality, '质量'),
    outputFormat: choice(request.outputFormat, ['png', 'jpeg', 'webp'], GENERATION_DEFAULTS.outputFormat, '文件格式'),
    background: choice(request.background, ['auto', 'opaque', 'transparent'], GENERATION_DEFAULTS.background, '背景'),
    outputCompression: request.outputCompression ?? GENERATION_DEFAULTS.outputCompression,
    references: references.map((ref, index) => reference(ref, `参考图 ${index + 1}`)),
  };
  if (!Number.isInteger(normalized.outputCompression) || normalized.outputCompression < 0 || normalized.outputCompression > 100) throw requestError('压缩质量必须为 0 到 100 的整数');
  if (normalized.background === 'transparent' && normalized.outputFormat === 'jpeg') throw requestError('透明背景请选择 PNG 或 WebP');
  if (request.mask) {
    if (input.referenceJobId || input.referenceImage) throw requestError('蒙版重绘请直接选择本地原图');
    if (!normalized.references.length) throw requestError('局部重绘需要参考图');
    if (normalized.references.length !== 1) throw requestError('局部重绘只能使用一张原图, 请先选择要编辑的图片');
    normalized.mask = image(request.mask, '蒙版');
    if (!normalized.mask.startsWith('data:image/png;')) throw requestError('蒙版必须使用带透明通道的 PNG');
  }
  const context = object(input.clientContext, '作品信息');
  onlyKeys(context, ['kind', 'placeholderId', 'prompt', 'mode', 'seriesId', 'masterPrompt', 'sceneId', 'sceneIndex', 'version', 'parentId', 'template', 'styleId', 'styleName', 'tone', 'batchId'], '作品信息');
  const clientContext = {
    kind: choice(context.kind, ['single', 'series'], 'single', '作品类型'),
    placeholderId: id(context.placeholderId, '作品 ID', true),
    prompt: text(context.prompt, '原始提示词', MAX_PROMPT_LENGTH, true),
    mode: normalized.mask ? 'edit' : normalized.references.length || input.referenceJobId || input.referenceImage ? 'reference' : 'text',
  };
  for (const key of ['seriesId', 'sceneId', 'parentId', 'styleId', 'batchId']) if (context[key]) clientContext[key] = id(context[key], key);
  for (const [key, max] of [['masterPrompt', MAX_PROMPT_LENGTH], ['styleName', 200], ['tone', 80]]) if (context[key]) clientContext[key] = text(context[key], key, max);
  if (context.template) clientContext.template = choice(context.template, SERIES_TEMPLATES, '', '系列模板');
  for (const key of ['sceneIndex', 'version']) {
    if (context[key] !== undefined) {
      if (!Number.isInteger(context[key]) || context[key] < 0 || context[key] > 100000) throw requestError(`${key} 无效`);
      clientContext[key] = context[key];
    }
  }
  if (clientContext.kind === 'series' && (!clientContext.seriesId || !clientContext.sceneId)) throw requestError('系列任务需要系列和分镜信息');
  if (input.referenceImage && !input.referenceJobId && clientContext.kind !== 'series') throw requestError('单图的恢复参考图片需要对应的参考任务');
  if (clientContext.kind !== 'series' && input.referenceJobId && normalized.references.length >= MAX_REFERENCE_IMAGES) throw requestError(`首镜参考和上传参考图合计最多 ${MAX_REFERENCE_IMAGES} 张`);
  return {
    requestId: id(input.requestId, '请求 ID', true), request: normalized, clientContext,
    ...(input.creditQuote ? { creditQuote: validateCreditQuote(input.creditQuote) } : {}),
    ...(input.providerId ? { providerId: id(input.providerId, '通道 ID') } : {}),
    ...(input.referenceJobId ? { referenceJobId: id(input.referenceJobId, '参考任务 ID') } : {}),
    ...(input.referenceImage ? { referenceImage: reference(input.referenceImage, '首镜参考图片') } : {}),
    ...(input.retryOf ? { retryOf: id(input.retryOf, '原任务 ID') } : {}),
  };
}

export function generationRecipe(input, provider = {}) {
  const { references, mask, ...parameters } = input.request;
  return {
    version: 1, ...parameters, model: provider.imageModel || '', providerId: provider.id || '',
    providerName: provider.name || '', generationMode: provider.generationMode || '',
    styleId: input.clientContext.styleId || '', styleName: input.clientContext.styleName || '', tone: input.clientContext.tone || '',
    references: references.map(({ dataUrl: _image, ...ref }) => ref), hasMask: Boolean(mask),
    ...(input.referenceJobId ? { referenceJobId: input.referenceJobId } : {}),
    ...(input.referenceImage ? { referenceImage: { id: input.referenceImage.id, name: input.referenceImage.name, ...(input.referenceImage.recordId ? { recordId: input.referenceImage.recordId } : {}) } } : {}),
  };
}

export function toImagesPayload(input) {
  const r = input.request;
  const payload = { prompt: r.prompt, n: 1, size: r.size, quality: r.quality, output_format: r.outputFormat, background: r.background };
  if (r.outputFormat === 'jpeg' || r.outputFormat === 'webp') payload.output_compression = r.outputCompression;
  const references = input.referenceImage ? [...r.references, input.referenceImage] : r.references;
  if (references.length) payload.ref_images = references.map((ref, index) => ({ name: ref.name, image_url: ref.dataUrl, ...(index === 0 && r.mask ? { mask_url: r.mask } : {}) }));
  return payload;
}
