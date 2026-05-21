const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const els = {
  tabs: $$('.tab-button'),
  authOverlay: $('#authOverlay'),
  authForm: $('#authForm'),
  authPassword: $('#authPassword'),
  authSubmitBtn: $('#authSubmitBtn'),
  authStatus: $('#authStatus'),
  tabDraw: $('#tabDraw'),
  tabSeries: $('#tabSeries'),
  tabSplit: $('#tabSplit'),
  tabGallery: $('#tabGallery'),
  topGalleryBadge: $('#topGalleryBadge'),
  form: $('#controlForm'),
  baseUrl: $('#baseUrl'),
  apiKey: $('#apiKey'),
  pwdToggle: $('#pwdToggle'),
  textModel: $('#textModel'),
  modelPanel: $('#modelPanel'),
  configStatus: $('#configStatus'),
  configSummary: $('#configSummary'),
  prompt: $('#prompt'),
  providerSelect: $('#providerSelect'),
  seriesProviderSelect: $('#seriesProviderSelect'),
  optimizeBtn: $('#optimizeBtn'),
  restorePromptBtn: $('#restorePromptBtn'),
  generationMode: $('#generationMode'),
  imageModel: $('#imageModel'),
  imageCount: $('#imageCount'),
  aspectRatio: $('#aspectRatio'),
  imageQuality: $('#imageQuality'),
  outputFormat: $('#outputFormat'),
  background: $('#background'),
  outputCompression: $('#outputCompression'),
  imageFile: $('#imageFile'),
  thumbRow: $('#thumbRow'),
  thumbAdd: $('#thumbAdd'),
  clearRefsBtn: $('#clearRefsBtn'),
  genBtn: $('#genBtn'),
  resultGrid: $('#resultGrid'),
  resultEmpty: $('#resultEmpty'),
  clearResultsBtn: $('#clearResultsBtn'),
  runSummary: $('#runSummary'),
  statusBar: $('#statusBar'),
  progressPanel: $('#progressPanel'),
  progressTitle: $('#progressTitle'),
  progressDetail: $('#progressDetail'),
  progressMeta: $('#progressMeta'),
  progressFill: $('#progressFill'),
  progressSteps: $('#progressSteps'),
  loadingMini: $('#loadingMini'),
  statEvents: $('#statEvents'),
  statTextLen: $('#statTextLen'),
  statElapsed: $('#statElapsed'),
  eventLog: $('#eventLog'),
  textStream: $('#textStream'),
  galleryGrid: $('#galleryGrid'),
  galleryCount: $('#galleryCount'),
  galleryEmpty: $('#galleryEmpty'),
  clearGalleryBtn: $('#clearGalleryBtn'),
  seriesForm: $('#seriesForm'),
  seriesType: $('#seriesType'),
  seriesAspectRatio: $('#seriesAspectRatio'),
  seriesImageQuality: $('#seriesImageQuality'),
  seriesOutputFormat: $('#seriesOutputFormat'),
  seriesBackground: $('#seriesBackground'),
  seriesOutputCompression: $('#seriesOutputCompression'),
  seriesBriefTitle: $('#seriesBriefTitle'),
  seriesBriefHelp: $('#seriesBriefHelp'),
  seriesAudienceLabel: $('#seriesAudienceLabel'),
  seriesBriefLabel: $('#seriesBriefLabel'),
  seriesPlanTitle: $('#seriesPlanTitle'),
  seriesPlanHelp: $('#seriesPlanHelp'),
  seriesTitle: $('#seriesTitle'),
  seriesAudience: $('#seriesAudience'),
  seriesProductBrief: $('#seriesProductBrief'),
  seriesStylePrompt: $('#seriesStylePrompt'),
  seriesPagePlan: $('#seriesPagePlan'),
  seriesCountHint: $('#seriesCountHint'),
  seriesPlanBtn: $('#seriesPlanBtn'),
  seriesOptimizeBtn: $('#seriesOptimizeBtn'),
  seriesGenBtn: $('#seriesGenBtn'),
  seriesImageFile: $('#seriesImageFile'),
  seriesThumbRow: $('#seriesThumbRow'),
  seriesThumbAdd: $('#seriesThumbAdd'),
  seriesClearRefsBtn: $('#seriesClearRefsBtn'),
  seriesRunSummary: $('#seriesRunSummary'),
  seriesStatusBar: $('#seriesStatusBar'),
  seriesResultGrid: $('#seriesResultGrid'),
  seriesResultEmpty: $('#seriesResultEmpty'),
  seriesClearResultsBtn: $('#seriesClearResultsBtn'),
  splitFile: $('#splitFile'),
  splitUploadBtn: $('#splitUploadBtn'),
  splitGalleryBtn: $('#splitGalleryBtn'),
  splitGalleryPicker: $('#splitGalleryPicker'),
  splitRows: $('#splitRows'),
  splitCols: $('#splitCols'),
  splitMarginX: $('#splitMarginX'),
  splitMarginY: $('#splitMarginY'),
  splitGapX: $('#splitGapX'),
  splitGapY: $('#splitGapY'),
  splitFormat: $('#splitFormat'),
  splitQuality: $('#splitQuality'),
  splitDownloadAllBtn: $('#splitDownloadAllBtn'),
  splitClearBtn: $('#splitClearBtn'),
  splitSourceInfo: $('#splitSourceInfo'),
  splitStatus: $('#splitStatus'),
  splitPreview: $('#splitPreview'),
  previewOverlay: $('#previewOverlay'),
  previewImg: $('#previewImg'),
};

const SETTINGS_KEY = 'img_gen_studio_settings_v2';
const DB_NAME = 'img-gen-gallery';
const DB_VERSION = 2;
const MAX_REF_SIZE = 50 * 1024 * 1024;

let refImages = [];
let seriesRefImages = [];
let gallery = [];
let currentResults = [];
let seriesResults = [];
let splitSource = null;
let splitSlices = [];
let originalPrompt = '';
let originalSeriesStyle = '';
let eventCount = 0;
let collectedText = [];
let timerInterval = null;
let startTime = 0;
let progressInterval = null;
let abortController = null;
let activeTaskCount = 0;
let serverProviders = [];
let preferredProviderId = '';
let serverDefaultProviderId = '';
let serverTextProviderName = '文本服务商';
let previewScale = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let panStartX = 0;
let panStartY = 0;

function normalizeBaseUrl(input) {
  let base = String(input || '').trim();
  if (!base) throw new Error('Base URL 不能为空');
  if (!/^https?:\/\//i.test(base)) throw new Error('Base URL 必须以 http:// 或 https:// 开头');
  base = base.replace(/\/+$/, '');
  if (base.endsWith('/v1')) base = base.slice(0, -3);
  return base;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function normalizeOutputFormat(format) {
  return ['auto', 'png', 'jpeg', 'webp'].includes(format) ? format : 'auto';
}

function mimeFromFormat(format) {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

function formatFromMime(mime) {
  const normalized = String(mime || '').toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpeg';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('png')) return 'png';
  return 'png';
}

function extFromFormat(format) {
  const normalized = normalizeOutputFormat(format);
  if (normalized === 'jpeg') return 'jpg';
  if (normalized === 'webp') return 'webp';
  return 'png';
}

function padBase64(value) {
  const clean = String(value || '').replace(/\s/g, '');
  return clean + '='.repeat((4 - (clean.length % 4)) % 4);
}

function mimeFromBase64(base64, fallbackFormat = 'png') {
  try {
    const prefix = atob(padBase64(String(base64 || '').slice(0, 64)));
    const byte = (index) => prefix.charCodeAt(index);
    if (byte(0) === 0x89 && prefix.slice(1, 4) === 'PNG') return 'image/png';
    if (byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff) return 'image/jpeg';
    if (prefix.slice(0, 4) === 'RIFF' && prefix.slice(8, 12) === 'WEBP') return 'image/webp';
  } catch {}
  return mimeFromFormat(fallbackFormat);
}

function dataUrlFormat(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)[;,]/i);
  return formatFromMime(match?.[1]);
}

function shouldSendCompression(format) {
  return format === 'jpeg' || format === 'webp';
}

function formatBytes(bytes) {
  const kb = bytes / 1024;
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
}

const ASPECT_RATIOS = {
  '1:1': [1, 1],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '4:3': [4, 3],
  '3:4': [3, 4],
  '3:2': [3, 2],
  '2:3': [2, 3],
};

const RATIO_REQUEST_SIZES = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '4:3': '1536x1024',
  '3:4': '1024x1536',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
};

function sizeLabel(size) {
  if (size === 'auto') return '自动尺寸';
  return String(size || '未知尺寸').replace('x', '×');
}

function actualSizeLabel(record) {
  if (record.actualWidth && record.actualHeight) return `${record.actualWidth}×${record.actualHeight}`;
  return sizeLabel(record.size);
}

function metaSizeLabel(record) {
  const actual = actualSizeLabel(record);
  const requested = sizeLabel(record.requestSize || record.size);
  return record.requestSize && record.requestSize !== 'auto' ? `${actual} · 请求 ${requested}` : actual;
}

function resolveSpecFromRatio(aspectRatio) {
  const ratio = aspectRatio || 'auto';
  if (ratio === 'auto') return { aspectRatio: ratio, requestSize: 'auto', sizeHint: '' };
  if (!RATIO_REQUEST_SIZES[ratio]) throw new Error('请选择有效的画面比例');
  return {
    aspectRatio: ratio,
    requestSize: RATIO_REQUEST_SIZES[ratio],
    sizeHint: `\n画幅要求: 画面比例 ${ratio}. 请按该画幅构图, 主体保持完整, 不要贴边。`,
  };
}

function resolveImageSpec() {
  return resolveSpecFromRatio(els.aspectRatio.value);
}

function isGptImage2(model) {
  return /^gpt-image-2(?:-|$)/i.test(String(model || '').trim());
}

function parseSize(size) {
  const match = String(size || '').match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function normalizeCompression(value, outputFormat) {
  const compressionInput = String(value ?? '').trim();
  let outputCompression = compressionInput === '' ? 90 : Number(compressionInput);
  if (shouldSendCompression(outputFormat)) {
    if (!Number.isFinite(outputCompression) || outputCompression < 0 || outputCompression > 100) throw new Error('压缩质量必须是 0 到 100 的数字');
  } else if (!Number.isFinite(outputCompression)) {
    outputCompression = 90;
  }
  return outputCompression;
}

function qualityLabel(quality) {
  const labels = {
    auto: '自动细节',
    low: '低细节 · 更快',
    medium: '中细节 · 均衡',
    high: '高细节 · 更多细节',
  };
  return labels[quality] || quality || '未知质量';
}

function readImageSize(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });
}

function downloadFilename(format, index = 1) {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `img-${stamp}-${index}.${extFromFormat(format)}`;
}

function readSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch {}
  preferredProviderId = saved.providerId || '';
  els.baseUrl.value = '/api';
  els.apiKey.value = '__server__';
  els.textModel.value = 'gpt-5-mini';
  els.generationMode.value = 'images';
  els.imageModel.value = 'gpt-image-2';
  els.imageCount.value = saved.imageCount || '1';
  els.aspectRatio.value = saved.aspectRatio || '1:1';
  els.imageQuality.value = saved.imageQuality || 'auto';
  els.outputFormat.value = normalizeOutputFormat(saved.outputFormat || 'auto');
  els.background.value = saved.background || 'auto';
  els.outputCompression.value = saved.outputCompression || '90';
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    providerId: selectedProviderId(),
    imageCount: els.imageCount.value,
    aspectRatio: els.aspectRatio.value,
    imageQuality: els.imageQuality.value,
    outputFormat: els.outputFormat.value,
    background: els.background.value,
    outputCompression: els.outputCompression.value,
  }));
}

function selectedProviderId() {
  return '';
}

function findServerProvider(providerId) {
  return serverProviders.find((provider) => provider.id === providerId) || serverProviders[0] || null;
}

function providerHeader(config) {
  return config.providerId ? { 'X-Provider-Id': config.providerId } : {};
}

function renderProviderOptions(select, selectedId) {
  if (!select) return;
  select.innerHTML = serverProviders.map((provider) => {
    const label = `${provider.name} · ${provider.imageModel || '未配置生图模型'}`;
    return `<option value="${escapeHtml(provider.id)}">${escapeHtml(label)}</option>`;
  }).join('');
  if (serverProviders.length) select.value = findServerProvider(selectedId)?.id || serverProviders[0].id;
  select.disabled = serverProviders.length <= 1;
}

