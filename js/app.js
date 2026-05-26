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
  pasteHint: $('#pasteHint'),
  genBtn: $('#genBtn'),
  resultGrid: $('#resultGrid'),
  resultEmpty: $('#resultEmpty'),
  clearResultsBtn: $('#clearResultsBtn'),
  runSummary: $('#runSummary'),
  statusBar: $('#statusBar'),
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
  seriesPresetChips: $('#seriesPresetChips'),
  seriesAspectRatio: $('#seriesAspectRatio'),
  seriesImageQuality: $('#seriesImageQuality'),
  seriesOutputFormat: $('#seriesOutputFormat'),
  seriesBackground: $('#seriesBackground'),
  seriesOutputCompression: $('#seriesOutputCompression'),
  seriesTitle: $('#seriesTitle'),
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
  previewPrev: $('#previewPrev'),
  previewNext: $('#previewNext'),
  queueStrip: $('#queueStrip'),
  queueStripToggle: $('#queueStripToggle'),
  queueDrawer: $('#queueDrawer'),
  queueDrawerList: $('#queueDrawerList'),
  queueStripIdle: $('#queueStripIdle'),
  queueStripRunning: $('#queueStripRunning'),
  queueStripPending: $('#queueStripPending'),
  queueRunningCount: $('#queueRunningCount'),
  queuePendingCount: $('#queuePendingCount'),
  queueGlobalActive: $('#queueGlobalActive'),
  queueGlobalQueued: $('#queueGlobalQueued'),
};

const SETTINGS_KEY = 'img_gen_studio_settings_v2';
const STORAGE_USER_ID_KEY = 'sprout-canvas-uid';
const DB_NAME = 'img-gen-gallery';
const DB_VERSION = 2;
const MAX_REF_SOURCE_SIZE = 50 * 1024 * 1024;
const MAX_REF_UPLOAD_SIZE = 2 * 1024 * 1024;
const MAX_REF_TOTAL_UPLOAD_SIZE = 5 * 1024 * 1024;
const MAX_REF_DIMENSION = 1600;
const REF_IMAGE_QUALITY = 0.86;
const TEXT_FEEDBACK_MS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let currentUserId = '';

function generateUserId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getOrCreateUserId() {
  if (currentUserId) return currentUserId;
  let stored = '';
  try { stored = localStorage.getItem(STORAGE_USER_ID_KEY) || ''; } catch {}
  if (UUID_RE.test(stored)) {
    currentUserId = stored;
    return stored;
  }
  const fresh = generateUserId();
  try { localStorage.setItem(STORAGE_USER_ID_KEY, fresh); } catch {}
  currentUserId = fresh;
  return fresh;
}

let refImages = [];
let seriesRefImages = [];
let gallery = [];
let currentResults = [];
let seriesResults = [];
let splitSource = null;
let splitSlices = [];
let originalSeriesStyle = '';
let eventCount = 0;
let collectedText = [];
let timerInterval = null;
let startTime = 0;
let activeTaskCount = 0;
let serverProviders = [];
let preferredProviderId = '';
let serverDefaultProviderId = '';
let serverTextProviderName = '文本服务商';
let previewScale = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let previewList = [];
let previewIndex = 0;
let dragStartX = 0;
let dragStartY = 0;
let panStartX = 0;

function textAttemptSummary(attempts = []) {
  const failed = attempts.filter((attempt) => attempt?.providerName);
  if (!failed.length) return '';
  const timedOut = failed.filter((attempt) => attempt.timeout);
  const names = [...new Set((timedOut.length ? timedOut : failed).map((attempt) => attempt.providerName))];
  return timedOut.length
    ? `已自动跳过超时文本服务商: ${names.join(', ')}.`
    : `已自动尝试备用文本服务商: ${names.join(', ')}.`;
}

function startTextWaitFeedback(setMessage) {
  let step = 0;
  const messages = [
    '文本服务商响应较慢, 仍在等待...',
    '如果当前服务商超时, 后台会自动切换到备用文本服务商.',
    '仍在处理, 请保持页面打开.',
  ];
  const timer = setInterval(() => {
    const message = messages[Math.min(step, messages.length - 1)];
    setMessage(message);
    step += 1;
  }, TEXT_FEEDBACK_MS);
  return () => clearInterval(timer);
}
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('参考图读取失败'));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('参考图压缩失败'));
    }, mime, quality);
  });
}

function blobToFile(blob, name) {
  const safeName = String(name || `ref-${Date.now()}.jpg`).replace(/\.[^.]+$/, '');
  return new File([blob], `${safeName}.jpg`, { type: blob.type || 'image/jpeg' });
}

function totalRefBytes(refs) {
  return refs.reduce((total, ref) => total + (ref?.file?.size || 0), 0);
}

function enforceRefTotalLimit(refs, nextFile) {
  const total = totalRefBytes(refs) + (nextFile?.size || 0);
  if (total <= MAX_REF_TOTAL_UPLOAD_SIZE) return true;
  alert(`参考图总上传体积约 ${formatBytes(total)}, 已超过 ${formatBytes(MAX_REF_TOTAL_UPLOAD_SIZE)}. 请减少张数或使用更小的图片.`);
  return false;
}

