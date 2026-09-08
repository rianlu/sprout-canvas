import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_CONFIG_PATH = path.join(ROOT, 'config', 'local.config.json');

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
    capabilities: {
      outputFormats: provider.capabilities?.outputFormats ?? ['png', 'jpeg', 'webp'],
      exactSize: provider.capabilities?.exactSize ?? false,
    },
    requestHeaders: provider.requestHeaders && typeof provider.requestHeaders === 'object' ? provider.requestHeaders : {},
  };
  if (!config.apiKey) throw new Error(`生图服务商 ${name} 缺少 apiKey. 请检查 ${path.relative(ROOT, LOCAL_CONFIG_PATH)}`);
  if (!['images', 'responses'].includes(config.generationMode)) throw new Error(`生图服务商 ${name} 的 generationMode 只能是 images 或 responses`);
  if (!Array.isArray(config.capabilities.outputFormats) || !config.capabilities.outputFormats.length || config.capabilities.outputFormats.some((format) => !['png', 'jpeg', 'webp'].includes(format)) || typeof config.capabilities.exactSize !== 'boolean') throw new Error(`生图服务商 ${name} 的 capabilities 配置无效`);
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

export async function readLocalConfig(providerId) {
  let fileConfig = {};
  if (existsSync(LOCAL_CONFIG_PATH)) {
    fileConfig = JSON.parse(await readFile(LOCAL_CONFIG_PATH, 'utf8'));
  }

  const legacyProviders = Array.isArray(fileConfig.providers) ? fileConfig.providers.filter(Boolean) : [];
  const fileImageProviders = Array.isArray(fileConfig.imageProviders) ? fileConfig.imageProviders.filter(Boolean) : [];
  const envApiKey = process.env.OPENAI_API_KEY || process.env.ANYROUTER_API_KEY;
  const rawImageProviders = fileImageProviders.length
    ? fileImageProviders
    : legacyProviders.length
      ? legacyProviders
      : [{
        id: fileConfig.providerId || 'default',
        name: fileConfig.providerName || '默认生图服务商',
        baseUrl: fileConfig.baseUrl || 'https://api.openai.com',
        apiKey: fileConfig.apiKey || '',
        imageModel: fileConfig.imageModel || 'gpt-image-2',
        generationMode: fileConfig.generationMode || 'images',
      }];
  const firstImageId = normalizeProviderId(rawImageProviders[0].id || rawImageProviders[0].name, 'image-provider-1');
  const defaultImageProvider = normalizeProviderId(process.env.DEFAULT_IMAGE_PROVIDER || process.env.DEFAULT_PROVIDER || fileConfig.defaultImageProvider || fileConfig.defaultProvider || firstImageId, firstImageId);
  const imageProviders = rawImageProviders.map((provider, index) => {
    const id = normalizeProviderId(provider.id || provider.name, `image-provider-${index + 1}`);
    if (id !== defaultImageProvider) return normalizeImageProvider(provider, index);
    return normalizeImageProvider({
      ...provider,
      baseUrl: process.env.OPENAI_BASE_URL || process.env.ANYROUTER_BASE_URL || provider.baseUrl,
      apiKey: envApiKey || provider.apiKey,
      imageModel: process.env.IMAGE_MODEL || provider.imageModel || provider.model,
      generationMode: process.env.GENERATION_MODE || provider.generationMode,
    }, index);
  });

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
    baseUrl: (index === 0 && process.env.TEXT_BASE_URL) || provider.baseUrl || primaryTextProvider.baseUrl,
    apiKey: (index === 0 && process.env.TEXT_API_KEY) || provider.apiKey || primaryTextProvider.apiKey,
    textModel: (index === 0 && process.env.TEXT_MODEL) || provider.textModel || provider.model || primaryTextProvider.textModel,
    requestHeaders: provider.requestHeaders || {},
  }));
  const textProvider = textProviders[0];

  const requestedProvider = normalizeProviderId(providerId || defaultImageProvider, defaultImageProvider);
  const activeProvider = imageProviders.find((provider) => provider.id === requestedProvider);
  if (!activeProvider) throw new Error(`生图服务商不存在: ${requestedProvider}. 请检查 config/local.config.json 的 imageProviders 配置`);

  const dataDir = path.resolve(ROOT, process.env.DATA_DIR || fileConfig.dataDir || 'data');
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
    imageConcurrency: 1,
    dataDir,
    styleDataDir: path.join(dataDir, 'styles'),
    stateFile: path.resolve(ROOT, process.env.STATE_FILE || (process.env.DATA_DIR ? path.join(dataDir, 'runtime.sqlite') : fileConfig.stateFile || path.join(dataDir, 'runtime.sqlite'))),
    accessPassword: String(process.env.ACCESS_PASSWORD || fileConfig.accessPassword || '').trim(),
    adminPassword: String(process.env.ADMIN_PASSWORD ?? fileConfig.adminPassword ?? '').trim(),
    cookieNamespace: String(process.env.COOKIE_NAMESPACE ?? fileConfig.cookieNamespace ?? ''),
    authSessionDays: Math.max(1, Number(process.env.AUTH_SESSION_DAYS || fileConfig.authSessionDays || 7)),
    secureCookies: process.env.SECURE_COOKIES === undefined ? fileConfig.secureCookies === true : ['1', 'true'].includes(process.env.SECURE_COOKIES),
    logFile: String(process.env.LOG_FILE || fileConfig.logFile || path.join(ROOT, 'logs', 'server.log')).trim(),
  };
  if (Number(process.env.IMAGE_CONCURRENCY || fileConfig.imageConcurrency || 1) !== 1) throw new Error('imageConcurrency 必须为 1, 当前仅支持单 worker');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('PORT/port 必须是 1 到 65535 的整数');
  if (!Number.isFinite(config.authSessionDays)) throw new Error('AUTH_SESSION_DAYS/authSessionDays 必须是有效天数');
  if (process.env.SECURE_COOKIES !== undefined && !['0', '1', 'true', 'false'].includes(process.env.SECURE_COOKIES)) throw new Error('SECURE_COOKIES 仅支持 0/1/false/true');
  if (config.adminPassword && (isPlaceholderSecret(config.adminPassword) || config.adminPassword.length < 12 || config.adminPassword.length > 256 || config.adminPassword === config.accessPassword)) throw new Error('adminPassword 必须为 12 到 256 位, 不使用占位值, 且须与工作台访问密码不同');
  if (!/^[A-Za-z0-9_-]{0,64}$/.test(config.cookieNamespace)) throw new Error('cookieNamespace 只能包含最多 64 位英文字母, 数字, 下划线和短横线');
  validateProductionConfig(config);
  return config;
}

export function publicConfig(config) {
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
      capabilities: provider.capabilities,
      textModel: config.textModel,
    })),
  };
}