function applyProviderSelection(providerId, persist = true) {
  const provider = findServerProvider(providerId);
  if (!provider) return;
  preferredProviderId = provider.id;
  if (els.providerSelect) els.providerSelect.value = provider.id;
  if (els.seriesProviderSelect) els.seriesProviderSelect.value = provider.id;
  els.baseUrl.value = '/api';
  els.apiKey.value = '__server__';
  els.textModel.value = provider.textModel || 'gpt-5-mini';
  els.imageModel.value = provider.imageModel || 'gpt-image-2';
  els.generationMode.value = provider.generationMode || 'images';
  if (els.configStatus) els.configStatus.textContent = '后台自动调度已启用';
  if (els.configSummary) els.configSummary.textContent = `生图会由服务端自动选择空闲上游, 提示词优化固定使用文本服务商 ${serverTextProviderName}. API Key 只保存在本地服务端配置文件中.`;
  if (persist) saveSettings();
}

function renderProviderSelectors(config) {
  serverTextProviderName = config.textProviderName || '文本服务商';
  serverProviders = Array.isArray(config.providers) && config.providers.length
    ? config.providers
    : [{
      id: config.activeProvider || 'default',
      name: '默认生图服务商',
      textModel: config.textModel,
      imageModel: config.imageModel,
      generationMode: config.generationMode,
    }];
  serverDefaultProviderId = config.defaultProvider || config.activeProvider || serverProviders[0]?.id || '';
  const selectedId = preferredProviderId || config.activeProvider || serverDefaultProviderId;
  renderProviderOptions(els.providerSelect, selectedId);
  renderProviderOptions(els.seriesProviderSelect, selectedId);
  applyProviderSelection(selectedId, false);
}

async function loadServerConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || `HTTP ${response.status}`);
    els.baseUrl.value = config.baseUrl || '/api';
    els.apiKey.value = '__server__';
    renderProviderSelectors(config);
  } catch (error) {
    if (els.configStatus) els.configStatus.textContent = '本地配置未加载';
    if (els.configSummary) els.configSummary.textContent = `请启动本地服务并检查 config/local.config.json: ${error.message || error}`;
  }
}

function isProxyBaseUrl(baseUrl) {
  return String(baseUrl || '').startsWith('/api');
}

function apiEndpoint(config, v1Path) {
  if (isProxyBaseUrl(config.baseUrl)) return `${config.baseUrl}${v1Path.replace(/^\/v1/, '')}`;
  return `${config.baseUrl}${v1Path}`;
}

function cleanHtmlError(body) {
  return String(body || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function friendlyHttpError(status, detail = '') {
  const compact = cleanHtmlError(detail);
  if (status === 524 || /\b524\b|timeout occurred|origin web server timed out/i.test(compact)) {
    return '上游服务超时 524: ioll.pp.ua 在 Cloudflare 等待时间内没有返回结果. 这通常是上游图片生成耗时过长或服务繁忙, 不是当前页面参数错误. 建议稍后重试, 减少系列页数, 或改用更稳定的 API 上游.';
  }
  if (status === 429) return '上游限流 429: 请求过快或额度不足, 请稍后重试或降低连续生成数量.';
  if ([500, 502, 503, 504].includes(status)) return `上游服务暂时不可用 ${status}: 请稍后重试或更换 API 上游.`;
  return compact.slice(0, 360) || `HTTP ${status}`;
}

async function parseErrorResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text().catch(() => '');
  if (contentType.includes('application/json')) {
    try {
      const data = JSON.parse(body);
      const message = data?.error || data?.message;
      if (message) return friendlyHttpError(response.status, message);
    } catch {}
  }
  return friendlyHttpError(response.status, body || response.statusText || '无错误正文');
}

function isRetryableHttpStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504, 524].includes(status);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(label, makeRequest, maxRetries = 1) {
  let lastResponse = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await makeRequest();
    if (response.ok) return response;
    lastResponse = response;
    if (attempt < maxRetries && isRetryableHttpStatus(response.status)) {
      appendEvent('event', `${label} 返回 HTTP ${response.status}, 等待后自动重试 ${attempt + 1}/${maxRetries}`);
      updateProgress('上游响应较慢', `${label} 返回 HTTP ${response.status}, 正在自动重试.`, 1);
      await sleep(1200 * (attempt + 1));
      continue;
    }
    break;
  }
  throw new Error(`HTTP ${lastResponse.status}: ${await parseErrorResponse(lastResponse)}`);
}

function getConfig(options = {}) {
  const requireTextModel = Boolean(options.requireTextModel);
  const rawBaseUrl = els.baseUrl.value.trim() || '/api';
  const baseUrl = isProxyBaseUrl(rawBaseUrl) ? rawBaseUrl.replace(/\/+$/, '') : normalizeBaseUrl(rawBaseUrl);
  const apiKey = els.apiKey.value.trim();
  if (!isProxyBaseUrl(baseUrl) && !apiKey) throw new Error('请填写 API Key');
  const providerId = selectedProviderId();
  const textModel = els.textModel.value.trim();
  let generationMode = els.generationMode.value;
  let imageModel = els.imageModel.value.trim();

  // 自动处理图生图的 AnyRouter 路由：如果存在参考图，强制使用 responses 模式（前提是后台配了）
  const refs = options.refImages || (typeof refImages !== 'undefined' ? refImages : []);
  if (refs && refs.length > 0) {
    const responsesProvider = (typeof serverProviders !== 'undefined' ? serverProviders : []).find(p => p.generationMode === 'responses');
    if (responsesProvider) {
      generationMode = 'responses';
      imageModel = responsesProvider.imageModel || imageModel;
    }
  }

  const prompt = String(options.promptOverride ?? els.prompt.value).trim();
  if (!prompt) throw new Error('请填写提示词');
  if (requireTextModel && !textModel) throw new Error('请填写文本模型, 用于提示词优化和 Responses 工具模式');
  if (generationMode === 'images' && !imageModel) throw new Error('请填写图片模型, 例如 gpt-image-2');
  if (generationMode === 'responses' && !imageModel) throw new Error('Responses 工具模式需要生图模型, 例如 gpt-5.3-codex');
  const outputFormat = normalizeOutputFormat(els.outputFormat.value);
  const outputCompression = normalizeCompression(els.outputCompression.value, outputFormat);
  if (outputFormat === 'jpeg' && els.background.value === 'transparent') {
    throw new Error('JPEG 不支持透明背景, 请改用 PNG/WebP 或选择不透明背景');
  }
  const spec = resolveImageSpec();
  return {
    apiKey,
    baseUrl,
    providerId,
    textModel,
    generationMode,
    imageModel,
    prompt,
    imageCount: Number(options.imageCountOverride ?? els.imageCount.value),
    size: spec.requestSize,
    requestSize: spec.requestSize,
    aspectRatio: spec.aspectRatio,
    sizeHint: spec.sizeHint,
    quality: els.imageQuality.value,
    outputFormat,
    background: els.background.value,
    outputCompression,
    refImages: options.refImagesOverride || refImages,
  };
}

function headers(apiKey, stream = true) {
  return {
    Authorization: `Bearer ${apiKey}`,
    accept: stream ? 'text/event-stream' : 'application/json',
    'Content-Type': 'application/json',
  };
}

function jsonHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function requestHeaders(config, stream = false) {
  if (isProxyBaseUrl(config.baseUrl)) {
    return stream
      ? { ...providerHeader(config), accept: 'text/event-stream', 'Content-Type': 'application/json' }
      : { ...providerHeader(config), 'Content-Type': 'application/json' };
  }
  return stream ? headers(config.apiKey, true) : jsonHeaders(config.apiKey);
}

function buildImageTool(config) {
  const tool = { type: 'image_generation' };
  if (config.outputFormat !== 'auto') tool.output_format = config.outputFormat;
  if (config.requestSize !== 'auto') tool.size = config.requestSize;
  if (config.quality !== 'auto') tool.quality = config.quality;
  if (config.background !== 'auto') tool.background = config.background;
  if (shouldSendCompression(config.outputFormat)) tool.output_compression = config.outputCompression;
  return tool;
}

function buildImagePayload(config, runIndex) {
  const refs = config.refImages || refImages;
  const suffix = `${config.sizeHint || ''}${config.imageCount > 1 ? `\n这是第 ${runIndex + 1} 张, 请在构图和细节上做自然变化, 不要重复上一张。` : ''}`;
  if (refs.length > 0) {
    const content = refs.map((ref) => ({ type: 'input_image', image_url: ref.dataUrl }));
    content.push({
      type: 'input_text',
      text: `请根据参考图片生成新图片。要求: ${config.prompt}${suffix}`,
    });
    return {
      model: config.imageModel,
      input: [{ role: 'user', content }],
      tools: [buildImageTool(config)],
      stream: true,
    };
  }
  return {
    model: config.imageModel,
    input: [
      {
        role: 'system',
        content: '你是一个图片生成助手。用户要求生成图片时, 必须调用 image_generation 工具直接生成图片, 不要只用文字描述。',
      },
      { role: 'user', content: `请生成以下描述的图片: ${config.prompt}${suffix}` },
    ],
    tools: [buildImageTool(config)],
    stream: true,
  };
}

function buildOptimizePayload(config) {
  return {
    model: config.textModel,
    input: [
      {
        role: 'system',
        content: `You are an expert prompt writer for gpt-image-2, OpenAI's latest image generation model that understands natural language fluently. Rewrite the user input into a single vivid English image prompt optimized for gpt-image-2. Rules: write in natural descriptive English sentences NOT comma-separated keyword tags; be concise but specific in 2-4 sentences; focus on subject, action, mood, environment, lighting, color palette, art style; do NOT add generic quality boosters like 8K ultra-detailed masterpiece; if the input is ad copy convert it to a visual scene and note any on-image text as "Text overlay: ..."; output only the final prompt with no explanation or markdown.`
      },
      { role: 'user', content: config.prompt },
    ],
    stream: false,
  };
}

function buildImagesPayload(config, count = config.imageCount, runIndex = 0) {
  const suffix = `${config.sizeHint || ''}${config.imageCount > 1 ? `\n这是第 ${runIndex + 1} 张, 请在构图和细节上做自然变化, 不要重复上一张。` : ''}`;
  const body = {
    model: config.imageModel,
    prompt: `${config.prompt}${suffix}`,
    n: count,
  };
  if (config.outputFormat !== 'auto') body.output_format = config.outputFormat;
  if (config.requestSize !== 'auto') body.size = config.requestSize;
  if (config.quality !== 'auto') body.quality = config.quality;
  if (config.background !== 'auto') body.background = config.background;
  if (shouldSendCompression(config.outputFormat)) body.output_compression = config.outputCompression;
  return body;
}

function appendImagesFormValue(formData, key, value) {
  if (value !== undefined && value !== null && value !== 'auto') formData.append(key, String(value));
}

function buildImagesEditFormData(config, count = config.imageCount, runIndex = 0) {
  const refs = config.refImages || refImages;
  const suffix = `${config.sizeHint || ''}${config.imageCount > 1 ? `\n这是第 ${runIndex + 1} 张, 请在构图和细节上做自然变化, 不要重复上一张。` : ''}`;
  const formData = new FormData();
  formData.append('model', config.imageModel);
  formData.append('prompt', `${config.prompt}${suffix}`);
  appendImagesFormValue(formData, 'n', count);
  appendImagesFormValue(formData, 'size', config.requestSize);
  appendImagesFormValue(formData, 'quality', config.quality);
  appendImagesFormValue(formData, 'background', config.background);
  appendImagesFormValue(formData, 'output_format', config.outputFormat);
  if (shouldSendCompression(config.outputFormat)) appendImagesFormValue(formData, 'output_compression', config.outputCompression);
  refs.forEach((ref) => formData.append('image', ref.file, ref.name));
  return formData;
}

function extractImagesDataUrls(data, format) {
  if (!Array.isArray(data?.data)) return [];
  return data.data
    .map((item) => item?.b64_json ? `data:${mimeFromBase64(item.b64_json, format)};base64,${item.b64_json}` : null)
    .filter(Boolean);
}