async function prepareReferenceFile(file) {
  if (!file?.type?.startsWith('image/')) return null;
  if (file.size > MAX_REF_SOURCE_SIZE) {
    alert(`${file.name || '图片'} 超过 ${formatBytes(MAX_REF_SOURCE_SIZE)}, 已跳过`);
    return null;
  }

  const sourceDataUrl = await fileToDataUrl(file);
  let outputFile = file;
  let outputDataUrl = sourceDataUrl;
  let compressed = false;

  try {
    const image = await imageFromDataUrl(sourceDataUrl);
    const largestSide = Math.max(image.naturalWidth || 0, image.naturalHeight || 0);
    const scale = largestSide > MAX_REF_DIMENSION ? MAX_REF_DIMENSION / largestSide : 1;
    const shouldCompress = file.size > MAX_REF_UPLOAD_SIZE || scale < 1 || file.type !== 'image/jpeg';
    if (shouldCompress) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
      canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, 'image/jpeg', REF_IMAGE_QUALITY);
      if (blob.size < file.size || file.size > MAX_REF_UPLOAD_SIZE || scale < 1) {
        outputFile = blobToFile(blob, file.name);
        outputDataUrl = await fileToDataUrl(outputFile);
        compressed = outputFile.size < file.size;
      }
    }
  } catch {
    outputFile = file;
    outputDataUrl = sourceDataUrl;
  }

  if (outputFile.size > MAX_REF_UPLOAD_SIZE) {
    alert(`${file.name || '图片'} 处理后仍有 ${formatBytes(outputFile.size)}, 超过单张上传上限 ${formatBytes(MAX_REF_UPLOAD_SIZE)}, 已跳过`);
    return null;
  }

  return {
    name: outputFile.name || file.name || `pasted-${Date.now()}.jpg`,
    file: outputFile,
    dataUrl: outputDataUrl,
    originalSize: file.size,
    uploadSize: outputFile.size,
    compressed,
  };
}

const ASPECT_RATIOS = {
  '1:1': [1, 1],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '4:3': [4, 3],
  '3:4': [3, 4],
  '3:2': [3, 2],
  '2:3': [2, 3],
  '21:9': [21, 9],
};

const RATIO_REQUEST_SIZES = {
  '1:1': '1024x1024',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '4:3': '1024x768',
  '3:4': '768x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '21:9': '1280x544',
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
  els.outputFormat.value = 'auto';
  els.background.value = saved.background || 'auto';
  els.outputCompression.value = '90';
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    providerId: selectedProviderId(),
    imageCount: els.imageCount.value,
    aspectRatio: els.aspectRatio.value,
    imageQuality: els.imageQuality.value,
    background: els.background.value,
  }));
}

function selectedProviderId() {
  return (els.providerSelect?.value || preferredProviderId || '').trim();
}

function findServerProvider(providerId) {
  return serverProviders.find((provider) => provider.id === providerId) || serverProviders[0] || null;
}

function providerHeader(config) {
  const headers = {};
  if (config.providerId) headers['X-Provider-Id'] = config.providerId;
  if (config._excludeProviderId) headers['X-Exclude-Provider-Id'] = config._excludeProviderId;
  return headers;
}

function renderProviderOptions(select, selectedId) {
  if (!select) return;
  select.innerHTML = '<option value="">自动调度</option>' + serverProviders.map((provider) => {
    const label = `${provider.name} · ${provider.imageModel || '未配置生图模型'}`;
    return `<option value="${escapeHtml(provider.id)}">${escapeHtml(label)}</option>`;
  }).join('');
  select.value = selectedId || '';
  select.disabled = serverProviders.length <= 1;
}

