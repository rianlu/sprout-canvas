// Per-user image generation queue with strict single-worker concurrency.
// Jobs are stored in memory, grouped by userId, served round-robin between users
// (FIFO within each user). Designed to avoid upstream rate-limit while keeping
// multi-user fairness without external dependencies.

let readLocalConfig = null;
let upstreamHeaders = null;
let timeoutSignal = null;
let stripHtml = null;
let logLine = null;
let IMAGE_UPSTREAM_TIMEOUT_MS = 180_000;
let RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS = 420_000;
let JOB_TTL_MS = 30 * 60 * 1000;

const pendingByUser = new Map();    // userId -> Job[]  (FIFO per user)
const imageJobs = new Map();        // jobId -> Job  (all known, until TTL)
const recentImageDurations = [];
let activeJob = null;
let lastServedUserId = '';
let imageJobSeq = 0;
const DEFAULT_IMAGE_DURATION_MS = 90_000;
const PROVIDER_FAILURE_THRESHOLD = 3;
const PROVIDER_CIRCUIT_OPEN_MS = 30 * 60 * 1000;
const providerCircuitState = new Map();

export function init(deps) {
  readLocalConfig = deps.readLocalConfig;
  upstreamHeaders = deps.upstreamHeaders;
  timeoutSignal = deps.timeoutSignal;
  stripHtml = deps.stripHtml;
  logLine = deps.logLine;
  if (deps.IMAGE_UPSTREAM_TIMEOUT_MS) IMAGE_UPSTREAM_TIMEOUT_MS = deps.IMAGE_UPSTREAM_TIMEOUT_MS;
  if (deps.RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS) RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS = deps.RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS;
  if (deps.JOB_TTL_MS) JOB_TTL_MS = deps.JOB_TTL_MS;
}

export function nextJobId() {
  imageJobSeq += 1;
  return `img_${Date.now()}_${imageJobSeq}`;
}

export function enqueue(job) {
  imageJobs.set(job.id, job);
  if (!pendingByUser.has(job.userId)) pendingByUser.set(job.userId, []);
  pendingByUser.get(job.userId).push(job);
  logLine('INFO', `[image-job] queued ${job.id} user=${job.userId} provider=${job.providerName || job.providerId || 'auto'} path=${job.upstreamPath}`);
  runWorker();
  return publicJob(job, job.userId);
}

export function retryFailedJob(jobId, viewerUserId) {
  const source = imageJobs.get(jobId);
  if (!source || source.userId !== viewerUserId) return { ok: false, status: 404, error: '任务不存在或已过期' };
  if (source.status !== 'failed') return { ok: false, status: 400, error: '只有失败任务可以重试' };
  const retryJob = {
    ...source,
    id: nextJobId(),
    status: 'pending',
    body: source.originalBody || source.body,
    originalBody: source.originalBody || source.body,
    autoProviderRouting: true,
    excludeProviderId: retryExcludeProviderIds(source),
    queuedAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
    error: '',
    result: null,
    attemptedProviderIds: [],
    retryOf: source.id,
    providerId: '',
    providerName: '自动调度',
    clientContext: source.clientContext ? { ...source.clientContext, placeholderId: nextJobId() } : source.clientContext,
  };
  return { ok: true, job: enqueue(retryJob) };
}

export function cancel(jobId, viewerUserId) {
  const job = imageJobs.get(jobId);
  if (!job || job.userId !== viewerUserId) return { ok: false, status: 404, error: '任务不存在或已过期' };
  if (job.status === 'pending') {
    const queue = pendingByUser.get(job.userId);
    if (queue) {
      const idx = queue.indexOf(job);
      if (idx >= 0) queue.splice(idx, 1);
    }
    job.status = 'canceled';
    job.finishedAt = Date.now();
    job.error = '已被用户取消';
    cleanupJobLater(job.id);
    logLine('INFO', `[image-job] canceled ${job.id} user=${viewerUserId}`);
    return { ok: true, job: publicJob(job, viewerUserId) };
  }
  if (job.status === 'running') {
    return { ok: false, status: 409, error: '任务正在生成, 暂不支持取消' };
  }
  return { ok: false, status: 400, error: `任务已${terminalLabel(job.status)}` };
}