async function urlToDataUrl(url, format) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片 URL 下载失败: HTTP ${response.status}`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('图片 URL 转换失败'));
    reader.readAsDataURL(blob.type ? blob : new Blob([blob], { type: mimeFromFormat(format) }));
  });
}

async function extractImagesApiResults(data, format) {
  const b64Results = extractImagesDataUrls(data, format);
  if (b64Results.length) return b64Results;
  if (!Array.isArray(data?.data)) return [];
  const urlResults = data.data.map((item) => item?.url).filter(Boolean);
  return Promise.all(urlResults.map((url) => urlToDataUrl(url, format)));
}

function extractText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const chunks = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') {
      if ((value.type === 'output_text' || value.type === 'text') && typeof value.text === 'string') chunks.push(value.text);
      Object.values(value).forEach(visit);
    }
  };
  visit(data.output || data);
  return chunks.join('').trim();
}

function cleanOptimizedPrompt(text) {
  return String(text || '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/i, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[-*]\s*如果你想/i.test(line) && !/^如果你想/i.test(line) && !/^我可以再/i.test(line))
    .join('\n')
    .replace(/^优化后的?提示词[:：]\s*/i, '')
    .trim();
}

function validateOptimizedPrompt(text) {
  const raw = String(text || '').trim();
  if (/如果你想|我可以再帮你|三条|版本|社交媒体易传播|Could you provide|didn’t include/i.test(raw)) {
    const cleaned = cleanOptimizedPrompt(raw);
    if (cleaned && cleaned !== raw) return cleaned;
    throw new Error('模型返回了对话式文案, 不是图片提示词. 请稍后重试或补充更明确的画面需求.');
  }
  const value = cleanOptimizedPrompt(raw);
  if (!value) throw new Error('模型没有返回优化后的提示词');
  return value;
}

function extractBase64AsDataUrl(dataObj, format) {
  if (dataObj == null) return null;
  if (Array.isArray(dataObj)) {
    for (const item of dataObj) {
      const found = extractBase64AsDataUrl(item, format);
      if (found) return found;
    }
    return null;
  }
  if (typeof dataObj === 'object') {
    for (const [key, value] of Object.entries(dataObj)) {
      if ((key === 'result' || key === 'image_base64') && typeof value === 'string' && value.length > 1000) {
        return `data:${mimeFromBase64(value, format)};base64,${value}`;
      }
      const found = extractBase64AsDataUrl(value, format);
      if (found) return found;
    }
  }
  return null;
}

function dataUrlToBlob(dataUrl, format) {
  const base64 = dataUrl.split(',')[1];
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let index = 0; index < byteChars.length; index += 1) bytes[index] = byteChars.charCodeAt(index);
  return new Blob([bytes], { type: mimeFromFormat(dataUrlFormat(dataUrl) || format) });
}

function shouldPostProcess(config, dataUrl) {
  const targetFormat = normalizeOutputFormat(config.outputFormat);
  return targetFormat !== 'auto' && targetFormat !== dataUrlFormat(dataUrl);
}

function canvasToDataUrl(canvas, format, compression) {
  const normalized = normalizeOutputFormat(format);
  const mime = mimeFromFormat(normalized === 'auto' ? 'png' : normalized);
  const quality = shouldSendCompression(normalized) ? Math.max(0, Math.min(1, compression / 100)) : undefined;
  return canvas.toDataURL(mime, quality);
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片后处理加载失败'));
    image.src = dataUrl;
  });
}

async function postProcessDataUrl(dataUrl, config) {
  const actualSize = await readImageSize(dataUrl);
  if (!shouldPostProcess(config, dataUrl)) return { dataUrl, originalSize: actualSize };
  const image = await imageFromDataUrl(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (config.background === 'opaque' || config.outputFormat === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0);
  return {
    dataUrl: canvasToDataUrl(canvas, config.outputFormat, config.outputCompression),
    originalSize: actualSize,
  };
}

function markTaskActive(isActive) {
  activeTaskCount = Math.max(0, activeTaskCount + (isActive ? 1 : -1));
}

function hasActiveTask() {
  return activeTaskCount > 0;
}

function setBusy(isBusy) {
  const controls = [
    els.providerSelect,
    els.seriesProviderSelect,
    els.baseUrl,
    els.apiKey,
    els.textModel,
    els.generationMode,
    els.imageModel,
    els.prompt,
    els.optimizeBtn,
    els.restorePromptBtn,
    els.imageCount,
    els.aspectRatio,
    els.imageQuality,
    els.outputFormat,
    els.background,
    els.outputCompression,
    els.thumbAdd,
    els.clearRefsBtn,
    els.seriesPlanBtn,
    els.seriesOptimizeBtn,
    els.seriesGenBtn,
    els.seriesThumbAdd,
    els.seriesClearRefsBtn,
  ].filter(Boolean);
  controls.forEach((control) => { control.disabled = isBusy; });
  els.genBtn.disabled = isBusy;
  els.genBtn.textContent = isBusy ? '生成中...' : '生成图片';
  if (els.seriesGenBtn) {
    els.seriesGenBtn.disabled = isBusy;
    els.seriesGenBtn.textContent = isBusy ? '生成中...' : '生成序列图';
  }
}

function setStatus(type, message) {
  els.statusBar.className = `status-bar ${type}`;
  els.statusBar.textContent = message;
}

function clearStatus() {
  els.statusBar.className = 'status-bar';
  els.statusBar.textContent = '';
}

function setAuthStatus(type, message) {
  if (!els.authStatus) return;
  els.authStatus.className = `status-bar ${type}`;
  els.authStatus.textContent = message;
}

function showAuthOverlay(message = '') {
  if (!els.authOverlay) return;
  els.authOverlay.hidden = false;
  if (message) setAuthStatus('info', message);
  setTimeout(() => els.authPassword?.focus(), 30);
}

function hideAuthOverlay() {
  if (!els.authOverlay) return;
  els.authOverlay.hidden = true;
  if (els.authPassword) els.authPassword.value = '';
}

async function checkAuthStatus() {
  if (typeof fetch !== 'function') return true;
  try {
    const response = await fetch('/api/auth/status');
    if (!response.ok) return true;
    const status = await response.json();
    if (status.required && !status.authenticated) {
      // 尝试用保存的密码静默自动登录
      const savedPwd = (() => { try { return localStorage.getItem('_auth_pwd') || ''; } catch { return ''; } })();
      if (savedPwd) {
        const ok = await attemptLogin(savedPwd, true);
        if (ok) return true;
        // 保存的密码失效，清除并弹出密码框
        try { localStorage.removeItem('_auth_pwd'); } catch {}
      }
      showAuthOverlay('服务器已启用访问密码保护.');
      return false;
    }
    hideAuthOverlay();
    return true;
  } catch {
    return true;
  }
}

async function attemptLogin(password, silent = false) {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    // 登录成功，保存密码到 localStorage 方便下次自动登录
    try { localStorage.setItem('_auth_pwd', password); } catch {}
    hideAuthOverlay();
    await loadServerConfig();
    return true;
  } catch (error) {
    if (!silent) {
      setAuthStatus('err', error.message || String(error));
    }
    return false;
  }
}

async function loginWithPassword(event) {
  event.preventDefault();
  const password = els.authPassword?.value || '';
  if (!password) {
    setAuthStatus('err', '请输入访问密码.');
    return;
  }
  els.authSubmitBtn.disabled = true;
  els.authSubmitBtn.textContent = '验证中...';
  setAuthStatus('info', '正在验证访问密码...');
  const ok = await attemptLogin(password, false);
  if (!ok) {
    // 密码错误，清除保存的密码
    try { localStorage.removeItem('_auth_pwd'); } catch {}
  }
  els.authSubmitBtn.disabled = false;
  els.authSubmitBtn.textContent = '进入工作台';
}

function setSeriesStatus(type, message) {
  els.seriesStatusBar.className = `status-bar ${type}`;
  els.seriesStatusBar.textContent = message;
}

function clearSeriesStatus() {
  els.seriesStatusBar.className = 'status-bar';
  els.seriesStatusBar.textContent = '';
}

function startTimer() {
  startTime = Date.now();
  els.statElapsed.textContent = '0s';
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    els.statElapsed.textContent = `${Math.floor((Date.now() - startTime) / 1000)}s`;
  }, 500);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  if (startTime) els.statElapsed.textContent = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
}

function elapsedText() {
  if (!startTime) return '0s';
  return `${Math.floor((Date.now() - startTime) / 1000)}s`;
}

function startProgress(title, detail, steps = []) {
  clearInterval(progressInterval);
  els.progressPanel.classList.add('active', 'running');
  els.progressPanel.classList.remove('done', 'err');
  els.progressTitle.textContent = title;
  els.progressDetail.textContent = detail;
  els.progressMeta.textContent = '等待 0s';
  els.progressFill.style.width = '';
  els.progressSteps.innerHTML = steps.map((step, index) => `<span class="progress-step${index === 0 ? ' active' : ''}">${escapeHtml(step)}</span>`).join('');
  progressInterval = setInterval(() => {
    els.progressMeta.textContent = `等待 ${elapsedText()}`;
  }, 500);
}

function updateProgress(title, detail, activeStep = -1) {
  els.progressPanel.classList.add('active');
  els.progressTitle.textContent = title;
  els.progressDetail.textContent = detail;
  els.progressMeta.textContent = `等待 ${elapsedText()}`;
  if (activeStep >= 0) {
    els.progressSteps.querySelectorAll('.progress-step').forEach((step, index) => {
      step.classList.toggle('active', index === activeStep);
      step.classList.toggle('done', index < activeStep);
    });
  }
}

function finishProgress(type, title, detail) {
  clearInterval(progressInterval);
  progressInterval = null;
  els.progressPanel.classList.remove('running', 'done', 'err');
  els.progressPanel.classList.add('active', type);
  els.progressTitle.textContent = title;
  els.progressDetail.textContent = detail;
  els.progressMeta.textContent = `耗时 ${elapsedText()}`;
  els.progressFill.style.width = type === 'done' ? '100%' : '100%';
  els.progressSteps.querySelectorAll('.progress-step').forEach((step) => {
    step.classList.remove('active');
    if (type === 'done') step.classList.add('done');
  });
}

function hideProgress() {
  clearInterval(progressInterval);
  progressInterval = null;
  els.progressPanel.classList.remove('active', 'running', 'done', 'err');
}

function resetRunUi() {
  eventCount = 0;
  collectedText = [];
  els.eventLog.innerHTML = '';
  els.textStream.textContent = '';
  els.eventLog.classList.remove('active');
  els.textStream.classList.remove('active');
  els.loadingMini.classList.add('active');
  els.statEvents.textContent = '事件: 0';
  els.statTextLen.textContent = '文本: 0 字';
  els.runSummary.textContent = '正在生成...';
  clearStatus();
  startTimer();
}

function appendEvent(type, message) {
  eventCount += 1;
  els.statEvents.textContent = `事件: ${eventCount}`;
  els.eventLog.classList.add('active');
  const time = new Date().toTimeString().slice(0, 8);
  const tagClass = type === 'event' ? 'event-tag' : type === 'data' ? 'data-tag' : type === 'text' ? 'text-tag' : 'done-tag';
  const tagLabel = type === 'event' ? 'EVENT' : type === 'data' ? 'DATA' : type === 'text' ? 'TEXT' : 'DONE';
  const line = document.createElement('div');
  line.className = 'line';
  line.innerHTML = `<span class="ts">${time}</span><span class="tag ${tagClass}">${tagLabel}</span><span class="msg">${escapeHtml(message)}</span>`;
  els.eventLog.appendChild(line);
  els.eventLog.scrollTop = els.eventLog.scrollHeight;
}

function updateTextStream(delta) {
  collectedText.push(delta);
  els.textStream.classList.add('active');
  els.textStream.textContent += delta;
  els.textStream.scrollTop = els.textStream.scrollHeight;
  els.statTextLen.textContent = `文本: ${collectedText.join('').length} 字`;
}

function renderThumbnails() {
  els.thumbRow.querySelectorAll('.thumb-item').forEach((item) => item.remove());
  refImages.forEach((ref, index) => {
    const item = document.createElement('div');
    item.className = 'thumb-item';
    const image = document.createElement('img');
    image.src = ref.dataUrl;
    image.alt = `参考图 ${index + 1}`;
    image.addEventListener('click', () => openPreview(ref.dataUrl));
    const remove = document.createElement('button');
    remove.className = 'thumb-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      refImages.splice(index, 1);
      renderThumbnails();
    });
    item.append(image, remove);
    els.thumbRow.insertBefore(item, els.thumbAdd);
  });
}

function addRefFiles(files) {
  Array.from(files).forEach((file) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_REF_SIZE) {
      alert(`${file.name} 超过 50MB, 已跳过`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      refImages.push({ name: file.name, file, dataUrl: reader.result });
      renderThumbnails();
    };
    reader.readAsDataURL(file);
  });
  els.imageFile.value = '';
}

function clearRefImages() {
  refImages = [];
  renderThumbnails();
}

function renderSeriesThumbnails() {
  els.seriesThumbRow.querySelectorAll('.thumb-item').forEach((item) => item.remove());
  seriesRefImages.forEach((ref, index) => {
    const item = document.createElement('div');
    item.className = 'thumb-item series-thumb-item';
    const image = document.createElement('img');
    image.src = ref.dataUrl;
    image.alt = `系列参考图 ${index + 1}`;
    image.addEventListener('click', () => openPreview(ref.dataUrl));
    const remove = document.createElement('button');
    remove.className = 'thumb-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      seriesRefImages.splice(index, 1);
      renderSeriesThumbnails();
    });
    item.append(image, remove);
    els.seriesThumbRow.insertBefore(item, els.seriesThumbAdd);
  });
}

function addSeriesRefFiles(files) {
  Array.from(files).forEach((file) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_REF_SIZE) {
      alert(`${file.name} 超过 50MB, 已跳过`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      seriesRefImages.push({ name: file.name, file, dataUrl: reader.result });
      renderSeriesThumbnails();
    };
    reader.readAsDataURL(file);
  });
  els.seriesImageFile.value = '';
}

function clearSeriesRefImages() {
  seriesRefImages = [];
  renderSeriesThumbnails();
}

function renderResults() {
  els.resultGrid.innerHTML = '';
  els.resultEmpty.style.display = currentResults.length ? 'none' : '';
  currentResults.forEach((record, index) => {
    els.resultGrid.appendChild(createImageCard(record, index + 1, false));
  });
}

function renderSeriesResults() {
  els.seriesResultGrid.innerHTML = '';
  els.seriesResultEmpty.style.display = seriesResults.length ? 'none' : '';
  seriesResults.forEach((record, index) => {
    els.seriesResultGrid.appendChild(createImageCard(record, index + 1, false));
  });
}

function seriesResultIndexById(id) {
  return seriesResults.findIndex((record) => record.id === id);
}

function replaceSeriesResult(id, nextRecord) {
  const index = seriesResultIndexById(id);
  if (index >= 0) seriesResults.splice(index, 1, nextRecord);
  else seriesResults.push(nextRecord);
  renderSeriesResults();
}

function updateSeriesResult(id, patch) {
  const index = seriesResultIndexById(id);
  if (index < 0) return;
  seriesResults[index] = { ...seriesResults[index], ...patch };
  renderSeriesResults();
}

function createSeriesPlaceholder({ seriesId, seriesTitle, page, total, prompt, configSnapshot }) {
  return {
    id: `${seriesId}-${page.index + 1}`,
    status: 'pending',
    dataUrl: '',
    blob: null,
    prompt,
    configSnapshot,
    mode: (configSnapshot.refImages || []).length ? 'edit' : 'text',
    refDataUrls: (configSnapshot.refImages || []).map((ref) => ref.dataUrl),
    seriesId,
    seriesTitle,
    pageTitle: page.title,
    pageIndex: page.index + 1,
    pageTotal: total,
    page,
    size: configSnapshot.size,
    requestSize: configSnapshot.requestSize || configSnapshot.size,
    quality: configSnapshot.quality,
    format: configSnapshot.outputFormat === 'auto' ? 'png' : configSnapshot.outputFormat,
    time: new Date().toLocaleString('zh-CN'),
  };
}

function currentResultIndexById(id) {
  return currentResults.findIndex((record) => record.id === id);
}

function replaceCurrentResult(id, nextRecord) {
  const index = currentResultIndexById(id);
  if (index >= 0) currentResults.splice(index, 1, nextRecord);
  else currentResults.unshift(nextRecord);
  renderResults();
}

function updateCurrentResult(id, patch) {
  const index = currentResultIndexById(id);
  if (index < 0) return;
  currentResults[index] = { ...currentResults[index], ...patch };
  renderResults();
}

function createSinglePlaceholder({ id, configSnapshot, index }) {
  return {
    id,
    status: 'pending',
    dataUrl: '',
    blob: null,
    prompt: configSnapshot.prompt,
    configSnapshot,
    mode: (configSnapshot.refImages || []).length ? 'edit' : 'text',
    refDataUrls: (configSnapshot.refImages || []).map((ref) => ref.dataUrl),
    pageIndex: index + 1,
    pageTotal: configSnapshot.imageCount,
    size: configSnapshot.size,
    requestSize: configSnapshot.requestSize || configSnapshot.size,
    quality: configSnapshot.quality,
    format: configSnapshot.outputFormat === 'auto' ? 'png' : configSnapshot.outputFormat,
    time: new Date().toLocaleString('zh-CN'),
  };
}

function applyCardAspectRatio(imageWrap, image, record) {
  if (record.actualWidth && record.actualHeight) {
    imageWrap.style.setProperty('--card-aspect-ratio', `${record.actualWidth} / ${record.actualHeight}`);
    return;
  }
  const parsedSize = parseSize(record.size);
  if (parsedSize) {
    imageWrap.style.setProperty('--card-aspect-ratio', `${parsedSize.width} / ${parsedSize.height}`);
  }
  image.addEventListener('load', function() {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      imageWrap.style.setProperty('--card-aspect-ratio', `${image.naturalWidth} / ${image.naturalHeight}`);
    }
  }, { once: true });
}

function createImageCard(record, index, isGallery) {
  const card = document.createElement('article');
  card.className = isGallery ? 'gallery-item' : `result-card${record.status ? ` ${record.status}` : ''}`;
  const imageWrap = document.createElement('div');
  imageWrap.className = `image-wrap${record.status ? ` ${record.status}` : ''}`;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = record.seriesId ? `系列 ${record.pageIndex || index}` : (record.mode === 'edit' ? '图生图' : '文生图');

  if (record.status === 'pending' || record.status === 'running' || record.status === 'failed') {
    const state = document.createElement('div');
    state.className = 'series-state-view';
    const icon = document.createElement('span');
    icon.className = record.status === 'failed' ? 'series-state-icon failed' : 'series-state-icon';
    icon.textContent = record.status === 'failed' ? '!' : '';
    const title = document.createElement('strong');
    title.textContent = record.status === 'failed' ? '生成失败' : (record.status === 'running' ? '正在生成' : '等待生成');
    const detail = document.createElement('small');
    detail.textContent = record.status === 'failed' ? (record.error || '上游服务异常, 可以重试此张.') : `第 ${record.pageIndex}/${record.pageTotal || '?'} 张`;
    state.append(icon, title, detail);
    imageWrap.append(state, badge);
  } else {
    const image = document.createElement('img');
    image.src = record.dataUrl;
    image.alt = record.prompt;
    image.loading = 'lazy';
    image.addEventListener('click', () => openPreview(record.dataUrl));
    applyCardAspectRatio(imageWrap, image, record);
    imageWrap.append(image, badge);
  }

  const info = document.createElement('div');
  info.className = 'card-info';
  const prompt = document.createElement('p');
  prompt.textContent = record.pageTitle ? `${record.pageTitle}: ${record.prompt}` : record.prompt;
  prompt.title = prompt.textContent;
  const meta = document.createElement('div');
  meta.className = 'meta';
  if (record.status === 'pending' || record.status === 'running') {
    meta.innerHTML = `<span>${record.status === 'running' ? '生成中' : '排队中'} · ${escapeHtml(sizeLabel(record.requestSize || record.size))}</span><span>${escapeHtml(record.time || '')}</span>`;
  } else if (record.status === 'failed') {
    meta.innerHTML = `<span>失败 · ${escapeHtml(sizeLabel(record.requestSize || record.size))}</span><span>${escapeHtml(record.time || '')}</span>`;
  } else {
    const formatText = (record.format || dataUrlFormat(record.dataUrl)).toUpperCase();
    meta.innerHTML = `<span>${escapeHtml(metaSizeLabel(record))} · ${escapeHtml(qualityLabel(record.quality))} · ${escapeHtml(formatText)}</span><span>${escapeHtml(record.time)}</span>`;
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  if (record.status === 'failed') {
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'secondary small';
    retryBtn.textContent = '重新生成';
    retryBtn.addEventListener('click', () => {
      if (record.seriesId) retrySeriesRecord(record.id);
      else retrySingleRecord(record.id);
    });
    const promptBtn = document.createElement('button');
    promptBtn.type = 'button';
    promptBtn.className = 'ghost small';
    promptBtn.textContent = '复制词';
    promptBtn.addEventListener('click', () => copyPrompt(record.prompt, promptBtn));
    actions.append(retryBtn, promptBtn);
    info.append(prompt, meta, actions);
    card.append(imageWrap, info);
    return card;
  }
  if (record.status === 'pending' || record.status === 'running') {
    info.append(prompt, meta);
    card.append(imageWrap, info);
    return card;
  }

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'secondary small';
  downloadBtn.textContent = '下载';
  downloadBtn.addEventListener('click', () => downloadRecord(record, index));
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'ghost small';
  copyBtn.textContent = '复制图';
  copyBtn.addEventListener('click', () => copyRecordImage(record, copyBtn));
  const promptBtn = document.createElement('button');
  promptBtn.type = 'button';
  promptBtn.className = 'ghost small';
  promptBtn.textContent = '复制词';
  promptBtn.addEventListener('click', () => copyPrompt(record.prompt, promptBtn));
  actions.append(downloadBtn, copyBtn, promptBtn);

  if (isGallery) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'ghost small';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', () => deleteFromGallery(record.id));
    actions.appendChild(deleteBtn);
  }

  info.append(prompt, meta, actions);
  card.append(imageWrap, info);
  return card;
}

function downloadRecord(record, index) {
  const url = URL.createObjectURL(record.blob || dataUrlToBlob(record.dataUrl, record.format));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = record.filename || downloadFilename(record.format, index);
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyRecordImage(record, button) {
  const blob = record.blob || dataUrlToBlob(record.dataUrl, record.format);

  // 优先尝试标准 Clipboard API（需要 HTTPS / localhost）
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      flashButton(button, '已复制');
      return;
    } catch {}
  }

  // HTTP 环境下 Clipboard API 被浏览器禁用，打开全屏预览让用户右键复制
  openPreview(record.dataUrl, '右键图片 → 复制图片');
}

function copyPrompt(prompt, button) {
  navigator.clipboard.writeText(prompt).then(() => flashButton(button, '已复制'));
}

function flashButton(button, text) {
  const oldText = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = oldText; }, 1200);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('records')) {
        request.result.createObjectStore('records', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadGallery() {
  try {
    const db = await openDB();
    const tx = db.transaction('records', 'readonly');
    const records = await new Promise((resolve, reject) => {
      const request = tx.objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    gallery = records.sort((a, b) => b.id - a.id);
    db.close();
  } catch {
    gallery = [];
  }
  renderGallery();
}

async function saveRecord(record) {
  const persistable = { ...record };
  delete persistable.blob;
  try {
    const db = await openDB();
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').put(persistable);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}

async function deleteRecord(id) {
  try {
    const db = await openDB();
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').delete(id);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}

async function clearGalleryStore() {
  try {
    const db = await openDB();
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').clear();
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}

async function addToGallery(record) {
  gallery.unshift(record);
  renderGallery();
  await saveRecord(record);
}

async function deleteFromGallery(id) {
  gallery = gallery.filter((record) => record.id !== id);
  renderGallery();
  await deleteRecord(id);
}

function renderGallery() {
  els.galleryGrid.innerHTML = '';
  els.galleryEmpty.style.display = gallery.length ? 'none' : '';
  els.galleryCount.textContent = gallery.length ? `(${gallery.length} 张)` : '';
  els.topGalleryBadge.textContent = gallery.length ? `(${gallery.length})` : '';
  gallery.forEach((record, index) => els.galleryGrid.appendChild(createImageCard(record, index + 1, true)));
  renderSplitGalleryPicker();
}


function syncFormatAndBackground() {
  if (els.background.value === 'transparent' && els.outputFormat.value === 'jpeg') {
    els.outputFormat.value = 'png';
    setStatus('info', '已自动切换为 PNG, 因为 JPEG 不支持透明背景.');
  }
  const outputFormat = normalizeOutputFormat(els.outputFormat.value);
  els.outputCompression.disabled = !shouldSendCompression(outputFormat);
}



const SERIES_PRESETS = {
  ecommerce: {
    briefTitle: '产品资料',
    briefHelp: '填写产品是什么, 卖点是什么, 面向谁.',
    audienceLabel: '目标人群',
    briefLabel: '产品简介与核心卖点',
    planTitle: '页面清单',
    planHelp: '每行一张详情页模块. 建议写成“页面标题: 页面目标”.',
    planSystem: '你是电商详情页策划。根据产品资料生成 5 到 8 张详情页模块清单。只输出多行文本, 每行格式为“页面标题: 页面目标”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是电商视觉设定提示词优化器。请整理成稳定的一致性视觉规范。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含色彩, 光影, 背景, 构图, 材质, 版式和一致性约束。',
    outputRule: '生成单张电商详情页视觉模块, 构图完整, 避免乱码文字, 如需文字仅保留短标题区域和信息占位感.',
  },
  sticker: {
    briefTitle: 'IP 角色资料',
    briefHelp: '填写角色外观, 性格, 标志物, 用于保持表情包一致.',
    audienceLabel: '使用场景',
    briefLabel: '角色设定与表情包需求',
    planTitle: '表情包清单',
    planHelp: '每行一个表情动作. 例如“开心挥手: 正面站姿, 双手挥舞”.',
    planSystem: '你是 IP 表情包策划。根据角色设定生成 8 到 12 个表情包动作清单。只输出多行文本, 每行格式为“表情标题: 动作和表情描述”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是 IP 角色一致性提示词优化器。请整理成稳定的角色设定和表情包视觉规范。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含角色外观, 服饰, 比例, 线条, 表情风格, 背景和一致性约束。',
    outputRule: '生成单张表情包贴纸图, 角色外观必须一致, 动作表情夸张清晰, 背景简洁或透明, 避免乱码文字.',
  },
  character_action: {
    briefTitle: '角色资料',
    briefHelp: '填写人物/角色外观, 服装, 比例, 动作序列用途.',
    audienceLabel: '动作用途',
    briefLabel: '角色设定与动作需求',
    planTitle: '动作序列清单',
    planHelp: '每行一个动作关键帧. 例如“起跳预备: 屈膝蓄力, 双臂后摆”.',
    planSystem: '你是角色动作序列导演。根据角色设定生成 6 到 10 个动作关键帧清单。只输出多行文本, 每行格式为“关键帧标题: 姿态和动作描述”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是角色动作一致性提示词优化器。请整理成稳定的角色外观和动作序列视觉规范。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含角色外观, 服装, 比例, 镜头角度, 动作连贯性和一致性约束。',
    outputRule: '生成单张动作关键帧, 角色外观和服装保持一致, 姿态清晰, 动作连贯, 适合作为序列帧参考.',
  },
  storyboard: {
    briefTitle: '故事/项目资料',
    briefHelp: '填写故事背景, 角色, 场景, 情绪和镜头目标.',
    audienceLabel: '镜头风格',
    briefLabel: '故事设定与分镜需求',
    planTitle: '分镜清单',
    planHelp: '每行一个镜头. 例如“镜头 01: 远景, 主角站在雨夜街口”.',
    planSystem: '你是影视分镜导演。根据故事资料生成 6 到 10 个分镜镜头清单。只输出多行文本, 每行格式为“镜头标题: 景别, 构图, 动作和情绪”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是分镜视觉一致性提示词优化器。请整理成稳定的镜头语言和视觉规范。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含美术风格, 色彩, 光影, 镜头语言, 角色一致性和场景一致性约束。',
    outputRule: '生成单张分镜图, 强调景别, 构图, 情绪和镜头语言, 角色与场景设定保持一致.',
  },
  poster_campaign: {
    briefTitle: '品牌活动资料',
    briefHelp: '填写品牌, 活动主题, 目标受众和海报用途.',
    audienceLabel: '投放场景',
    briefLabel: '品牌活动与传播需求',
    planTitle: '海报组清单',
    planHelp: '每行一张海报. 例如“主视觉海报: 品牌主张和核心视觉”.',
    planSystem: '你是品牌海报组策划。根据品牌活动资料生成 4 到 8 张海报组清单。只输出多行文本, 每行格式为“海报标题: 视觉目标和传播重点”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是品牌海报视觉设定提示词优化器。请整理成稳定的品牌视觉规范。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含品牌色, 版式, 材质, 光影, 构图, 字体氛围和一致性约束。',
    outputRule: '生成单张品牌海报视觉, 保持品牌色和版式系统一致, 避免乱码文字, 可保留标题和信息占位区域.',
  },
  custom: {
    briefTitle: '序列主体资料',
    briefHelp: '填写这组图共同的主体, 目标和一致性要求.',
    audienceLabel: '使用场景',
    briefLabel: '序列需求',
    planTitle: '序列清单',
    planHelp: '每行一张图. 建议写成“标题: 当前画面目标”.',
    planSystem: '你是视觉序列策划。根据用户资料生成 5 到 8 张序列图片清单。只输出多行文本, 每行格式为“标题: 画面目标”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是视觉序列一致性提示词优化器。请整理成稳定的统一视觉设定。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含主体一致性, 色彩, 光影, 构图, 风格和变化边界。',
    outputRule: '生成单张序列图片, 保持统一设定一致, 同时满足当前画面目标.',
  },
};

function getSeriesPreset() {
  return SERIES_PRESETS[els.seriesType.value] || SERIES_PRESETS.custom;
}

function applySeriesPreset() {
  const preset = getSeriesPreset();
  els.seriesBriefTitle.textContent = preset.briefTitle;
  els.seriesBriefHelp.textContent = preset.briefHelp;
  els.seriesAudienceLabel.textContent = preset.audienceLabel;
  els.seriesBriefLabel.textContent = preset.briefLabel;
  els.seriesPlanTitle.textContent = preset.planTitle;
  els.seriesPlanHelp.textContent = preset.planHelp;
}

function resolveSeriesImageSpec() {
  return resolveSpecFromRatio(els.seriesAspectRatio.value);
}

function getSeriesSharedConfig(prompt, total) {
  const outputFormat = normalizeOutputFormat(els.seriesOutputFormat.value);
  if (outputFormat === 'jpeg' && els.seriesBackground.value === 'transparent') throw new Error('JPEG 不支持透明背景, 请改用 PNG/WebP 或选择不透明背景');
  const base = getConfig({ promptOverride: prompt, imageCountOverride: total, refImagesOverride: seriesRefImages });
  const spec = resolveSeriesImageSpec();
  return {
    ...base,
    size: spec.requestSize,
    requestSize: spec.requestSize,
    aspectRatio: spec.aspectRatio,
    sizeHint: spec.sizeHint,
    quality: els.seriesImageQuality.value,
    outputFormat,
    background: els.seriesBackground.value,
    outputCompression: normalizeCompression(els.seriesOutputCompression.value, outputFormat),
    refImages: seriesRefImages,
  };
}


function syncSeriesFormatAndBackground() {
  if (els.seriesBackground.value === 'transparent' && els.seriesOutputFormat.value === 'jpeg') {
    els.seriesOutputFormat.value = 'png';
    setSeriesStatus('info', '已自动切换为 PNG, 因为 JPEG 不支持透明背景.');
  }
  els.seriesOutputCompression.disabled = !shouldSendCompression(normalizeOutputFormat(els.seriesOutputFormat.value));
}

function parseSeriesPages() {
  return els.seriesPagePlan.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [titlePart, ...rest] = line.split(/[:：]/);
      const hasTitle = rest.length > 0;
      return {
        index,
        title: hasTitle ? titlePart.trim() : `第 ${index + 1} 张`,
        prompt: (hasTitle ? rest.join(':') : line).trim(),
        raw: line,
      };
    });
}

function updateSeriesCountHint() {
  const pages = parseSeriesPages();
  els.seriesCountHint.textContent = pages.length
    ? `当前 ${pages.length} 张图, 会共用系列母版和参考图逐张生成.`
    : '会按页表逐张生成, 每张完成后立即显示.';
}

function buildSeriesBasePrompt() {
  const preset = getSeriesPreset();
  const title = els.seriesTitle.value.trim();
  const audience = els.seriesAudience.value.trim();
  const brief = els.seriesProductBrief.value.trim();
  const style = els.seriesStylePrompt.value.trim();
  return [
    `序列类型: ${preset.briefTitle}`,
    title ? `序列名称: ${title}` : '',
    audience ? `${preset.audienceLabel}: ${audience}` : '',
    brief ? `${preset.briefLabel}: ${brief}` : '',
    style ? `统一设定: ${style}` : '',
    '一致性要求: 所有图片必须共享同一系列母版, 包括主体身份, 核心外观, 色彩系统, 光影方向, 视觉风格和画面质感. 每张图只改变页表中指定的差异点, 不要无故改变主体设定或整体风格.',
  ].filter(Boolean).join('\n');
}

function buildSeriesImagePrompt(page, total) {
  return `${buildSeriesBasePrompt()}\n\n当前资产: 第 ${page.index + 1}/${total} 张, ${page.title}.\n本张差异点: ${page.prompt}\n输出要求: ${getSeriesPreset().outputRule}`;
}

function ensureSeriesInputs(requireTextModel = false) {
  const title = els.seriesTitle.value.trim();
  const brief = els.seriesProductBrief.value.trim();
  const style = els.seriesStylePrompt.value.trim();
  const pages = parseSeriesPages();
  if (!title) throw new Error('请填写系列名称');
  if (!brief) throw new Error('请填写主体简介与核心特征');
  if (!style) throw new Error('请填写统一设定');
  if (!pages.length) throw new Error('请填写页表 / 镜头清单, 每行一张图');
  if (requireTextModel && !els.textModel.value.trim()) throw new Error('请填写文本模型, 用于系列提示词优化');
  return { title, brief, style, pages };
}

function buildSeriesPlanPayload(config) {
  const preset = getSeriesPreset();
  return {
    model: config.textModel,
    input: [
      {
        role: 'system',
        content: preset.planSystem,
      },
      {
        role: 'user',
        content: `系列名称: ${els.seriesTitle.value.trim()}\n${preset.audienceLabel}: ${els.seriesAudience.value.trim()}\n${preset.briefLabel}: ${els.seriesProductBrief.value.trim()}\n统一设定: ${els.seriesStylePrompt.value.trim()}`,
      },
    ],
    stream: false,
  };
}

function buildSeriesOptimizePayload(config) {
  const preset = getSeriesPreset();
  return {
    model: config.textModel,
    input: [
      {
        role: 'system',
        content: preset.optimizeSystem,
      },
      {
        role: 'user',
        content: `系列名称: ${els.seriesTitle.value.trim()}\n${preset.audienceLabel}: ${els.seriesAudience.value.trim()}\n${preset.briefLabel}: ${els.seriesProductBrief.value.trim()}\n原统一设定: ${els.seriesStylePrompt.value.trim()}`,
      },
    ],
    stream: false,
  };
}

async function requestTextGeneration(payload) {
  const config = getConfig({ promptOverride: els.prompt.value || '占位提示词', requireTextModel: true });
  const response = await fetch(isProxyBaseUrl(config.baseUrl) ? '/api/text' : apiEndpoint(config, '/v1/responses'), {
    method: 'POST',
    headers: requestHeaders(config, false),
    body: JSON.stringify(payload(config)),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await parseErrorResponse(response)}`);
  const data = await response.json();
  const text = data.text || extractText(data);
  if (!text) throw new Error('文本模型没有返回内容');
  return text;
}