function applyProviderSelection(providerId, persist = true) {
  if (!providerId) {
    preferredProviderId = '';
    if (els.providerSelect) els.providerSelect.value = '';
    if (els.seriesProviderSelect) els.seriesProviderSelect.value = '';
    const provider = findServerProvider(serverDefaultProviderId);
    els.baseUrl.value = '/api';
    els.apiKey.value = '__server__';
    els.textModel.value = provider?.textModel || 'gpt-5-mini';
    els.imageModel.value = provider?.imageModel || 'gpt-image-2';
    els.generationMode.value = 'images';
    if (els.configStatus) els.configStatus.textContent = '后台自动调度已启用';
    if (els.configSummary) els.configSummary.textContent = `生图会由服务端自动选择空闲上游, 系列文本优化固定使用文本服务商 ${serverTextProviderName}. API Key 只保存在本地服务端配置文件中.`;
    if (persist) saveSettings();
    return;
  }
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
  if (els.configSummary) els.configSummary.textContent = `生图会由服务端自动选择空闲上游, 系列文本优化固定使用文本服务商 ${serverTextProviderName}. API Key 只保存在本地服务端配置文件中.`;
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
  const selectedId = preferredProviderId || '';
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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


  const prompt = String(options.promptOverride ?? els.prompt.value).trim();
  if (!prompt) throw new Error('请填写提示词');
  if (requireTextModel && !textModel) throw new Error('请填写文本模型, 用于系列文本优化和 Responses 工具模式');
  if (generationMode === 'images' && !imageModel) throw new Error('请填写图片模型, 例如 gpt-image-2');
  if (generationMode === 'responses' && !imageModel) throw new Error('Responses 工具模式需要生图模型, 例如 gpt-5.3-codex');
  const outputFormat = 'auto';
  const outputCompression = 90;
  els.outputFormat.value = outputFormat;
  els.outputCompression.value = String(outputCompression);
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
  const tool = { type: 'image_generation', moderation: 'low' };
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

function buildImagesPayload(config, count = config.imageCount, runIndex = 0) {
  const suffix = `${config.sizeHint || ''}${config.imageCount > 1 ? `\n这是第 ${runIndex + 1} 张, 请在构图和细节上做自然变化, 不要重复上一张。` : ''}`;
  const body = {
    model: config.imageModel,
    prompt: `${config.prompt}${suffix}`,
    n: count,
    moderation: 'low',
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
  formData.append('moderation', 'low');
  appendImagesFormValue(formData, 'n', count);
  appendImagesFormValue(formData, 'size', config.requestSize);
  appendImagesFormValue(formData, 'quality', config.quality);
  appendImagesFormValue(formData, 'background', config.background);
  appendImagesFormValue(formData, 'output_format', config.outputFormat);
  if (shouldSendCompression(config.outputFormat)) appendImagesFormValue(formData, 'output_compression', config.outputCompression);
  refs.forEach((ref) => formData.append('image', ref.file, ref.name));
  return formData;
}

function buildUnifiedImagesPayload(config, count = config.imageCount, runIndex = 0) {
  const refs = config.refImages || refImages;
  const body = buildImagesPayload(config, count, runIndex);
  if (refs.length > 0) {
    body.ref_images = refs.map((ref, index) => ({
      name: ref.name || `reference-${index + 1}.jpg`,
      image_url: ref.dataUrl,
    }));
  }
  return body;
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
    if (status.authenticated) {
      hideAuthOverlay();
      return true;
    }
    if (!status.required) {
      // 无密码模式: 仅用 userId 静默登录, 拿到 Session
      const ok = await attemptLogin('', true);
      if (ok) return true;
      showAuthOverlay('登录失败, 请刷新重试.');
      return false;
    }
    // 需要密码: 尝试用保存的密码静默自动登录
    const savedPwd = (() => { try { return localStorage.getItem('_auth_pwd') || ''; } catch { return ''; } })();
    if (savedPwd) {
      const ok = await attemptLogin(savedPwd, true);
      if (ok) return true;
      try { localStorage.removeItem('_auth_pwd'); } catch {}
    }
    showAuthOverlay('服务器已启用访问密码保护.');
    return false;
  } catch {
    return true;
  }
}

async function attemptLogin(password, silent = false) {
  try {
    const userId = getOrCreateUserId();
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, userId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (password) {
      try { localStorage.setItem('_auth_pwd', password); } catch {}
    }
    hideAuthOverlay();
    await loadServerConfig();
    queueStart(true);
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
    image.addEventListener('click', () => openPreview(refImages.map((r) => r.dataUrl), index));
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

async function addRefFile(file) {
  const ref = await prepareReferenceFile(file);
  if (!ref) return false;
  if (!enforceRefTotalLimit(refImages, ref.file)) return false;
  refImages.push(ref);
  renderThumbnails();
  return true;
}

async function addRefFiles(files) {
  let added = 0;
  for (const file of Array.from(files || [])) {
    if (await addRefFile(file)) added += 1;
  }
  els.imageFile.value = '';
  if (added > 0) {
    const total = totalRefBytes(refImages);
    setStatus('done', `已添加 ${added} 张参考图, 上传前会自动压缩. 当前参考图总量 ${formatBytes(total)}.`);
  }
}

function clearRefImages() {
  refImages = [];
  renderThumbnails();
}

function clipboardImageFiles(event) {
  const items = Array.from(event.clipboardData?.items || []);
  return items
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

async function handlePasteImages(event) {
  if (!els.tabDraw.classList.contains('active')) return;
  const files = clipboardImageFiles(event);
  if (!files.length) return;
  event.preventDefault();
  await addRefFiles(files);
}

function handleRefDragOver(event) {
  if (!Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return;
  event.preventDefault();
  els.thumbRow.classList.add('drag-over');
}

function handleRefDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  els.thumbRow.classList.remove('drag-over');
}

async function handleRefDrop(event) {
  event.preventDefault();
  els.thumbRow.classList.remove('drag-over');
  const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));
  if (!files.length) return;
  await addRefFiles(files);
}

function renderSeriesThumbnails() {
  els.seriesThumbRow.querySelectorAll('.thumb-item').forEach((item) => item.remove());
  seriesRefImages.forEach((ref, index) => {
    const item = document.createElement('div');
    item.className = 'thumb-item series-thumb-item';
    const image = document.createElement('img');
    image.src = ref.dataUrl;
    image.alt = `系列参考图 ${index + 1}`;
    image.addEventListener('click', () => openPreview(seriesRefImages.map((r) => r.dataUrl), index));
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

async function addSeriesRefFiles(files) {
  let added = 0;
  for (const file of Array.from(files || [])) {
    const ref = await prepareReferenceFile(file);
    if (!ref) continue;
    if (!enforceRefTotalLimit(seriesRefImages, ref.file)) continue;
    seriesRefImages.push(ref);
    added += 1;
  }
  renderSeriesThumbnails();
  els.seriesImageFile.value = '';
  if (added > 0) {
    const total = totalRefBytes(seriesRefImages);
    setSeriesStatus('done', `已添加 ${added} 张系列参考图, 上传前会自动压缩. 当前参考图总量 ${formatBytes(total)}.`);
  }
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
    image.addEventListener('click', () => {
      const list = isGallery ? gallery : (record.seriesId ? seriesResults : currentResults);
      const items = list.filter((r) => r && r.dataUrl).map((r) => r.dataUrl);
      const idx = items.indexOf(record.dataUrl);
      openPreview(items, idx >= 0 ? idx : 0);
    });
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
  openPreview([record.dataUrl], 0, '右键图片 → 复制图片');
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
  els.outputFormat.value = 'auto';
  els.outputCompression.value = '90';
}



const SERIES_PRESETS = {
  ecommerce: {
    label: '电商详情',
    planSystem: '你是电商详情页策划。根据共同风格生成 5 到 8 张详情页模块清单。只输出多行文本, 每行格式为“页面标题: 页面目标”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是电商视觉设定提示词优化器。请整理成稳定的一致性视觉规范。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含色彩, 光影, 背景, 构图, 材质, 版式和一致性约束。',
    outputRule: '生成单张电商详情页视觉模块, 构图完整, 避免乱码文字, 如需文字仅保留短标题区域和信息占位感.',
  },
  sticker: {
    label: 'IP 表情',
    planSystem: '你是 IP 表情包策划。根据共同风格生成 8 到 12 个表情包动作清单。只输出多行文本, 每行格式为“表情标题: 动作和表情描述”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是 IP 角色一致性提示词优化器。请整理成稳定的角色设定和表情包视觉规范。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含角色外观, 服饰, 比例, 线条, 表情风格, 背景和一致性约束。',
    outputRule: '生成单张表情包贴纸图, 角色外观必须一致, 动作表情夸张清晰, 背景简洁或透明, 避免乱码文字.',
  },
  character_action: {
    label: '角色动作',
    planSystem: '你是角色动作序列导演。根据共同风格生成 6 到 10 个动作关键帧清单。只输出多行文本, 每行格式为“关键帧标题: 姿态和动作描述”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是角色动作一致性提示词优化器。请整理成稳定的角色外观和动作序列视觉规范。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含角色外观, 服装, 比例, 镜头角度, 动作连贯性和一致性约束。',
    outputRule: '生成单张动作关键帧, 角色外观和服装保持一致, 姿态清晰, 动作连贯, 适合作为序列帧参考.',
  },
  storyboard: {
    label: '影视分镜',
    planSystem: '你是影视分镜导演。根据共同风格生成 6 到 10 个分镜镜头清单。只输出多行文本, 每行格式为“镜头标题: 景别, 构图, 动作和情绪”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是分镜视觉一致性提示词优化器。请整理成稳定的镜头语言和视觉规范。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含美术风格, 色彩, 光影, 镜头语言, 角色一致性和场景一致性约束。',
    outputRule: '生成单张分镜图, 强调景别, 构图, 情绪和镜头语言, 角色与场景设定保持一致.',
  },
  poster_campaign: {
    label: '品牌海报',
    planSystem: '你是品牌海报组策划。根据共同风格生成 4 到 8 张海报组清单。只输出多行文本, 每行格式为“海报标题: 视觉目标和传播重点”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是品牌海报视觉设定提示词优化器。请整理成稳定的品牌视觉规范。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含品牌色, 版式, 材质, 光影, 构图, 字体氛围和一致性约束。',
    outputRule: '生成单张品牌海报视觉, 保持品牌色和版式系统一致, 避免乱码文字, 可保留标题和信息占位区域.',
  },
  custom: {
    label: '通用系列',
    planSystem: '你是视觉序列策划。根据共同风格生成 5 到 8 张序列图片清单。只输出多行文本, 每行格式为“标题: 画面目标”, 不要解释, 不要编号, 不要 Markdown。',
    optimizeSystem: '你是视觉序列一致性提示词优化器。请整理成稳定的统一视觉设定。只输出优化后的统一设定, 不要解释, 不要编号, 不要 Markdown。必须包含主体一致性, 色彩, 光影, 构图, 风格和变化边界。',
    outputRule: '生成单张序列图片, 保持统一设定一致, 同时满足当前画面目标.',
  },
};

let activeSeriesPresetId = 'custom';

function getSeriesPreset() {
  return SERIES_PRESETS[activeSeriesPresetId] || SERIES_PRESETS.custom;
}

function selectSeriesPreset(presetId) {
  if (!SERIES_PRESETS[presetId]) return;
  activeSeriesPresetId = presetId;
  if (!els.seriesPresetChips) return;
  els.seriesPresetChips.querySelectorAll('[data-series-preset]').forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-series-preset') === presetId);
  });
}

function renderSeriesPresetChips() {
  if (!els.seriesPresetChips) return;
  els.seriesPresetChips.innerHTML = Object.entries(SERIES_PRESETS).map(([id, preset]) => `
    <button type="button" class="series-preset-chip${id === activeSeriesPresetId ? ' active' : ''}" data-series-preset="${id}">${escapeHtml(preset.label)}</button>
  `).join('');
}

function resolveSeriesImageSpec() {
  return resolveSpecFromRatio(els.seriesAspectRatio.value);
}

function getSeriesSharedConfig(prompt, total) {
  const outputFormat = 'auto';
  els.seriesOutputFormat.value = outputFormat;
  els.seriesOutputCompression.value = '90';
  const effectivePrompt = prompt || buildSeriesBasePrompt() || '系列母版';
  const base = getConfig({ promptOverride: effectivePrompt, imageCountOverride: total, refImagesOverride: seriesRefImages });
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
  els.seriesOutputFormat.value = 'auto';
  els.seriesOutputCompression.value = '90';
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
    ? `当前 ${pages.length} 张图, 会共用风格设定逐张生成.`
    : '会按镜头清单逐张生成, 每张完成后即出现在右侧.';
}

function buildSeriesBasePrompt() {
  const title = els.seriesTitle.value.trim();
  const style = els.seriesStylePrompt.value.trim();
  return [
    `系列类型: ${getSeriesPreset().label}`,
    title ? `系列名称: ${title}` : '',
    style ? `共同风格: ${style}` : '',
    '一致性要求: 所有图片必须共享同一系列母版, 包括主体身份, 核心外观, 色彩系统, 光影方向, 视觉风格和画面质感. 每张图只改变镜头清单中指定的差异点, 不要无故改变主体设定或整体风格.',
  ].filter(Boolean).join('\n');
}

function buildSeriesImagePrompt(page, total) {
  return `${buildSeriesBasePrompt()}\n\n当前资产: 第 ${page.index + 1}/${total} 张, ${page.title}.\n本张差异点: ${page.prompt}\n输出要求: ${getSeriesPreset().outputRule}`;
}

function ensureSeriesInputs(requireTextModel = false) {
  const title = els.seriesTitle.value.trim();
  const style = els.seriesStylePrompt.value.trim();
  const pages = parseSeriesPages();
  if (!title) throw new Error('请填写系列名称');
  if (!style) throw new Error('请填写共同风格');
  if (!pages.length) throw new Error('请填写镜头清单, 每行一张图');
  if (requireTextModel && !els.textModel.value.trim()) throw new Error('请填写文本模型, 用于系列文本优化');
  return { title, style, pages };
}

function buildSeriesPlanPayload(config) {
  return {
    model: config.textModel,
    input: [
      { role: 'system', content: getSeriesPreset().planSystem },
      {
        role: 'user',
        content: `系列名称: ${els.seriesTitle.value.trim()}\n共同风格: ${els.seriesStylePrompt.value.trim()}`,
      },
    ],
    stream: false,
  };
}

function buildSeriesOptimizePayload(config) {
  return {
    model: config.textModel,
    input: [
      { role: 'system', content: getSeriesPreset().optimizeSystem },
      {
        role: 'user',
        content: `系列名称: ${els.seriesTitle.value.trim()}\n原共同风格: ${els.seriesStylePrompt.value.trim()}`,
      },
    ],
    stream: false,
  };
}

async function requestTextGeneration(payload) {
  const config = getConfig({ promptOverride: els.prompt.value || '占位提示词', requireTextModel: true });
  const stopFeedback = startTextWaitFeedback((message) => setSeriesStatus('info', message));
  const response = await fetch(isProxyBaseUrl(config.baseUrl) ? '/api/text' : apiEndpoint(config, '/v1/responses'), {
    method: 'POST',
    headers: requestHeaders(config, false),
    body: JSON.stringify(payload(config)),
  }).finally(stopFeedback);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await parseErrorResponse(response)}`);
  const data = await response.json();
  const summary = textAttemptSummary(data.attempts);
  if (summary) setSeriesStatus('info', `${summary} 当前结果已返回, 正在写入.`);
  const text = data.text || extractText(data);
  if (!text) throw new Error('文本模型没有返回内容');
  return text;
}

async function generateSeriesPlan() {
  try {
    if (!els.seriesStylePrompt.value.trim()) throw new Error('请先填写共同风格');
    markTaskActive(true);
    els.seriesPlanBtn.disabled = true;
    els.seriesPlanBtn.textContent = '规划中...';
    setSeriesStatus('info', '正在根据共同风格规划镜头清单...');
    const text = await requestTextGeneration(buildSeriesPlanPayload);
    els.seriesPagePlan.value = text.trim();
    updateSeriesCountHint();
    setSeriesStatus('done', '镜头清单已规划, 可以继续手动微调后生成整套资产.');
  } catch (error) {
    setSeriesStatus('err', `镜头规划失败: ${error.message || error}`);
  } finally {
    markTaskActive(false);
    els.seriesPlanBtn.disabled = false;
    els.seriesPlanBtn.textContent = '✨ 规划镜头';
  }
}

async function optimizeSeriesStyle() {
  try {
    if (!els.seriesStylePrompt.value.trim()) throw new Error('请先填写共同风格');
    originalSeriesStyle = els.seriesStylePrompt.value;
    markTaskActive(true);
    els.seriesOptimizeBtn.disabled = true;
    els.seriesOptimizeBtn.textContent = '提炼中...';
    setSeriesStatus('info', '正在提炼共同风格...');
    const text = await requestTextGeneration(buildSeriesOptimizePayload);
    els.seriesStylePrompt.value = text.trim();
    setSeriesStatus('done', '共同风格已提炼, 会作为每张图的一致性约束.');
  } catch (error) {
    setSeriesStatus('err', `风格提炼失败: ${error.message || error}`);
  } finally {
    markTaskActive(false);
    els.seriesOptimizeBtn.disabled = false;
    els.seriesOptimizeBtn.textContent = '✨ 提炼风格';
  }
}

async function retrySeriesRecord(recordId) {
  const record = seriesResults.find((item) => item.id === recordId);
  if (!record || !record.configSnapshot) return;
  const snapshot = { ...record.configSnapshot };
  if (record.providerId) snapshot._excludeProviderId = record.providerId;
  updateSeriesResult(record.id, { status: 'pending', error: '', time: new Date().toLocaleString('zh-CN') });
  appendEvent('event', `第 ${record.pageIndex} 张系列资产重新加入队列`);
  try {
    await submitRecordToQueue({ ...record, configSnapshot: snapshot }, {
      kind: 'series',
      runIndex: Math.max(0, (record.pageIndex || 1) - 1),
    });
  } catch (error) {
    const message = error.message || String(error);
    updateSeriesResult(record.id, { status: 'failed', error: message, time: new Date().toLocaleString('zh-CN') });
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
  const seriesId = `series-${Date.now()}`;
  let baseConfig;
  try {
    baseConfig = getSeriesSharedConfig('', series.pages.length);
  } catch (error) {
    setSeriesStatus('err', `参数有误: ${error.message || error}`);
    alert(error.message || String(error));
    return;
  }
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
  setSeriesStatus('info', `已加入队列: ${series.title}, ${series.pages.length} 张系列图. 完成后会自动出现.`);
  appendEvent('event', `已加入队列: 系列 ${series.title} ${series.pages.length} 张`);
  els.seriesRunSummary.textContent = `已加入队列 ${series.pages.length} 张系列图, 进度见顶部队列条.`;
  for (let i = 0; i < seriesResults.length; i += 1) {
    const record = seriesResults[i];
    try {
      await submitRecordToQueue(record, { kind: 'series', runIndex: i });
    } catch (error) {
      const message = error.message || String(error);
      updateSeriesResult(record.id, { status: 'failed', error: message, time: new Date().toLocaleString('zh-CN') });
      appendEvent('event', `第 ${record.pageIndex} 张入队失败: ${message}`);
    }
  }
  syncSeriesFormatAndBackground();
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

async function buildGeneratedRecord(rawDataUrl, config, index, options = {}) {
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
    providerId: config._lastProviderId || '',
  };
}

async function retrySingleRecord(recordId) {
  const record = currentResults.find((item) => item.id === recordId);
  if (!record || !record.configSnapshot) return;
  const snapshot = { ...record.configSnapshot };
  if (record.providerId) snapshot._excludeProviderId = record.providerId;
  updateCurrentResult(record.id, { status: 'pending', error: '', time: new Date().toLocaleString('zh-CN') });
  appendEvent('event', `第 ${record.pageIndex} 张重新加入队列`);
  try {
    await submitRecordToQueue({ ...record, configSnapshot: snapshot }, {
      kind: 'single',
      runIndex: Math.max(0, (record.pageIndex || 1) - 1),
    });
  } catch (error) {
    const message = error.message || String(error);
    updateCurrentResult(record.id, { status: 'failed', error: message, time: new Date().toLocaleString('zh-CN') });
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
  const runId = `single-${Date.now()}`;
  currentResults = Array.from({ length: config.imageCount }, (_, index) => createSinglePlaceholder({
    id: `${runId}-${index + 1}`,
    configSnapshot: { ...config },
    index,
  }));
  renderResults();
  setStatus('info', `已加入队列: ${config.imageCount} 张图片. 你可以继续操作或切换页签, 完成后画廊自动出现新图.`);
  appendEvent('event', `已加入队列: ${config.imageCount} 张图片`);
  els.runSummary.textContent = `已加入队列 ${config.imageCount} 张, 进度见顶部队列条.`;
  for (let i = 0; i < currentResults.length; i += 1) {
    const record = currentResults[i];
    try {
      await submitRecordToQueue(record, { kind: 'single', runIndex: i });
    } catch (error) {
      const message = error.message || String(error);
      updateCurrentResult(record.id, { status: 'failed', error: message, time: new Date().toLocaleString('zh-CN') });
      appendEvent('event', `第 ${record.pageIndex} 张入队失败: ${message}`);
    }
  }
  syncFormatAndBackground();
}

function updatePreviewTransform() {
  els.previewImg.style.transform = `translate(${panX}px, ${panY}px) scale(${previewScale})`;
}

function openPreview(items, startIndex = 0, hint) {
  const list = Array.isArray(items) ? items : [items];
  previewList = list.filter(Boolean);
  if (!previewList.length) return;
  previewIndex = Math.max(0, Math.min(previewList.length - 1, startIndex));
  els.previewOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  showCurrentPreview(hint);
}

function showCurrentPreview(hint) {
  previewScale = 1;
  panX = 0;
  panY = 0;
  els.previewImg.src = previewList[previewIndex] || '';
  updatePreviewTransform();
  const hintEl = $('#previewHint');
  if (hintEl) {
    hintEl.textContent = previewList.length > 1
      ? `${previewIndex + 1} / ${previewList.length} · ←→ 切换 · 滚轮缩放 · ESC 关闭`
      : (hint || '滚轮缩放 · 拖拽平移 · ESC 关闭');
  }
  const multi = previewList.length > 1;
  if (els.previewPrev) els.previewPrev.hidden = !multi;
  if (els.previewNext) els.previewNext.hidden = !multi;
}

function navigatePreview(delta) {
  if (previewList.length <= 1) return;
  previewIndex = (previewIndex + delta + previewList.length) % previewList.length;
  showCurrentPreview();
}

function closePreview() {
  els.previewOverlay.classList.remove('open');
  document.body.style.overflow = '';
  previewList = [];
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
      const slice = { index, row: row + 1, col: col + 1, canvas, dataUrl, crop, filename: `slice-${String(index).padStart(2, '0')}.${splitExt(config.format)}` };
      splitSlices.push(slice);
      const card = document.createElement('article');
      card.className = 'split-slice-card';
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'split-slice-preview';
      preview.style.aspectRatio = `${crop.width} / ${crop.height}`;
      preview.addEventListener('click', () => openPreview([slice.dataUrl], 0));
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

// ═══ Queue UI: poll /api/jobs/me + render strip & drawer + dispatch completion ═══

const QUEUE_POLL_ACTIVE_MS = 1500;
const QUEUE_POLL_IDLE_MS = 5000;
const QUEUE_BADGE = {
  pending: '🟡 排队中',
  running: '🟢 生成中',
  succeeded: '✅ 完成',
  failed: '❌ 失败',
  canceled: '⏸ 已取消',
};
let myJobs = [];
let queueGlobalActive = 0;
let queueGlobalQueued = 0;
let queuePollTimer = null;
let queueExpanded = false;
const dispatchedJobs = new Set();
const queueCompletionHandlers = new Map();

function registerCompletionHandler(kind, fn) {
  queueCompletionHandlers.set(kind, fn);
}

function encodeClientContext(ctx) {
  if (!ctx) return '';
  const json = JSON.stringify(ctx);
  if (typeof TextEncoder === 'function') {
    return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  }
  return btoa(unescape(encodeURIComponent(json)));
}

async function queueSubmit({ endpoint, body, contentType, clientContext, providerId, excludeProviderId }) {
  const headers = {};
  if (contentType) headers['Content-Type'] = contentType;
  const provHdrs = providerHeader({
    providerId: providerId || selectedProviderId(),
    _excludeProviderId: excludeProviderId || '',
  });
  Object.assign(headers, provHdrs);
  if (clientContext) {
    headers['X-Client-Context'] = encodeClientContext(clientContext);
  }
  const url = `/api/jobs${endpoint.replace(/^\/v1/, '')}`;
  const response = await fetch(url, { method: 'POST', headers, body, credentials: 'include' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  const job = await response.json();
  myJobs = [job, ...myJobs.filter((j) => j.id !== job.id)];
  renderQueueStrip();
  queueStart(true);
  return job;
}

function stripConfigForContext(snapshot) {
  if (!snapshot) return {};
  const { refImages, apiKey, ...rest } = snapshot;
  rest.hasRefImages = Boolean(refImages && refImages.length);
  return rest;
}

async function submitRecordToQueue(record, contextExtra = {}) {
  const snapshot = record.configSnapshot || {};
  const runIndex = contextExtra.runIndex ?? Math.max(0, (record.pageIndex || 1) - 1);
  const { endpoint, body, contentType } = buildEndpointAndBody(snapshot, runIndex);
  const clientContext = {
    kind: contextExtra.kind,
    placeholderId: record.id,
    runIndex,
    pageIndex: record.pageIndex || 1,
    pageTotal: record.pageTotal || snapshot.imageCount || 1,
    seriesId: record.seriesId || '',
    seriesTitle: record.seriesTitle || '',
    pageTitle: record.pageTitle || '',
    configSnapshot: stripConfigForContext(snapshot),
  };
  return queueSubmit({
    endpoint,
    body,
    contentType,
    clientContext,
    providerId: snapshot.providerId,
    excludeProviderId: snapshot._excludeProviderId,
  });
}

async function queueCancel(jobId) {
  try {
    const response = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    await queueTick();
  } catch (error) {
    setStatus('err', `取消失败: ${error.message || error}`);
  }
}

async function queueTick() {
  try {
    const response = await fetch('/api/jobs/me', { credentials: 'include' });
    if (!response.ok) {
      if (response.status === 401) {
        queueStop();
        return;
      }
      scheduleQueuePoll();
      return;
    }
    const data = await response.json();
    myJobs = Array.isArray(data.jobs) ? data.jobs : [];
    queueGlobalActive = data.globalActive || 0;
    queueGlobalQueued = data.globalQueued || 0;
    renderQueueStrip();
    for (const job of myJobs) {
      if ((job.status === 'succeeded' || job.status === 'failed') && !dispatchedJobs.has(job.id)) {
        dispatchedJobs.add(job.id);
        dispatchJobCompletion(job).catch(() => {});
      }
    }
    const stillBusy = myJobs.some((j) => j.status === 'pending' || j.status === 'running');
    if (!stillBusy && els.loadingMini.classList.contains('active')) {
      stopTimer();
      els.loadingMini.classList.remove('active');
    }
  } catch {
    // network blip, retry on next schedule
  }
  scheduleQueuePoll();
}

function scheduleQueuePoll() {
  if (queuePollTimer) clearTimeout(queuePollTimer);
  if (document.hidden) {
    queuePollTimer = null;
    return;
  }
  const hasActive = myJobs.some((j) => j.status === 'pending' || j.status === 'running');
  const interval = hasActive ? QUEUE_POLL_ACTIVE_MS : QUEUE_POLL_IDLE_MS;
  queuePollTimer = setTimeout(() => queueTick(), interval);
}

function queueStart(force = false) {
  if (typeof fetch !== 'function') return;
  if (queuePollTimer && !force) return;
  if (queuePollTimer) clearTimeout(queuePollTimer);
  queuePollTimer = null;
  queueTick();
}

function queueStop() {
  if (queuePollTimer) clearTimeout(queuePollTimer);
  queuePollTimer = null;
}

async function dispatchJobCompletion(job) {
  const kind = job.clientContext?.kind;
  const handler = queueCompletionHandlers.get(kind);
  if (!handler) return;
  if (job.status === 'failed') {
    try { await handler({ job, result: null, error: job.error || '生成失败' }); } catch {}
    return;
  }
  try {
    const response = await fetch(`/api/jobs/${job.id}/result`, { credentials: 'include' });
    if (!response.ok) {
      await handler({ job, result: null, error: `HTTP ${response.status}` });
      return;
    }
    const result = await response.json();
    await handler({ job, result });
  } catch (error) {
    await handler({ job, result: null, error: error.message || String(error) });
  }
}

function renderQueueStrip() {
  if (!els.queueStrip) return;
  const running = myJobs.filter((j) => j.status === 'running').length;
  const pending = myJobs.filter((j) => j.status === 'pending').length;
  const hasAny = myJobs.length > 0;
  els.queueStrip.hidden = !hasAny;
  if (!hasAny) {
    queueExpanded = false;
    if (els.queueDrawer) els.queueDrawer.hidden = true;
    els.queueStrip.classList.remove('expanded');
    return;
  }
  if (els.queueRunningCount) els.queueRunningCount.textContent = String(running);
  if (els.queuePendingCount) els.queuePendingCount.textContent = String(pending);
  if (els.queueStripRunning) els.queueStripRunning.hidden = running === 0;
  if (els.queueStripPending) els.queueStripPending.hidden = pending === 0;
  if (els.queueStripIdle) els.queueStripIdle.hidden = running > 0 || pending > 0;
  if (els.queueGlobalActive) els.queueGlobalActive.textContent = String(queueGlobalActive);
  if (els.queueGlobalQueued) els.queueGlobalQueued.textContent = String(queueGlobalQueued);

  if (!els.queueDrawerList) return;
  els.queueDrawerList.innerHTML = myJobs.map((job) => {
    const status = job.status;
    const ctx = job.clientContext || {};
    const promptText = ctx.configSnapshot?.prompt || '';
    const promptPreview = escapeHtml(String(promptText).slice(0, 60) || '(无 prompt)');
    let meta = '';
    if (status === 'running') {
      meta = `${formatDuration(job.elapsedMs || 0)} 已用`;
    } else if (status === 'pending') {
      const ahead = Math.max(0, (job.yourPosition || 1) - 1);
      meta = ahead === 0 ? '即将开始' : `你前面 ${ahead} 个`;
    } else if (status === 'succeeded') {
      meta = '已加入画廊';
    } else if (status === 'failed') {
      meta = `失败: ${escapeHtml(String(job.error || '').slice(0, 80))}`;
    } else if (status === 'canceled') {
      meta = '已取消';
    }
    const actionBtn = status === 'pending'
      ? `<button class="queue-row-action-btn danger" data-cancel-job="${escapeHtml(job.id)}" type="button">取消</button>`
      : '';
    return `
      <div class="queue-row status-${status}" data-job-id="${escapeHtml(job.id)}">
        <span class="queue-row-badge">${QUEUE_BADGE[status] || status}</span>
        <span class="queue-row-prompt" title="${promptPreview}">${promptPreview}</span>
        <span class="queue-row-meta">${meta}</span>
        <span class="queue-row-actions">${actionBtn}</span>
      </div>
    `;
  }).join('');
}

function toggleQueueDrawer(force) {
  if (!els.queueStrip || !els.queueDrawer) return;
  queueExpanded = typeof force === 'boolean' ? force : !queueExpanded;
  els.queueStrip.classList.toggle('expanded', queueExpanded);
  els.queueDrawer.hidden = !queueExpanded;
  if (els.queueStripToggle) els.queueStripToggle.setAttribute('aria-expanded', String(queueExpanded));
}

// ═══ Completion handlers wired by flows ═══

async function dataUrlFromQueueResult(result, format) {
  if (!result) return '';
  const dataUrls = await extractImagesApiResults(result, format || 'auto');
  if (dataUrls.length) return dataUrls[0];
  const fallback = extractBase64AsDataUrl(result, format || 'auto');
  return fallback || '';
}

function buildEndpointAndBody(snapshot, runIndex) {
  const refs = snapshot.refImages || [];
  if (refs.length > 0) {
    return { endpoint: '/v1/images/generations', body: JSON.stringify(buildUnifiedImagesPayload(snapshot, 1, runIndex)), contentType: 'application/json' };
  }
  if (snapshot.generationMode === 'images') {
    return { endpoint: '/v1/images/generations', body: JSON.stringify(buildImagesPayload(snapshot, 1, runIndex)), contentType: 'application/json' };
  }
  return { endpoint: '/v1/responses', body: JSON.stringify(buildImagePayload(snapshot, runIndex)), contentType: 'application/json' };
}


registerCompletionHandler('single', async ({ job, result, error }) => {
  const ctx = job.clientContext || {};
  const placeholderId = ctx.placeholderId;
  if (!placeholderId) return;
  const placeholder = currentResults.find((r) => r.id === placeholderId);
  if (error || !result) {
    updateCurrentResult(placeholderId, { status: 'failed', error: error || '生成失败', time: new Date().toLocaleString('zh-CN') });
    return;
  }
  const snapshot = ctx.configSnapshot || {};
  const dataUrl = await dataUrlFromQueueResult(result, snapshot.outputFormat || 'auto');
  if (!dataUrl) {
    updateCurrentResult(placeholderId, { status: 'failed', error: '生成结果未包含图片数据', time: new Date().toLocaleString('zh-CN') });
    return;
  }
  const refDataUrls = placeholder?.refDataUrls || [];
  const cfg = {
    ...snapshot,
    refImages: refDataUrls.map((url) => ({ dataUrl: url })),
    imageCount: snapshot.imageCount || 1,
    _lastProviderId: job.providerId || '',
  };
  try {
    const record = await buildGeneratedRecord(dataUrl, cfg, ctx.runIndex || 0, { id: placeholderId });
    replaceCurrentResult(placeholderId, record);
    await addToGallery(record);
    appendEvent('done', `第 ${ctx.pageIndex || 1} 张已生成, 大小 ${formatBytes(record.bytes)}`);
  } catch (err) {
    updateCurrentResult(placeholderId, { status: 'failed', error: err.message || String(err), time: new Date().toLocaleString('zh-CN') });
  }
});

registerCompletionHandler('series', async ({ job, result, error }) => {
  const ctx = job.clientContext || {};
  const placeholderId = ctx.placeholderId;
  if (!placeholderId) return;
  const placeholder = seriesResults.find((r) => r.id === placeholderId);
  if (error || !result) {
    updateSeriesResult(placeholderId, { status: 'failed', error: error || '生成失败', time: new Date().toLocaleString('zh-CN') });
    return;
  }
  const snapshot = ctx.configSnapshot || {};
  const dataUrl = await dataUrlFromQueueResult(result, snapshot.outputFormat || 'auto');
  if (!dataUrl) {
    updateSeriesResult(placeholderId, { status: 'failed', error: '生成结果未包含图片数据', time: new Date().toLocaleString('zh-CN') });
    return;
  }
  const refDataUrls = placeholder?.refDataUrls || [];
  const cfg = {
    ...snapshot,
    refImages: refDataUrls.map((url) => ({ dataUrl: url })),
    imageCount: ctx.pageTotal || 1,
    _lastProviderId: job.providerId || '',
  };
  try {
    const record = await buildGeneratedRecord(dataUrl, cfg, (ctx.pageIndex || 1) - 1, {
      id: placeholderId,
      seriesId: ctx.seriesId,
      seriesTitle: ctx.seriesTitle,
      pageTitle: ctx.pageTitle,
      pageIndex: ctx.pageIndex,
    });
    record.pageTotal = ctx.pageTotal || 1;
    replaceSeriesResult(placeholderId, record);
    await addToGallery(record);
    appendEvent('done', `第 ${ctx.pageIndex || 1} 张系列已生成, 大小 ${formatBytes(record.bytes)}`);
  } catch (err) {
    updateSeriesResult(placeholderId, { status: 'failed', error: err.message || String(err), time: new Date().toLocaleString('zh-CN') });
  }
});

function bindEvents() {
  if (els.authForm) els.authForm.addEventListener('submit', loginWithPassword);
  if (els.queueStripToggle) {
    els.queueStripToggle.addEventListener('click', () => toggleQueueDrawer());
  }
  if (els.queueDrawerList) {
    els.queueDrawerList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cancel-job]');
      if (!button) return;
      const jobId = button.getAttribute('data-cancel-job');
      if (jobId) queueCancel(jobId);
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      queueStop();
    } else if (myJobs.length) {
      queueStart(true);
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!hasActiveTask()) return;
    event.preventDefault();
    event.returnValue = '当前还有生成或系列文本任务正在进行. 刷新或关闭页面会丢失当前任务状态.';
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
  document.addEventListener('paste', handlePasteImages);
  els.thumbRow.addEventListener('dragover', handleRefDragOver);
  els.thumbRow.addEventListener('dragleave', handleRefDragLeave);
  els.thumbRow.addEventListener('drop', handleRefDrop);
  els.seriesThumbAdd.addEventListener('click', () => els.seriesImageFile.click());
  els.seriesImageFile.addEventListener('change', () => addSeriesRefFiles(els.seriesImageFile.files));
  els.seriesClearRefsBtn.addEventListener('click', clearSeriesRefImages);
  els.background.addEventListener('change', syncFormatAndBackground);
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
  if (els.seriesPresetChips) {
    els.seriesPresetChips.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-series-preset]');
      if (chip) selectSeriesPreset(chip.getAttribute('data-series-preset'));
    });
  }
  els.seriesBackground.addEventListener('change', syncSeriesFormatAndBackground);
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
  if (els.previewPrev) els.previewPrev.addEventListener('click', (event) => {
    event.stopPropagation();
    navigatePreview(-1);
  });
  if (els.previewNext) els.previewNext.addEventListener('click', (event) => {
    event.stopPropagation();
    navigatePreview(1);
  });
  document.addEventListener('keydown', (event) => {
    if (!els.previewOverlay.classList.contains('open')) return;
    if (event.key === 'Escape') closePreview();
    else if (event.key === 'ArrowLeft') { event.preventDefault(); navigatePreview(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); navigatePreview(1); }
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
  getOrCreateUserId();
  readSettings();
  bindEvents();
  syncFormatAndBackground();
  renderSeriesPresetChips();
  syncSeriesFormatAndBackground();
  updateSeriesCountHint();
  renderResults();
  renderSeriesResults();
  loadGallery();
  if (await checkAuthStatus()) {
    await loadServerConfig();
    queueStart(true);
  }
}

initializeApp();