export function getJobsForUser(userId) {
  const jobs = [];
  for (const job of imageJobs.values()) {
    if (job.userId === userId) jobs.push(publicJob(job, userId));
  }
  jobs.sort((a, b) => b.queuedAt - a.queuedAt);
  return {
    jobs: jobs.slice(0, 50),
    globalActive: activeJob ? 1 : 0,
    globalQueued: countGlobalQueued(),
    averageMs: averageImageDurationMs(),
  };
}

export function getJobStatus(jobId, viewerUserId) {
  const job = imageJobs.get(jobId);
  if (!job || job.userId !== viewerUserId) return null;
  return publicJob(job, viewerUserId);
}

export function getJobResult(jobId, viewerUserId) {
  const job = imageJobs.get(jobId);
  if (!job || job.userId !== viewerUserId) return { kind: 'missing' };
  if (job.status === 'pending' || job.status === 'running') {
    return { kind: 'progress', job: publicJob(job, viewerUserId) };
  }
  if (!job.result) {
    return {
      kind: 'result',
      status: 500,
      contentType: 'application/json; charset=utf-8',
      cacheControl: '',
      body: Buffer.from(JSON.stringify({ error: job.error || `任务${terminalLabel(job.status)}` })),
    };
  }
  return { kind: 'result', ...job.result };
}

function terminalLabel(status) {
  if (status === 'succeeded') return '完成';
  if (status === 'failed') return '失败';
  if (status === 'canceled') return '取消';
  return status;
}

function publicJob(job, viewerUserId) {
  const userQueue = pendingByUser.get(viewerUserId) || [];
  const yourPosition = job.status === 'pending' && job.userId === viewerUserId
    ? userQueue.indexOf(job) + 1
    : 0;
  const averageMs = averageImageDurationMs();
  return {
    id: job.id,
    status: job.status,
    error: job.error || '',
    providerId: job.providerId || '',
    providerName: job.providerName || '',
    retryOf: job.retryOf || '',
    canRetry: job.status === 'failed' && Boolean(job.originalBody?.length),
    clientContext: job.clientContext || null,
    yourPosition,
    yourQueued: userQueue.length,
    globalActive: activeJob ? 1 : 0,
    globalQueued: countGlobalQueued(),
    averageMs,
    estimatedWaitMs: yourPosition ? yourPosition * averageMs : 0,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt || 0,
    finishedAt: job.finishedAt || 0,
    elapsedMs: job.startedAt ? ((job.finishedAt || Date.now()) - job.startedAt) : 0,
  };
}

function countGlobalQueued() {
  let total = 0;
  for (const queue of pendingByUser.values()) total += queue.length;
  return total;
}

function averageImageDurationMs() {
  if (!recentImageDurations.length) return DEFAULT_IMAGE_DURATION_MS;
  return Math.round(recentImageDurations.reduce((sum, value) => sum + value, 0) / recentImageDurations.length);
}

function cleanupJobLater(jobId) {
  setTimeout(() => imageJobs.delete(jobId), JOB_TTL_MS).unref?.();
}

function pickNextJob() {
  const users = [...pendingByUser.keys()].filter((uid) => pendingByUser.get(uid).length).sort();
  if (!users.length) return null;
  const startIdx = lastServedUserId
    ? (users.indexOf(lastServedUserId) + 1 + users.length) % users.length
    : 0;
  for (let i = 0; i < users.length; i += 1) {
    const userId = users[(startIdx + i) % users.length];
    const queue = pendingByUser.get(userId);
    if (!queue || !queue.length) continue;
    lastServedUserId = userId;
    return queue.shift();
  }
  return null;
}