async function generateSeriesPlan() {
  try {
    if (!els.seriesProductBrief.value.trim()) throw new Error('请先填写主体简介与核心特征');
    markTaskActive(true);
    els.seriesPlanBtn.disabled = true;
    els.seriesPlanBtn.textContent = '生成中...';
    setSeriesStatus('info', '正在根据系列母版规划页表...');
    const text = await requestTextGeneration(buildSeriesPlanPayload);
    els.seriesPagePlan.value = text.trim();
    updateSeriesCountHint();
    setSeriesStatus('done', '页表已规划完成, 可以继续手动微调后生成整套资产.');
  } catch (error) {
    setSeriesStatus('err', `页表规划失败: ${error.message || error}`);
  } finally {
    markTaskActive(false);
    els.seriesPlanBtn.disabled = false;
    els.seriesPlanBtn.textContent = '规划页表';
  }
}

async function optimizeSeriesStyle() {
  try {
    if (!els.seriesProductBrief.value.trim()) throw new Error('请先填写主体简介与核心特征');
    originalSeriesStyle = els.seriesStylePrompt.value;
    markTaskActive(true);
    els.seriesOptimizeBtn.disabled = true;
    els.seriesOptimizeBtn.textContent = '优化中...';
    setSeriesStatus('info', '正在提炼系列母版...');
    const text = await requestTextGeneration(buildSeriesOptimizePayload);
    els.seriesStylePrompt.value = text.trim();
    setSeriesStatus('done', '系列母版已提炼完成, 会作为每张图的一致性约束.');
  } catch (error) {
    setSeriesStatus('err', `母版提炼失败: ${error.message || error}`);
  } finally {
    markTaskActive(false);
    els.seriesOptimizeBtn.disabled = false;
    els.seriesOptimizeBtn.textContent = '提炼母版';
  }
}

async function generateSeriesRecord(record, options = {}) {
  const config = { ...record.configSnapshot, prompt: record.prompt, imageCount: record.pageTotal || record.configSnapshot.imageCount || 1 };
  const runIndex = Math.max(0, (record.pageIndex || 1) - 1);
  updateSeriesResult(record.id, { status: 'running', error: '', time: new Date().toLocaleString('zh-CN') });
  appendEvent('event', `${options.retry ? '重新生成' : '开始生成'}系列资产 ${record.pageIndex}/${record.pageTotal}: ${record.pageTitle}`);
  const dataUrl = config.generationMode === 'images'
    ? await generateWithImagesApi(config, runIndex)
    : await generateOne(config, runIndex);
  const resultRecord = await buildGeneratedRecord(dataUrl, config, runIndex, {
    target: 'series',
    seriesId: record.seriesId,
    seriesTitle: record.seriesTitle,
    pageTitle: record.pageTitle,
    pageIndex: record.pageIndex,
  });
  replaceSeriesResult(record.id, resultRecord);
  await addToGallery(resultRecord);
  appendEvent('done', `第 ${record.pageIndex} 张已生成, 大小 ${formatBytes(resultRecord.bytes)}`);
  return resultRecord;
}

async function retrySeriesRecord(recordId) {
  const record = seriesResults.find((item) => item.id === recordId);
  if (!record || !record.configSnapshot) return;
  setBusy(true);
  markTaskActive(true);
  abortController = new AbortController();
  startProgress('重新生成单张系列图', `正在重试第 ${record.pageIndex} 张: ${record.pageTitle}.`, ['准备请求', '服务端生成', '接收图片', '保存结果']);
  setSeriesStatus('info', `正在重新生成第 ${record.pageIndex} 张: ${record.pageTitle}`);
  try {
    await generateSeriesRecord(record, { retry: true });
    setSeriesStatus('done', `第 ${record.pageIndex} 张已重新生成.`);
    finishProgress('done', '单张重试完成', `第 ${record.pageIndex} 张已重新生成.`);
  } catch (error) {
    const message = error.message || String(error);
    updateSeriesResult(record.id, { status: 'failed', error: message, time: new Date().toLocaleString('zh-CN') });
    setSeriesStatus('err', `第 ${record.pageIndex} 张仍然失败: ${message}`);
    finishProgress('err', '单张重试失败', message);
  } finally {
    stopTimer();
    els.loadingMini.classList.remove('active');
    markTaskActive(false);
    setBusy(false);
    syncSeriesFormatAndBackground();
    abortController = null;
  }
}