function runWorker() {
  if (activeJob) return;
  const job = pickNextJob();
  if (!job) return;
  activeJob = job;
  job.status = 'running';
  job.startedAt = Date.now();
  processImageJob(job).finally(() => {
    activeJob = null;
    runWorker();
  });
}

async function processImageJob(job) {
  try {
    const initialConfig = await readLocalConfig(job.providerId);
    const providers = providersForJob(job, initialConfig);
    let jobResult = null;
    let lastConfig = initialConfig;
    if (!providers.length) {
      jobResult = failedImageJobResult(503, `没有健康的生图服务商: ${requestKindLabel(job.upstreamPath, job.contentType)}`);
    }
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      applyJobProvider(job, provider);
      markAttemptedProvider(job, provider.id);
      const config = await readLocalConfig(provider.id);
      lastConfig = config;
      logLine('INFO', `[image-job] start ${job.id} user=${job.userId} provider=${config.name} mode=${config.generationMode} path=${job.upstreamPath}${index ? ' fallback' : ''}`);
      try {
        jobResult = await executeImageJobWithProvider(job, config);
      } catch (error) {
        const message = `上游请求异常: ${formatThrownError(error)}`;
        jobResult = failedImageJobResult(502, message);
      }
      if (jobResult.ok) {
        recordProviderSuccess(config.id);
        break;
      }
      const retryable = isRetryableJobResult(jobResult);
      if (retryable) recordProviderFailure(config.id, jobResult.error);
      if (!retryable || index === providers.length - 1) break;
      logLine('WARN', `[image-job] retryable ${job.id} provider=${config.name} status=${jobResult.status} error=${jobResult.error}`);
    }
    job.finishedAt = Date.now();
    job.result = jobResult;
    job.status = jobResult.ok ? 'succeeded' : 'failed';
    if (!jobResult.ok) {
      job.error = jobResult.error;
      logLine('WARN', `[image-job] failed ${job.id} user=${job.userId} provider=${lastConfig.name} status=${jobResult.status} error=${job.error}`);
    } else {
      logLine('INFO', `[image-job] done ${job.id} user=${job.userId} provider=${lastConfig.name} duration=${job.finishedAt - job.startedAt}ms`);
      recentImageDurations.push(job.finishedAt - job.startedAt);
      while (recentImageDurations.length > 30) recentImageDurations.shift();
    }
  } catch (error) {
    logLine('ERROR', `[image-job] crashed ${job.id} user=${job.userId} provider=${job.providerName || job.providerId} error=${error.message || error}`);
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

// ----- Provider routing -----

export function chooseImageProvider(config, upstreamPath, contentType, excludeId, body) {
  const provider = rankedImageProviders(config, upstreamPath, contentType, excludeId, body)[0];
  if (!provider) throw new Error(`没有兼容的生图服务商: ${requestKindLabel(upstreamPath, contentType)}`);
  return provider;
}

export function providerSupportsRequest(provider, upstreamPath, contentType, body) {
  return compatibleProviders({ providers: [provider] }, upstreamPath, contentType, body).length > 0;
}

export function rewriteImageJobBody(provider, body, contentType) {
  if (String(contentType || '').includes('application/json')) {
    try {
      const payload = JSON.parse(Buffer.from(body).toString('utf8') || '{}');
      payload.model = provider.imageModel;
      return Buffer.from(JSON.stringify(payload));
    } catch {
      return body;
    }
  }
  if (isMultipartEdit(contentType)) return rewriteMultipartFormField(body, contentType, 'model', provider.imageModel);
  return body;
}

function requestKindLabel(upstreamPath, contentType) {
  if (upstreamPath === '/v1/images/generations') return 'Images 文生图';
  if (upstreamPath === '/v1/images/edits' && isMultipartEdit(contentType)) return 'Images 图生图';
  if (upstreamPath.startsWith('/v1/responses')) return 'Responses 生图';
  return upstreamPath;
}

function isJsonContent(contentType) {
  return String(contentType || '').includes('application/json');
}

function isMultipartEdit(contentType) {
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
  return parseJsonBody(job.originalBody || job.body);
}

function isSemanticImageGeneration(job) {
  return job.upstreamPath === '/v1/images/generations' && isJsonContent(job.contentType);
}

function isSemanticImageEdit(job) {
  return isSemanticImageGeneration(job) && payloadHasReferenceImages(jobJsonPayload(job));
}

function modeForUpstreamPath(upstreamPath) {
  if (upstreamPath.startsWith('/v1/responses')) return 'responses';
  if (upstreamPath.startsWith('/v1/images/')) return 'images';
  return '';
}

function providerLoad(providerId) {
  let count = 0;
  if (activeJob && activeJob.providerId === providerId) count += 1;
  for (const queue of pendingByUser.values()) {
    for (const job of queue) if (job.providerId === providerId) count += 1;
  }
  return count;
}

function compatibleProviders(config, upstreamPath, contentType, body) {
  const providers = Array.isArray(config.providers) ? config.providers : [];
  if (upstreamPath === '/v1/images/generations' && isJsonContent(contentType)) {
    return providers.filter((provider) => provider.generationMode === 'images' || provider.generationMode === 'responses');
  }
  if (upstreamPath === '/v1/images/edits' && isMultipartEdit(contentType)) {
    return providers.filter((provider) => provider.generationMode === 'images');
  }
  if (upstreamPath.startsWith('/v1/responses')) {
    return providers.filter((provider) => provider.generationMode === 'responses');
  }
  const mode = modeForUpstreamPath(upstreamPath);
  return providers.filter((provider) => !mode || provider.generationMode === mode);
}


function parseExcludedProviderIds(excludeId) {
  return new Set(String(excludeId || '').split(',').map((id) => id.trim()).filter(Boolean));
}

function markAttemptedProvider(job, providerId) {
  if (!providerId) return;
  const ids = Array.isArray(job.attemptedProviderIds) ? job.attemptedProviderIds : [];
  if (!ids.includes(providerId)) ids.push(providerId);
  job.attemptedProviderIds = ids;
}

function retryExcludeProviderIds(job) {
  const ids = Array.isArray(job.attemptedProviderIds) ? [...job.attemptedProviderIds] : [];
  if (job.providerId && !ids.includes(job.providerId)) ids.push(job.providerId);
  if (job.excludeProviderId) {
    for (const id of parseExcludedProviderIds(job.excludeProviderId)) if (!ids.includes(id)) ids.push(id);
  }
  return ids.join(',');
}

function rankedImageProviders(config, upstreamPath, contentType, excludeId, body) {
  let candidates = compatibleProviders(config, upstreamPath, contentType, body);
  const excludedIds = parseExcludedProviderIds(excludeId);
  if (excludedIds.size) candidates = candidates.filter((p) => !excludedIds.has(p.id));
  if (!candidates.length) candidates = compatibleProviders(config, upstreamPath, contentType, body);
  if (!candidates.length) return [];
  const pool = candidates.filter((provider) => !isProviderCircuitOpen(provider.id));
  if (!pool.length) return [];
  return pool
    .map((provider, index) => ({ provider, load: providerLoad(provider.id), order: index }))
    .sort((left, right) => left.load - right.load || left.order - right.order)
    .map((item) => item.provider);
}

function isProviderCircuitOpen(providerId) {
  const state = providerCircuitState.get(providerId);
  if (!state?.openUntil) return false;
  if (state.openUntil > Date.now()) return true;
  providerCircuitState.set(providerId, { ...state, openUntil: 0, failures: 0 });
  return false;
}

function recordProviderSuccess(providerId) {
  if (!providerId) return;
  providerCircuitState.set(providerId, { failures: 0, openUntil: 0, lastError: '' });
}

function recordProviderFailure(providerId, error) {
  if (!providerId) return;
  const previous = providerCircuitState.get(providerId) || { failures: 0, openUntil: 0, lastError: '' };
  const failures = previous.failures + 1;
  const openUntil = failures >= PROVIDER_FAILURE_THRESHOLD ? Date.now() + PROVIDER_CIRCUIT_OPEN_MS : previous.openUntil || 0;
  providerCircuitState.set(providerId, { failures, openUntil, lastError: String(error || '') });
  if (openUntil) logLine('WARN', `[image-provider] circuit-open provider=${providerId} failures=${failures} cooldownMs=${PROVIDER_CIRCUIT_OPEN_MS}`);
}

function providersForJob(job, config) {
  if (!job.autoProviderRouting) return [config];
  const providers = rankedImageProviders(config, job.upstreamPath, job.contentType, job.excludeProviderId, job.originalBody || job.body);
  const selectedIndex = providers.findIndex((provider) => provider.id === job.providerId);
  if (selectedIndex <= 0) return providers;
  const [selectedProvider] = providers.splice(selectedIndex, 1);
  return [selectedProvider, ...providers];
}

function applyJobProvider(job, provider) {
  job.providerId = provider.id;
  job.providerName = provider.name;
  job.body = rewriteImageJobBody(provider, job.originalBody || job.body, job.contentType);
}

function multipartBoundary(contentType) {
  const match = String(contentType || '').match(/boundary=(?:("[^"]+")|([^;]+))/i);
  return (match?.[1] || match?.[2] || '').replace(/^"|"$/g, '').trim();
}

function rewriteMultipartFormField(body, contentType, fieldName, value) {
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

async function executeImageJobWithProvider(job, config) {
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
    body: job.body,
    signal: timeoutSignal(timeoutMs),
  });
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

async function callResponsesAndExtractImage(payloadBuffer, config) {
  const upstream = await fetch(`${config.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: upstreamHeaders(config, 'application/json'),
    body: payloadBuffer,
    signal: timeoutSignal(RESPONSES_IMAGE_UPSTREAM_TIMEOUT_MS),
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

async function processImagesEditBackedGenerationJob(job, config) {
  const imagesPayload = jobJsonPayload(job);
  const { body, contentType } = buildImagesEditMultipartFromPayload(config, imagesPayload);
  const upstream = await fetch(`${config.baseUrl}/v1/images/edits`, {
    method: 'POST',
    headers: upstreamHeaders(config, contentType),
    body,
    signal: timeoutSignal(IMAGE_UPSTREAM_TIMEOUT_MS),
  });
  const upstreamBody = Buffer.from(await upstream.arrayBuffer());
  return {
    status: upstream.status,
    statusText: upstream.statusText,
    contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    cacheControl: upstream.headers.get('cache-control') || '',
    body: upstreamBody,
    ok: upstream.ok,
    error: upstream.ok ? '' : await formatUpstreamErrorFromBody(upstream, upstreamBody),
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
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
  parts.push(file.buffer);
  parts.push(Buffer.from('\r\n'));
}


function buildImagesEditMultipartFromPayload(provider, imagesPayload) {
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
  for (const ref of referenceImagesFromPayload(imagesPayload)) {
    const file = dataUrlToImagePart(ref);
    if (file) appendMultipartFile(parts, boundary, 'image', file);
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

function buildResponsesPayloadFromImagesPayload(provider, imagesPayload) {
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
  if (imagesPayload?.output_compression) tool.output_compression = imagesPayload.output_compression;
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

function isRetryableJobResult(jobResult) {
  if (!jobResult) return false;
  if (isRetryableUpstreamStatus(jobResult.status)) return true;
  if (jobResult.status === 400 && looksLikeRateLimit(jobResult.error)) return true;
  if (jobResult.status === 400 && looksLikeAssistantTextInsteadOfImage(jobResult.error)) return true;
  return false;
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

async function formatUpstreamErrorFromBody(upstream, body) {
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
  return `上游 API 返回 HTTP ${upstream.status}: ${(cleaned || upstream.statusText || '无错误正文').slice(0, 360)}`;
}