async function generateSeries(event) {
  event.preventDefault();
  let series;
  try {
    series = ensureSeriesInputs(false);
  } catch (error) {
    alert(error.message);
    return;
  }
  saveSettings();
  resetRunUi();
  clearSeriesStatus();
  setBusy(true);
  markTaskActive(true);
  abortController = new AbortController();
  const seriesId = `series-${Date.now()}`;
  const baseConfig = getSeriesSharedConfig('', series.pages.length);
  seriesResults = series.pages.map((page) => {
    const prompt = buildSeriesImagePrompt(page, series.pages.length);
    return createSeriesPlaceholder({
      seriesId,
      seriesTitle: series.title,
      page,
      total: series.pages.length,
      prompt,
      configSnapshot: { ...baseConfig, prompt, imageCount: series.pages.length },
    });
  });
  renderSeriesResults();
  startProgress('准备生成系列资产', `将生成 ${series.pages.length} 张系列图, 每张都会先显示占位状态.`, ['准备请求', '逐张生成', '接收图片', '保存结果']);
  updateProgress('准备请求', '已创建结果占位卡, 正在逐张生成.', 0);
  setSeriesStatus('info', `开始生成系列资产包: ${series.title}`);
  let completedCount = 0;
  let failedCount = 0;
  for (const record of [...seriesResults]) {
    try {
      await generateSeriesRecord(record);
      completedCount += 1;
    } catch (error) {
      failedCount += 1;
      const message = error.message || String(error);
      updateSeriesResult(record.id, { status: 'failed', error: message, time: new Date().toLocaleString('zh-CN') });
      appendEvent('event', `第 ${record.pageIndex} 张失败: ${message}`);
    }
  }
  try {
    if (failedCount) {
      const detail = `系列生成完成 ${completedCount}/${series.pages.length} 张, ${failedCount} 张失败. 失败卡片可点击“重新生成”.`;
      setSeriesStatus('err', detail);
      finishProgress('err', '系列生成部分失败', detail);
    } else {
      setSeriesStatus('done', `系列资产生成完成: ${series.pages.length} 张.`);
      finishProgress('done', '系列资产生成完成', `已生成 ${series.pages.length} 张系列图, 并保存到展馆.`);
    }
  } finally {
    stopTimer();
    els.loadingMini.classList.remove('active');
    markTaskActive(false);
    setBusy(false);
    syncSeriesFormatAndBackground();
    abortController = null;
  }
}

async function optimizePrompt() {
  let config;
  try {
    config = getConfig({ requireTextModel: true });
  } catch (error) {
    alert(error.message);
    return;
  }
  originalPrompt = els.prompt.value;
  startTime = Date.now();
  startProgress('正在优化提示词', '已发送到文本模型, 正在等待返回优化结果.', ['校验输入', '请求文本模型', '解析优化结果']);
  updateProgress('正在优化提示词', `使用 ${config.textModel} 优化当前提示词.`, 1);
  markTaskActive(true);
  els.optimizeBtn.disabled = true;
  els.optimizeBtn.textContent = '优化中...';
  clearStatus();
  try {
    const response = await fetch(isProxyBaseUrl(config.baseUrl) ? '/api/text' : apiEndpoint(config, '/v1/responses'), {
      method: 'POST',
      headers: requestHeaders(config, false),
      body: JSON.stringify(buildOptimizePayload(config)),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await parseErrorResponse(response)}`);
    updateProgress('正在解析结果', '文本模型已返回, 正在提取优化后的提示词.', 2);
    const data = await response.json();
    const optimized = validateOptimizedPrompt(data.text || extractText(data));
    els.prompt.value = optimized;
    setStatus('done', '提示词已优化. 如果不满意, 可以点击恢复原提示词.');
    finishProgress('done', '提示词优化完成', '已替换为优化后的提示词, 可继续编辑或直接生成.');
  } catch (error) {
    setStatus('err', `提示词优化失败: ${error.message || error}`);
    finishProgress('err', '提示词优化失败', error.message || String(error));
  } finally {
    markTaskActive(false);
    els.optimizeBtn.disabled = false;
    els.optimizeBtn.textContent = '优化提示词';
  }
}


function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

function queuedEndpoint(config, upstreamEndpoint) {
  if (!isProxyBaseUrl(config.baseUrl)) return apiEndpoint(config, upstreamEndpoint);
  return `${config.baseUrl}/jobs${upstreamEndpoint.replace(/^\/v1/, '')}`;
}

async function submitQueuedImageRequest(config, upstreamEndpoint, makeRequestOptions, label) {
  if (!isProxyBaseUrl(config.baseUrl)) return fetchWithRetry(label, () => fetch(apiEndpoint(config, upstreamEndpoint), makeRequestOptions()));
  const submitResponse = await fetch(queuedEndpoint(config, upstreamEndpoint), makeRequestOptions());
  if (!submitResponse.ok) throw new Error(`HTTP ${submitResponse.status}: ${await parseErrorResponse(submitResponse)}`);
  let job = await submitResponse.json();
  while (job.status === 'queued' || job.status === 'running') {
    if (job.status === 'queued') {
      updateProgress('排队等待生成', `当前排队第 ${job.position || 1} 位, 服务端并发 ${job.activeCount}/${job.maxConcurrency}, 预计等待约 ${formatDuration(job.estimatedWaitMs || 0)}.`, 0);
    } else {
      updateProgress('正在生成图片', `已开始生成, 当前耗时 ${formatDuration(job.elapsedMs || 0)}, 最近平均耗时约 ${formatDuration(job.averageMs || 0)}.`, 1);
    }
    await sleep(1200);
    const statusResponse = await fetch(`${config.baseUrl}/jobs/${job.id}`);
    if (!statusResponse.ok) throw new Error(`HTTP ${statusResponse.status}: ${await parseErrorResponse(statusResponse)}`);
    job = await statusResponse.json();
  }
  if (job.status === 'failed') {
    const resultResponse = await fetch(`${config.baseUrl}/jobs/${job.id}/result`);
    throw new Error(`HTTP ${resultResponse.status}: ${await parseErrorResponse(resultResponse)}`);
  }
  const resultResponse = await fetch(`${config.baseUrl}/jobs/${job.id}/result`);
  if (!resultResponse.ok) throw new Error(`HTTP ${resultResponse.status}: ${await parseErrorResponse(resultResponse)}`);
  return resultResponse;
}

async function generateWithImagesApi(config, runIndex = 0) {
  const refs = config.refImages || refImages;
  appendEvent('event', refs.length ? `开始请求 POST /v1/images/edits (${runIndex + 1}/${config.imageCount})` : `开始请求 POST /v1/images/generations (${runIndex + 1}/${config.imageCount})`);
  updateProgress('正在生成图片', `Images API 正在生成第 ${runIndex + 1}/${config.imageCount} 张.`, 1);
  const endpoint = refs.length ? '/v1/images/edits' : '/v1/images/generations';
  const response = await submitQueuedImageRequest(config, endpoint, () => (refs.length
    ? {
      method: 'POST',
      headers: isProxyBaseUrl(config.baseUrl) ? providerHeader(config) : { Authorization: `Bearer ${config.apiKey}` },
      body: buildImagesEditFormData(config, 1, runIndex),
      signal: abortController?.signal,
    }
    : {
      method: 'POST',
      headers: requestHeaders(config, false),
      body: JSON.stringify(buildImagesPayload(config, 1, runIndex)),
      signal: abortController?.signal,
    }), `第 ${runIndex + 1}/${config.imageCount} 张图片`);
  updateProgress('正在接收图片', '服务器已返回响应, 正在解析图片数据.', 2);
  const data = await response.json();
  updateProgress('正在整理结果', '正在转换图片数据并写入结果区.', 3);
  const dataUrls = await extractImagesApiResults(data, config.outputFormat);
  if (!dataUrls.length) throw new Error('Images API 未返回图片数据');
  return dataUrls[0];
}

async function buildGeneratedRecord(rawDataUrl, config, index, options = {}) {
  updateProgress('正在保存结果', `正在保存第 ${index + 1}/${config.imageCount} 张图片到结果区和展馆.`, 3);
  const processed = await postProcessDataUrl(rawDataUrl, config);
  const dataUrl = processed.dataUrl;
  const actualFormat = dataUrlFormat(dataUrl);
  const blob = dataUrlToBlob(dataUrl, actualFormat);
  const actualSize = await readImageSize(dataUrl);
  const sourceSize = processed.originalSize || actualSize;
  return {
    id: options.id || Date.now() + index,
    dataUrl,
    blob,
    prompt: config.prompt,
    mode: (config.refImages || refImages).length ? 'edit' : 'text',
    refDataUrls: (config.refImages || refImages).map((ref) => ref.dataUrl),
    seriesId: options.seriesId || '',
    seriesTitle: options.seriesTitle || '',
    pageTitle: options.pageTitle || '',
    pageIndex: options.pageIndex || 0,
    size: config.size,
    requestSize: config.requestSize || config.size,
    actualWidth: actualSize.width,
    actualHeight: actualSize.height,
    sourceWidth: sourceSize.width,
    sourceHeight: sourceSize.height,
    quality: config.quality,
    format: actualFormat,
    filename: downloadFilename(actualFormat, index + 1),
    bytes: blob.size,
    time: new Date().toLocaleString('zh-CN'),
  };
}

async function addGeneratedResult(rawDataUrl, config, index, options = {}) {
  const isSeries = options.target === 'series';
  const imageRecord = await buildGeneratedRecord(rawDataUrl, config, index, options);
  if (isSeries) {
    seriesResults.unshift(imageRecord);
    renderSeriesResults();
    els.seriesRunSummary.textContent = `已生成 ${index + 1}/${config.imageCount} 张系列资产.`;
  } else {
    currentResults.unshift(imageRecord);
    renderResults();
    els.runSummary.textContent = `已生成 ${index + 1}/${config.imageCount} 张.`;
  }
  await addToGallery(imageRecord);
  appendEvent('done', `第 ${index + 1} 张已生成, 大小 ${formatBytes(imageRecord.bytes)}`);
}

async function generateOne(config, runIndex) {
  appendEvent('event', `开始生成第 ${runIndex + 1}/${config.imageCount} 张`);
  updateProgress('正在生成图片', `Responses 工具正在生成第 ${runIndex + 1}/${config.imageCount} 张.`, 1);
  const response = await submitQueuedImageRequest(config, '/v1/responses', () => ({
    method: 'POST',
    headers: requestHeaders(config, true),
    body: JSON.stringify(buildImagePayload(config, runIndex)),
    signal: abortController?.signal,
  }), `第 ${runIndex + 1}/${config.imageCount} 张图片`);
  if (!response.body) throw new Error('浏览器没有收到流式响应体');
  updateProgress('正在接收流式事件', `已连接服务器, 正在等待第 ${runIndex + 1} 张图片数据.`, 2);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('event: ')) {
        const eventName = trimmed.slice(7);
        if (eventName !== 'response.output_text.delta') appendEvent('event', eventName);
        continue;
      }
      if (!trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.slice(6);
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const data = JSON.parse(dataStr);
        const dataUrl = extractBase64AsDataUrl(data, config.outputFormat);
        if (dataUrl) {
          updateProgress('图片已返回', `第 ${runIndex + 1}/${config.imageCount} 张图片已返回, 正在处理.`, 3);
          return dataUrl;
        }
        if (typeof data.delta === 'string' && data.delta) {
          updateTextStream(data.delta);
          if (collectedText.length % 5 === 1) appendEvent('text', `已接收 ${collectedText.length} 个 delta`);
        } else if (eventCount % 4 === 0) {
          appendEvent('data', Object.keys(data).slice(0, 3).join(', ') || typeof data);
        }
      } catch {}
    }
  }
  throw new Error(collectedText.length ? `模型返回了文本, 但未返回图片: ${collectedText.join('').slice(0, 160)}` : '流结束但未找到图片');
}

async function generateSingleRecord(record, options = {}) {
  const config = { ...record.configSnapshot, prompt: record.prompt, imageCount: record.pageTotal || record.configSnapshot.imageCount || 1 };
  const runIndex = Math.max(0, (record.pageIndex || 1) - 1);
  updateCurrentResult(record.id, { status: 'running', error: '', time: new Date().toLocaleString('zh-CN') });
  appendEvent('event', `${options.retry ? '重新生成' : '开始生成'}单图 ${record.pageIndex}/${record.pageTotal}`);
  const dataUrl = config.generationMode === 'images'
    ? await generateWithImagesApi(config, runIndex)
    : await generateOne(config, runIndex);
  const resultRecord = await buildGeneratedRecord(dataUrl, config, runIndex);
  replaceCurrentResult(record.id, resultRecord);
  await addToGallery(resultRecord);
  appendEvent('done', `第 ${record.pageIndex} 张已生成, 大小 ${formatBytes(resultRecord.bytes)}`);
  return resultRecord;
}

async function retrySingleRecord(recordId) {
  const record = currentResults.find((item) => item.id === recordId);
  if (!record || !record.configSnapshot) return;
  setBusy(true);
  markTaskActive(true);
  abortController = new AbortController();
  startProgress('重新生成单张图片', `正在重试第 ${record.pageIndex} 张.`, ['准备请求', '服务端生成', '接收图片', '保存结果']);
  setStatus('info', `正在重新生成第 ${record.pageIndex} 张图片...`);
  try {
    await generateSingleRecord(record, { retry: true });
    setStatus('done', `第 ${record.pageIndex} 张已重新生成.`);
    finishProgress('done', '单张重试完成', `第 ${record.pageIndex} 张已重新生成.`);
  } catch (error) {
    const message = error.message || String(error);
    updateCurrentResult(record.id, { status: 'failed', error: message, time: new Date().toLocaleString('zh-CN') });
    setStatus('err', `第 ${record.pageIndex} 张仍然失败: ${message}`);
    finishProgress('err', '单张重试失败', message);
  } finally {
    stopTimer();
    els.loadingMini.classList.remove('active');
    markTaskActive(false);
    setBusy(false);
    syncFormatAndBackground();
    abortController = null;
  }
}

async function generate(event) {
  event.preventDefault();
  let config;
  try {
    config = getConfig();
  } catch (error) {
    alert(error.message);
    return;
  }
  saveSettings();
  resetRunUi();
  setBusy(true);
  markTaskActive(true);
  abortController = new AbortController();
  const runId = `single-${Date.now()}`;
  currentResults = Array.from({ length: config.imageCount }, (_, index) => createSinglePlaceholder({
    id: `${runId}-${index + 1}`,
    configSnapshot: { ...config },
    index,
  }));
  renderResults();
  setStatus('info', `准备生成 ${config.imageCount} 张图片...`);
  startProgress('准备生成图片', `已创建 ${config.imageCount} 个占位卡, 将逐张生成并替换结果.`, ['准备请求', '服务端生成', '接收图片', '保存结果']);
  updateProgress('准备请求', '正在组装参数和请求体.', 0);

  let completedCount = 0;
  let failedCount = 0;
  for (const record of [...currentResults]) {
    try {
      await generateSingleRecord(record);
      completedCount += 1;
    } catch (error) {
      failedCount += 1;
      const message = error.message || String(error);
      updateCurrentResult(record.id, { status: 'failed', error: message, time: new Date().toLocaleString('zh-CN') });
      appendEvent('event', `第 ${record.pageIndex} 张失败: ${message}`);
    }
  }

  try {
    if (failedCount) {
      const detail = `生成完成 ${completedCount}/${config.imageCount} 张, ${failedCount} 张失败. 失败卡片可点击“重新生成”.`;
      setStatus('err', detail);
      els.runSummary.textContent = detail;
      finishProgress('err', '图片生成部分失败', detail);
    } else {
      setStatus('done', `完成: 已生成 ${config.imageCount} 张图片, 并保存到展馆.`);
      els.runSummary.textContent = `完成 ${config.imageCount} 张生成.`;
      finishProgress('done', '图片生成完成', `已生成 ${config.imageCount} 张图片, 并保存到展馆.`);
    }
  } finally {
    stopTimer();
    els.loadingMini.classList.remove('active');
    markTaskActive(false);
    setBusy(false);
    syncFormatAndBackground();
    abortController = null;
  }
}

function updatePreviewTransform() {
  els.previewImg.style.transform = `translate(${panX}px, ${panY}px) scale(${previewScale})`;
}

function openPreview(dataUrl, hint) {
  previewScale = 1;
  panX = 0;
  panY = 0;
  els.previewImg.src = dataUrl;
  updatePreviewTransform();
  const hintEl = $('#previewHint');
  if (hintEl) hintEl.textContent = hint || '滚轮缩放 · 拖拽平移 · ESC 关闭';
  els.previewOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePreview() {
  els.previewOverlay.classList.remove('open');
  document.body.style.overflow = '';
}


function splitSetStatus(type, message) {
  if (!els.splitStatus) return;
  els.splitStatus.className = `status-bar ${type || ''}`;
  els.splitStatus.textContent = message || '';
}

function splitNumber(input, fallback = 0) {
  const value = Number(input?.value ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function splitMime(format) {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

function splitExt(format) {
  if (format === 'jpeg') return 'jpg';
  if (format === 'webp') return 'webp';
  return 'png';
}

function canvasToBlob(canvas, format, quality) {
  return new Promise((resolve) => {
    const normalized = normalizeOutputFormat(format) === 'auto' ? 'png' : format;
    const mime = splitMime(normalized);
    const q = normalized === 'jpeg' || normalized === 'webp' ? Math.max(0, Math.min(1, quality / 100)) : undefined;
    canvas.toBlob((blob) => resolve(blob), mime, q);
  });
}

function splitDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function readSplitFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve({ file, dataUrl: reader.result, image });
      image.onerror = () => reject(new Error('图片加载失败'));
      image.src = reader.result;
    };
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}


function renderSplitGalleryPicker() {
  if (!els.splitGalleryPicker) return;
  els.splitGalleryPicker.innerHTML = '';
  if (!gallery.length) {
    els.splitGalleryPicker.classList.remove('open');
    return;
  }
  gallery.slice(0, 24).forEach((record, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'split-gallery-item';
    button.title = record.pageTitle || record.prompt || `画廊图片 ${index + 1}`;
    const image = document.createElement('img');
    image.src = record.dataUrl;
    image.alt = button.title;
    button.appendChild(image);
    button.addEventListener('click', () => selectSplitGalleryRecord(record));
    els.splitGalleryPicker.appendChild(button);
  });
}

async function selectSplitGalleryRecord(record) {
  if (!record?.dataUrl) return;
  try {
    splitSetStatus('info', '正在从画廊载入图片...');
    const image = await imageFromDataUrl(record.dataUrl);
    splitSource = {
      file: { name: record.pageTitle || record.filename || `gallery-${record.id}.png` },
      dataUrl: record.dataUrl,
      image,
      galleryId: record.id,
    };
    if (els.splitGalleryPicker) els.splitGalleryPicker.classList.remove('open');
    await renderSplitSlices();
  } catch (error) {
    splitSetStatus('err', `画廊图片载入失败: ${error.message || error}`);
  }
}

function getSplitConfig() {
  const rows = Math.max(1, Math.min(20, Math.round(splitNumber(els.splitRows, 1))));
  const cols = Math.max(1, Math.min(20, Math.round(splitNumber(els.splitCols, 1))));
  const marginX = Math.max(0, splitNumber(els.splitMarginX, 0));
  const marginY = Math.max(0, splitNumber(els.splitMarginY, 0));
  const gapX = Math.max(0, splitNumber(els.splitGapX, 0));
  const gapY = Math.max(0, splitNumber(els.splitGapY, 0));
  const format = normalizeOutputFormat(els.splitFormat.value) === 'auto' ? 'png' : els.splitFormat.value;
  const quality = Math.max(0, Math.min(100, splitNumber(els.splitQuality, 92)));
  return { rows, cols, marginX, marginY, gapX, gapY, format, quality };
}

function drawSliceToCanvas(sourceImage, crop) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceImage, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function renderSplitSlices() {
  if (!els.splitPreview) return;
  if (!splitSource) {
    splitSlices = [];
    els.splitPreview.className = 'split-preview-empty';
    els.splitPreview.innerHTML = '<div class="empty-icon">✂</div><p>上传一张合集图后, 切片预览会显示在这里.</p>';
    if (els.splitSourceInfo) els.splitSourceInfo.textContent = '尚未选择图片.';
    return;
  }
  const config = getSplitConfig();
  const image = splitSource.image;
  const usableWidth = image.naturalWidth - config.marginX * 2 - config.gapX * (config.cols - 1);
  const usableHeight = image.naturalHeight - config.marginY * 2 - config.gapY * (config.rows - 1);
  if (usableWidth <= 0 || usableHeight <= 0) {
    splitSlices = [];
    els.splitPreview.className = 'split-preview-empty';
    els.splitPreview.innerHTML = '<div class="empty-icon">!</div><p>边距或间距过大, 已超过原图尺寸.</p>';
    splitSetStatus('err', '边距或间距过大, 请调小后重试.');
    return;
  }
  const cellWidth = usableWidth / config.cols;
  const cellHeight = usableHeight / config.rows;
  splitSlices = [];
  els.splitPreview.className = 'split-preview-grid';
  els.splitPreview.innerHTML = '';
  for (let row = 0; row < config.rows; row += 1) {
    for (let col = 0; col < config.cols; col += 1) {
      const index = row * config.cols + col + 1;
      const crop = {
        x: config.marginX + col * (cellWidth + config.gapX),
        y: config.marginY + row * (cellHeight + config.gapY),
        width: cellWidth,
        height: cellHeight,
      };
      const canvas = drawSliceToCanvas(image, crop);
      const dataUrl = canvas.toDataURL(splitMime(config.format), config.format === 'png' ? undefined : config.quality / 100);
      const slice = { index, row: row + 1, col: col + 1, canvas, dataUrl, filename: `slice-${String(index).padStart(2, '0')}.${splitExt(config.format)}` };
      splitSlices.push(slice);
      const card = document.createElement('article');
      card.className = 'split-slice-card';
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'split-slice-preview';
      preview.addEventListener('click', () => openPreview(slice.dataUrl));
      const img = document.createElement('img');
      img.src = slice.dataUrl;
      img.alt = `切片 ${index}`;
      preview.appendChild(img);
      const info = document.createElement('div');
      info.className = 'split-slice-info';
      info.innerHTML = `<strong>#${index}</strong><span>${Math.round(crop.width)}×${Math.round(crop.height)}</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-ghost';
      btn.textContent = '下载';
      btn.addEventListener('click', async () => {
        const blob = await canvasToBlob(slice.canvas, config.format, config.quality);
        splitDownloadBlob(blob, slice.filename);
      });
      info.appendChild(btn);
      card.append(preview, info);
      els.splitPreview.appendChild(card);
    }
  }
  if (els.splitSourceInfo) els.splitSourceInfo.textContent = `${splitSource.file.name} · ${image.naturalWidth}×${image.naturalHeight} · ${config.rows} 行 × ${config.cols} 列`;
  splitSetStatus('done', `已生成 ${splitSlices.length} 个切片预览, 可单张下载或下载全部.`);
}

async function handleSplitFile(files) {
  const file = files?.[0];
  if (!file) return;
  try {
    splitSetStatus('info', '正在读取图片...');
    splitSource = await readSplitFile(file);
    await renderSplitSlices();
  } catch (error) {
    splitSource = null;
    splitSlices = [];
    splitSetStatus('err', `切图失败: ${error.message || error}`);
    await renderSplitSlices();
  } finally {
    if (els.splitFile) els.splitFile.value = '';
  }
}

async function downloadAllSplitSlices() {
  if (!splitSource || !splitSlices.length) {
    splitSetStatus('err', '请先上传图片并生成切片预览.');
    return;
  }
  const config = getSplitConfig();
  for (const slice of splitSlices) {
    const blob = await canvasToBlob(slice.canvas, config.format, config.quality);
    splitDownloadBlob(blob, slice.filename);
    await sleep(120);
  }
  splitSetStatus('done', `已触发下载 ${splitSlices.length} 个切片.`);
}

function clearSplitTool() {
  splitSource = null;
  splitSlices = [];
  splitSetStatus('', '');
  renderSplitSlices();
}

const modelCache = new Map();
let modelIds = [];
let activeModelIdx = -1;

function renderModelPanel() {
  els.modelPanel.innerHTML = '';
  if (!modelIds.length) {
    const empty = document.createElement('div');
    empty.className = 'combo-empty';
    empty.textContent = '聚焦自动加载, 需先填 Base URL 和 API Key';
    els.modelPanel.appendChild(empty);
    return;
  }
  modelIds.forEach((id, index) => {
    const item = document.createElement('div');
    item.className = `combo-item${index === activeModelIdx ? ' active' : ''}`;
    item.textContent = id;
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      els.textModel.value = id;
      closeModelPanel();
    });
    els.modelPanel.appendChild(item);
  });
}

function openModelPanel() {
  activeModelIdx = -1;
  renderModelPanel();
  els.modelPanel.classList.add('open');
}

function closeModelPanel() {
  els.modelPanel.classList.remove('open');
}

async function loadModels() {
  const baseUrl = els.baseUrl.value.trim() || '/api';
  const cacheKey = `${baseUrl}::server`;
  if (modelCache.has(cacheKey)) {
    modelIds = modelCache.get(cacheKey);
    renderModelPanel();
    return;
  }
  try {
    const response = await fetch(isProxyBaseUrl(baseUrl) ? '/api/models' : `${normalizeBaseUrl(baseUrl)}/v1/models`, {
      headers: isProxyBaseUrl(baseUrl) ? { ...providerHeader({ providerId: selectedProviderId() }), accept: 'application/json' } : headers(els.apiKey.value.trim(), false),
    });
    if (response.ok) {
      const data = await response.json();
      modelIds = Array.isArray(data?.data) ? data.data.map((item) => item?.id).filter(Boolean) : [];
      modelCache.set(cacheKey, modelIds);
    }
  } catch {}
  renderModelPanel();
}

function bindEvents() {
  if (els.authForm) els.authForm.addEventListener('submit', loginWithPassword);
  window.addEventListener('beforeunload', (event) => {
    if (!hasActiveTask()) return;
    event.preventDefault();
    event.returnValue = '当前还有生成或优化任务正在进行. 刷新或关闭页面会丢失当前任务状态.';
  });
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      els.tabs.forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      const page = tab.dataset.page;
      els.tabDraw.classList.toggle('active', page === 'draw');
      if (els.tabSeries) els.tabSeries.classList.toggle('active', page === 'series');
      if (els.tabSplit) els.tabSplit.classList.toggle('active', page === 'split');
      els.tabGallery.classList.toggle('active', page === 'gallery');
    });
  });
  if (els.providerSelect) els.providerSelect.addEventListener('change', () => applyProviderSelection(els.providerSelect.value));
  if (els.seriesProviderSelect) els.seriesProviderSelect.addEventListener('change', () => applyProviderSelection(els.seriesProviderSelect.value));
  els.pwdToggle.addEventListener('click', () => {
    const visible = els.apiKey.type === 'text';
    els.apiKey.type = visible ? 'password' : 'text';
    els.pwdToggle.textContent = visible ? '显示' : '隐藏';
  });
  els.thumbAdd.addEventListener('click', () => els.imageFile.click());
  els.imageFile.addEventListener('change', () => addRefFiles(els.imageFile.files));
  els.clearRefsBtn.addEventListener('click', clearRefImages);
  els.seriesThumbAdd.addEventListener('click', () => els.seriesImageFile.click());
  els.seriesImageFile.addEventListener('change', () => addSeriesRefFiles(els.seriesImageFile.files));
  els.seriesClearRefsBtn.addEventListener('click', clearSeriesRefImages);
  els.background.addEventListener('change', syncFormatAndBackground);
  els.outputFormat.addEventListener('change', syncFormatAndBackground);
  els.form.addEventListener('submit', generate);
  els.seriesForm.addEventListener('submit', generateSeries);
  els.seriesPlanBtn.addEventListener('click', generateSeriesPlan);
  els.seriesOptimizeBtn.addEventListener('click', optimizeSeriesStyle);
  els.seriesClearResultsBtn.addEventListener('click', () => {
    seriesResults = [];
    renderSeriesResults();
    els.seriesRunSummary.textContent = '系列资产结果已清空.';
  });
  els.seriesPagePlan.addEventListener('input', updateSeriesCountHint);
  els.seriesType.addEventListener('change', applySeriesPreset);
  els.seriesBackground.addEventListener('change', syncSeriesFormatAndBackground);
  els.seriesOutputFormat.addEventListener('change', syncSeriesFormatAndBackground);
  if (els.splitUploadBtn) els.splitUploadBtn.addEventListener('click', () => els.splitFile.click());
  if (els.splitGalleryBtn) els.splitGalleryBtn.addEventListener('click', () => {
    renderSplitGalleryPicker();
    if (!gallery.length) {
      splitSetStatus('err', '画廊暂无图片, 请先生成或导入图片.');
      return;
    }
    els.splitGalleryPicker.classList.toggle('open');
  });
  if (els.splitFile) els.splitFile.addEventListener('change', () => handleSplitFile(els.splitFile.files));
  [els.splitRows, els.splitCols, els.splitMarginX, els.splitMarginY, els.splitGapX, els.splitGapY, els.splitFormat, els.splitQuality].forEach((input) => {
    if (input) input.addEventListener('input', renderSplitSlices);
  });
  if (els.splitDownloadAllBtn) els.splitDownloadAllBtn.addEventListener('click', downloadAllSplitSlices);
  if (els.splitClearBtn) els.splitClearBtn.addEventListener('click', clearSplitTool);
  els.optimizeBtn.addEventListener('click', optimizePrompt);
  els.restorePromptBtn.addEventListener('click', () => {
    if (originalPrompt) els.prompt.value = originalPrompt;
  });
  els.clearResultsBtn.addEventListener('click', () => {
    currentResults = [];
    renderResults();
    els.runSummary.textContent = '结果已清空.';
  });
  els.clearGalleryBtn.addEventListener('click', async () => {
    if (!gallery.length || !confirm('确认清空全部展馆记录?')) return;
    gallery = [];
    renderGallery();
    await clearGalleryStore();
  });
  els.prompt.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') els.form.requestSubmit();
  });
  els.textModel.addEventListener('focus', () => { openModelPanel(); loadModels(); });
  els.textModel.addEventListener('input', () => { activeModelIdx = -1; renderModelPanel(); els.modelPanel.classList.add('open'); });
  els.textModel.addEventListener('blur', () => setTimeout(closeModelPanel, 160));
  els.textModel.addEventListener('keydown', (event) => {
    const items = els.modelPanel.querySelectorAll('.combo-item');
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeModelIdx = Math.min(items.length - 1, activeModelIdx + 1);
      renderModelPanel();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeModelIdx = Math.max(0, activeModelIdx - 1);
      renderModelPanel();
    } else if (event.key === 'Enter' && activeModelIdx >= 0 && items[activeModelIdx]) {
      event.preventDefault();
      els.textModel.value = items[activeModelIdx].textContent;
      closeModelPanel();
    } else if (event.key === 'Escape') {
      closeModelPanel();
    }
  });
  els.previewOverlay.addEventListener('click', (event) => {
    if (event.target === els.previewOverlay || event.target.closest('.preview-close')) closePreview();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.previewOverlay.classList.contains('open')) closePreview();
  });
  els.previewOverlay.addEventListener('wheel', (event) => {
    if (!els.previewOverlay.classList.contains('open')) return;
    event.preventDefault();
    const rect = els.previewImg.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const oldScale = previewScale;
    previewScale = Math.max(.2, Math.min(5, previewScale + (event.deltaY > 0 ? -.1 : .1)));
    const ratio = previewScale / oldScale;
    panX += event.clientX - fx * rect.width * ratio - rect.left;
    panY += event.clientY - fy * rect.height * ratio - rect.top;
    updatePreviewTransform();
  }, { passive: false });
  els.previewImg.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    isDragging = true;
    els.previewImg.classList.add('dragging');
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    panStartX = panX;
    panStartY = panY;
    event.preventDefault();
  });
  window.addEventListener('mousemove', (event) => {
    if (!isDragging) return;
    panX = panStartX + event.clientX - dragStartX;
    panY = panStartY + event.clientY - dragStartY;
    updatePreviewTransform();
  });
  window.addEventListener('mouseup', () => {
    isDragging = false;
    els.previewImg.classList.remove('dragging');
  });
}

async function initializeApp() {
  readSettings();
  bindEvents();
  syncFormatAndBackground();
  applySeriesPreset();
  syncSeriesFormatAndBackground();
  updateSeriesCountHint();
  renderResults();
  renderSeriesResults();
  loadGallery();
  if (await checkAuthStatus()) await loadServerConfig();
}

initializeApp();
