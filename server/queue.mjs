import { initProviderAdapter, isJsonContent, isMultipartEdit, modeForUpstreamPath, rewriteMultipartFormField, executeImageJobWithProvider, isRetryableJobResult, formatThrownError, failedImageJobResult } from './provider-adapter.mjs';
import { generationRecipe, requestError, toImagesPayload } from '../shared/generation-contract.mjs';
import { submissionHash } from './state-store.mjs';
import { normalizeImageResult } from './image-result.mjs';
import { imageHash, validateSubmissionImages } from './generation-input.mjs';
import { creditError } from '../shared/credits-contract.mjs';
import { randomUUID } from 'node:crypto';
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
const DEFAULT_IMAGE_DURATION_MS = 90_000;
const PROVIDER_FAILURE_THRESHOLD = 3;
const PROVIDER_CIRCUIT_OPEN_MS = 30 * 60 * 1000;
const providerCircuitState = new Map();
let stateStore = null;
let workerPromise = null;
let stopping = false;
const MAX_QUEUED_JOBS = 128;
const MAX_USER_QUEUED_JOBS = 32;
const MAX_RETAINED_BYTES = 128 * 1024 * 1024;
const META_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cleanupTimers = new Map();
const persistenceRetries = new Map();

function persist(job) {
  stateStore?.saveJob(job);
  job.settlementPending = false;
  const pending = persistenceRetries.get(job.id);
  if (pending) {
    clearTimeout(pending.timer); persistenceRetries.delete(job.id); pending.resolve();
  }
}

function persistEventually(job) {
  job.settlementPending = true;
  let pending = persistenceRetries.get(job.id);
  if (!pending) {
    pending = {};
    pending.promise = new Promise((resolve) => { pending.resolve = resolve; });
    persistenceRetries.set(job.id, pending);
  }
  clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    try { persist(job); runWorker(); }
    catch (error) { logLine('ERROR', `任务结算等待存储恢复: ${job.id}`); persistEventually(job); }
  }, 5000);
  if (!stopping) pending.timer.unref?.();
}

function requestBytes(job) {
  if (job.submission) return Buffer.byteLength(JSON.stringify(job.submission));
  return (job.originalBody?.length || 0) + (job.body !== job.originalBody ? job.body?.length || 0 : 0);
}

function retainedBytes() {
  let bytes = 0;
  for (const job of imageJobs.values()) bytes += requestBytes(job) + (job.result?.body?.length || 0);
  return bytes;
}

function assertCapacity(userId, bytes = 0) {
  if (countGlobalQueued() >= MAX_QUEUED_JOBS || (pendingByUser.get(userId)?.length || 0) >= MAX_USER_QUEUED_JOBS) throw requestError('队列已满, 请等待部分任务完成后继续提交', 429);
  if (retainedBytes() + bytes > MAX_RETAINED_BYTES) throw requestError('待处理图片较多, 请等待作品保存后再提交', 429);
}

export function initializePersistence(store) {
  stateStore = store;
  for (const saved of store.loadJobs()) {
    const job = { ...saved, result: null };
    if (job.status === 'pending' || job.status === 'running') {
      job.outcomeUnknown = job.status === 'running';
      job.interruptionReason = job.status === 'running' ? 'running-restart' : 'pending-restart';
      job.status = 'interrupted';
      job.finishedAt = Date.now();
      job.error = job.outcomeUnknown ? '服务重启前已开始请求, 上游结果未知. 重新生成可能重复计费.' : '服务重启前尚未执行, 可从此浏览器恢复排队.';
      persist(job);
    } else if (job.status === 'succeeded' && !job.acknowledgedAt) {
      job.status = 'expired';
      job.error = '服务重启后临时结果已释放. 服务器不保存图片, 请检查本地展馆或重新生成.';
      persist(job);
    }
    imageJobs.set(job.id, job);
    cleanupJobLater(job.id);
  }
}

export function findSubmission(userId, requestId) {
  return [...imageJobs.values()].find((job) => job.userId === userId && job.requestId === requestId);
}

function retrySuccessor(job) {
  return [...imageJobs.values()].find((candidate) => candidate.userId === job.userId && candidate.retryOf === job.id);
}

/** Identical request IDs are accepted once, including across process restarts. */
function prepareGeneration(input, userId, selectedProvider, prepared = new Map()) {
  const hash = submissionHash(input);
  const existing = findSubmission(userId, input.requestId);
  if (existing) {
    if (existing.requestHash !== hash) throw requestError('请求 ID 已用于不同内容, 请创建新的生成任务', 409);
    return existing;
  }
  if (stateStore?.credits.byRequest(userId, input.requestId)) throw creditError('此请求已受理且任务历史已过期, 请查看本地作品或明确重新生成', 'REQUEST_ALREADY_ACCEPTED');
  validateSubmissionImages(input);
  const referenceSource = input.referenceJobId && (imageJobs.get(input.referenceJobId) || findSubmission(userId, input.referenceJobId) || prepared.get(input.referenceJobId));
  if (input.referenceJobId) {
    const source = referenceSource;
    if (!source || source.userId !== userId) throw requestError('参考任务不存在', 404);
    validateReferenceSnapshot(source, input.referenceImage);
    if (['succeeded', 'expired'].includes(source.status) && !source.result && !input.referenceImage) throw requestError('参考任务的临时图片已释放, 请从本地作品选择参考图', 409);
  }
  if (input.retryOf) {
    const source = imageJobs.get(input.retryOf);
    if (!source || source.userId !== userId) throw requestError('原任务不存在', 404);
    if (retrySuccessor(source) || [...prepared.values()].some((candidate) => candidate.retryOf === source.id)) throw requestError('此任务已重新提交, 请查看最新任务', 409);
    if (['running', 'pending', 'succeeded'].includes(source.status)) throw requestError('此任务无需重试', 409);
  }
  assertCapacity(userId, Buffer.byteLength(JSON.stringify(input)));
  const job = {
    id: nextJobId(), userId, requestId: input.requestId, requestHash: hash, submission: input,
    status: 'pending', method: 'POST', upstreamPath: '/v1/images/generations', contentType: 'application/json',
    autoProviderRouting: !input.providerId, excludeProviderId: input.retryOf ? retryExcludeProviderIds(imageJobs.get(input.retryOf)) : '', clientContext: input.clientContext,
    queuedAt: Date.now(), startedAt: 0, finishedAt: 0, error: '', result: null,
    providerId: selectedProvider.id, providerName: selectedProvider.name,
    recipe: generationRecipe(input, selectedProvider), referenceJobId: referenceSource ? referenceSource.id : '', retryOf: input.retryOf || '',
  };
  return job;
}

export function submitGeneration(input, userId, selectedProvider, session) {
  return submitGenerations([input], userId, [selectedProvider], session)[0];
}

export function submitGenerations(inputs, userId, providers, session) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_USER_QUEUED_JOBS || new Set(inputs.map((input) => input.requestId)).size !== inputs.length || new Set(inputs.map((input) => input.clientContext.placeholderId)).size !== inputs.length) throw requestError('批次必须包含 1 到 32 个不同的任务');
  const prepared = new Map();
  const jobs = inputs.map((input, index) => {
    if (session) stateStore.credits.checkQuote(session, input.creditQuote, !findSubmission(userId, input.requestId));
    const job = prepareGeneration(input, userId, providers[index], prepared);
    prepared.set(job.id, job); prepared.set(job.requestId, job);
    return job;
  });
  const fresh = jobs.filter((job) => !imageJobs.has(job.id));
  if (countGlobalQueued() + fresh.length > MAX_QUEUED_JOBS || (pendingByUser.get(userId)?.length || 0) + fresh.length > MAX_USER_QUEUED_JOBS) throw requestError('队列容量不足以接收整个批次, 请等待部分任务完成', 429);
  if (retainedBytes() + fresh.reduce((total, job) => total + requestBytes(job), 0) > MAX_RETAINED_BYTES) throw requestError('批次参考图片过多, 请等待作品保存后再提交', 429);
  if (session && fresh.length) stateStore.acceptImageJobs(fresh, session);
  else if (fresh.length) stateStore?.transaction(() => { for (const job of fresh) persist(job); });
  for (const job of fresh) enqueue(job, { persisted: Boolean(stateStore), start: false });
  runWorker();
  return jobs.map((job) => publicJob(job, userId));
}

function validateReferenceSnapshot(source, snapshot) {
  if (!snapshot) return;
  if (!source?.outputImageHash || snapshot.id !== source.clientContext?.placeholderId || imageHash(snapshot.dataUrl) !== source.outputImageHash) throw requestError('首镜参考图片与原任务结果不一致', 409);
}

export function resumeGeneration(jobId, userId, input, session) {
  const job = imageJobs.get(jobId);
  if (!job || job.userId !== userId) throw requestError('任务不存在', 404);
  if (session) stateStore.credits.checkQuote(session, input.creditQuote, false);
  if (submissionHash(input) !== job.requestHash) throw requestError('恢复内容与原始任务不一致', 409);
  if (['pending', 'running', 'succeeded'].includes(job.status)) return publicJob(job, userId);
  if (job.status !== 'interrupted' || job.outcomeUnknown) throw requestError('只有确认未执行的任务可以恢复排队', 409);
  validateSubmissionImages(input);
  if (job.referenceJobId) {
    const source = imageJobs.get(job.referenceJobId);
    if (!source || source.userId !== userId) throw requestError('参考任务已过期, 请从本地作品重新创建分镜', 409);
    validateReferenceSnapshot(source, input.referenceImage);
    if (source.status === 'interrupted') throw requestError('请先恢复首镜任务, 再恢复后续分镜', 409);
    if (!['pending', 'running'].includes(source.status) && !source.result && !input.referenceImage) throw requestError('请先在此浏览器保存首镜原图, 再恢复后续分镜', 409);
  }
  assertCapacity(userId, Buffer.byteLength(JSON.stringify(input)));
  const next = { ...job, submission: input, status: 'pending', method: 'POST', upstreamPath: '/v1/images/generations', contentType: 'application/json', autoProviderRouting: !input.providerId, queuedAt: Date.now(), startedAt: 0, finishedAt: 0, error: '', interruptionReason: '', ...(session ? { codeEpoch: session.codeEpoch } : {}) };
  if (session) stateStore.transaction(() => {
    if (next.creditId) { stateStore.credits.resume(next, session, input.creditQuote); persist(next); }
    else stateStore.acceptImageJobs([next], session);
  });
  else persist(next);
  Object.assign(job, next);
  return enqueue(job, { persisted: Boolean(stateStore) });
}

export function updatePendingGeneration(jobId, userId, input, provider, session) {
  const job = imageJobs.get(jobId);
  if (!job || job.userId !== userId) throw requestError('任务不存在', 404);
  if (job.status !== 'pending') throw requestError('任务已经开始, 请在完成后重新绘制', 409);
  if (session) stateStore.credits.checkQuote(session, input.creditQuote, false);
  validateSubmissionImages(input);
  if (input.requestId !== job.requestId || input.clientContext.placeholderId !== job.clientContext.placeholderId || input.referenceJobId !== job.submission?.referenceJobId || input.providerId !== job.submission?.providerId || input.retryOf !== job.submission?.retryOf) throw requestError('编辑不能更换任务身份, 通道或参考链', 409);
  if (input.referenceImage && job.referenceJobId) validateReferenceSnapshot(imageJobs.get(job.referenceJobId), input.referenceImage);
  const cfg = provider || { id: job.providerId, name: job.providerName, imageModel: job.recipe.model, generationMode: job.recipe.generationMode };
  if (!providerSupportsRequest(cfg, job.upstreamPath, job.contentType, Buffer.from(JSON.stringify(toImagesPayload(input))))) throw requestError('当前通道不支持这些生成参数');
  const extra = Buffer.byteLength(JSON.stringify(input)) - requestBytes(job);
  if (extra > 0 && retainedBytes() + extra > MAX_RETAINED_BYTES) throw requestError('参考图片过大, 请稍后再试', 429);
  const next = { ...job, submission: input, clientContext: input.clientContext, requestHash: submissionHash(input), recipe: generationRecipe(input, { id: job.providerId, name: job.providerName, imageModel: job.recipe.model, generationMode: job.recipe.generationMode }) };
  persist(next);
  Object.assign(job, next);
  return publicJob(job, userId);
}

export function prioritize(jobId, userId) {
  const job = imageJobs.get(jobId);
  if (!job || job.userId !== userId) throw requestError('任务不存在', 404);
  if (job.status !== 'pending') throw requestError('只有排队中的任务可以置顶', 409);
  const list = pendingByUser.get(userId);
  list.splice(list.indexOf(job), 1);
  list.unshift(job);
  return publicJob(job, userId);
}

function hasActiveDependent(jobId) {
  return [...imageJobs.values()].some((item) => item.referenceJobId === jobId && ['pending', 'running'].includes(item.status));
}

function releaseClaimedResults() {
  for (const job of imageJobs.values()) if (job.acknowledgedAt && !hasActiveDependent(job.id)) job.result = null;
}

export function acknowledge(jobId, userId) {
  const job = imageJobs.get(jobId);
  if (!job || job.userId !== userId) throw requestError('任务不存在', 404);
  if (!['succeeded', 'expired'].includes(job.status)) throw requestError('任务尚未成功', 409);
  const previous = job.acknowledgedAt;
  job.acknowledgedAt = previous || Date.now();
  if (job.status === 'expired') { job.status = 'succeeded'; job.error = ''; }
  persist(job);
  releaseClaimedResults();
  runWorker();
  return publicJob(job, userId);
}

export function archiveCompleted(userId) {
  for (const job of imageJobs.values()) {
    if (job.userId === userId && (job.status === 'canceled' || job.status === 'succeeded' && job.acknowledgedAt)) {
      job.archivedAt = Date.now();
      persist(job);
    }
  }
}

export function archiveJob(jobId, userId) {
  const job = imageJobs.get(jobId);
  if (!job || job.userId !== userId) throw requestError('任务不存在', 404);
  if (job.archivedAt) return publicJob(job, userId);
  if (['pending', 'running', 'submitting', 'unsubmitted'].includes(job.status) || job.status === 'succeeded' && !job.acknowledgedAt || job.interruptionReason === 'pending-restart') {
    throw requestError('进行中的任务不能从队列清除', 409);
  }
  job.archivedAt = Date.now();
  persist(job);
  return publicJob(job, userId);
}

export function providerHealth(providers) {
  return providers.map((provider) => {
    const open = isProviderCircuitOpen(provider.id);
    const state = providerCircuitState.get(provider.id);
    return { id: provider.id, name: provider.name, model: provider.imageModel, status: open ? 'cooldown' : state?.lastError ? 'degraded' : state?.lastSuccessAt ? 'available' : 'untested', failures: state?.failures || 0, openUntil: state?.openUntil || 0, lastSuccessAt: state?.lastSuccessAt || 0, lastFailureAt: state?.lastFailureAt || 0 };
  });
}

export async function stopWorker() {
  stopping = true;
  if (workerPromise) await workerPromise;
  for (const pending of persistenceRetries.values()) pending.timer.ref?.();
  await Promise.all([...persistenceRetries.values()].map((pending) => pending.promise));
  for (const timer of cleanupTimers.values()) clearTimeout(timer);
  cleanupTimers.clear();
}

export function init(deps) {
  initProviderAdapter(deps);
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
  return `img_${randomUUID()}`;
}

export function enqueue(job, { persisted = false, start = true } = {}) {
  if (!persisted) persist(job);
  clearTimeout(cleanupTimers.get(job.id));
  cleanupTimers.delete(job.id);
  imageJobs.set(job.id, job);
  if (!pendingByUser.has(job.userId)) pendingByUser.set(job.userId, []);
  pendingByUser.get(job.userId).push(job);
  logLine('INFO', `[image-job] queued ${job.id} user=${job.userId} provider=${job.providerName || job.providerId || 'auto'} path=${job.upstreamPath}`);
  if (start) runWorker();
  return publicJob(job, job.userId);
}

export function retryFailedJob(jobId, viewerUserId) {
  const source = imageJobs.get(jobId);
  if (!source || source.userId !== viewerUserId) return { ok: false, status: 404, error: '任务不存在或已过期' };
  if (retrySuccessor(source)) return { ok: false, status: 409, error: '此任务已重新提交, 请查看最新任务' };
  if (source.status !== 'failed' || !source.originalBody?.length) return { ok: false, status: 400, error: '请从浏览器中的原始配方重新提交' };
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
    const next = { ...job, status: 'canceled', finishedAt: Date.now(), error: '已取消, 占用灵感点已释放', submission: null, body: null, originalBody: null };
    persist(next);
    const queue = pendingByUser.get(job.userId);
    if (queue) {
      const idx = queue.indexOf(job);
      if (idx >= 0) queue.splice(idx, 1);
    }
    Object.assign(job, next);
    cleanupJobLater(job.id);
    releaseClaimedResults();
    logLine('INFO', `[image-job] canceled ${job.id} user=${viewerUserId}`);
    return { ok: true, job: publicJob(job, viewerUserId) };
  }
  if (job.status === 'running') {
    return { ok: false, status: 409, error: '任务正在生成, 暂不支持取消' };
  }
  return { ok: false, status: 400, error: `任务已${terminalLabel(job.status)}` };
}

export function revokeAccessCode(accessCodeId) {
  for (const job of imageJobs.values()) {
    if (job.accessCodeId !== accessCodeId) continue;
    // Replaying an earlier administrative request must not cancel work from a newer login.
    try { stateStore.credits.authorized({ accessCodeId, codeEpoch: job.codeEpoch }); continue; }
    catch { /* Only jobs whose authorization was revoked need cancellation. */ }
    if (job.status === 'pending') cancel(job.id, job.userId);
    else if (job.status === 'interrupted' && !job.outcomeUnknown) {
      const next = { ...job, status: 'canceled', error: '访问码已停用或重置, 未执行任务已取消', finishedAt: Date.now() };
      persist(next); Object.assign(job, next);
    }
  }
}

export function getJobsForUser(userId, { cursor = '', limit = 30, requestIds = [] } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw requestError('历史记录页大小无效');
  let before;
  if (cursor) {
    try { before = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch { throw requestError('历史记录游标无效'); }
    if (!Array.isArray(before) || before.length !== 2 || !Number.isFinite(before[0]) || typeof before[1] !== 'string') throw requestError('历史记录游标无效');
  }
  const own = [...imageJobs.values()].filter((job) => job.userId === userId);
  const visible = own.filter((job) => !job.archivedAt).sort((a, b) => b.queuedAt - a.queuedAt || b.id.localeCompare(a.id));
  const essential = (job) => ['pending', 'running'].includes(job.status) || job.status === 'succeeded' && !job.acknowledgedAt;
  const history = visible.filter((job) => !essential(job));
  const page = history.filter((job) => !before || job.queuedAt < before[0] || job.queuedAt === before[0] && job.id.localeCompare(before[1]) < 0).slice(0, limit + 1);
  const hasMore = page.length > limit;
  page.length = Math.min(page.length, limit);
  const last = page.at(-1);
  const selected = new Map([...visible.filter(essential), ...page, ...own.filter((job) => requestIds.includes(job.requestId))].map((job) => [job.id, job]));
  const serverNow = Date.now();
  return {
    jobs: [...selected.values()].map((job) => publicJob(job, userId, serverNow)),
    serverNow,
    historyCursor: hasMore ? Buffer.from(JSON.stringify([last.queuedAt, last.id])).toString('base64url') : '',
    historyTotal: history.length,
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
      status: ['succeeded', 'expired', 'canceled'].includes(job.status) ? 410 : 409,
      contentType: 'application/json; charset=utf-8',
      cacheControl: '',
      body: Buffer.from(JSON.stringify({ error: job.error || (job.acknowledgedAt ? '图片已保存到本地, 临时结果已释放' : `任务${terminalLabel(job.status)}`) })),
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

function publicJob(job, viewerUserId, serverNow = Date.now()) {
  const userQueue = pendingByUser.get(viewerUserId) || [];
  const supersededBy = retrySuccessor(job)?.id || '';
  const yourPosition = job.status === 'pending' && job.userId === viewerUserId
    ? userQueue.indexOf(job) + 1
    : 0;
  const averageMs = averageImageDurationMs();
  return {
    id: job.id,
    requestId: job.requestId || '',
    credit: job.creditId ? stateStore?.credits.publicCharge(job.creditId) : null,
    settlementPending: Boolean(job.settlementPending),
    status: job.status,
    error: job.error || '',
    providerId: job.providerId || '',
    providerName: job.providerName || '',
    retryOf: job.retryOf || '',
    supersededBy,
    canRetry: !supersededBy && ['failed', 'expired', 'interrupted'].includes(job.status) && Boolean(job.submission || job.originalBody?.length),
    acknowledgedAt: job.acknowledgedAt || 0,
    archivedAt: job.archivedAt || 0,
    outcomeUnknown: Boolean(job.outcomeUnknown),
    interruptionReason: job.interruptionReason || '',
    recipe: job.recipe || null,
    referenceJobId: job.referenceJobId || '',
    clientContext: job.clientContext || null,
    yourPosition,
    serverNow,
    yourQueued: userQueue.length,
    globalActive: activeJob ? 1 : 0,
    globalQueued: countGlobalQueued(),
    averageMs,
    estimatedWaitMs: yourPosition ? yourPosition * averageMs : 0,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt || 0,
    finishedAt: job.finishedAt || 0,
    elapsedMs: job.startedAt ? ((job.finishedAt || serverNow) - job.startedAt) : 0,
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
  clearTimeout(cleanupTimers.get(jobId));
  const job = imageJobs.get(jobId);
  if (!job || ['running', 'pending'].includes(job.status)) return;
  const timer = setTimeout(() => {
    job.body = null;
    job.originalBody = null;
    job.submission = null;
    if (!hasActiveDependent(jobId)) {
      job.result = null;
      if (job.status === 'succeeded' && !job.acknowledgedAt) {
        job.status = 'expired';
        job.error = '临时结果已过期, 请检查本地展馆. 服务器不保存图片.';
        try { persist(job); }
        catch { persistEventually(job); logLine('ERROR', `临时图片过期状态等待存储恢复: ${job.id}`); }
      }
    } else { cleanupJobLater(jobId); return; }
    runWorker();
    removeJobLater(jobId, Math.max(1000, META_TTL_MS - (Date.now() - (job.finishedAt || job.queuedAt))));
  }, Math.max(1000, JOB_TTL_MS - (Date.now() - (job.finishedAt || job.queuedAt))));
  timer.unref?.();
  cleanupTimers.set(jobId, timer);
}

function removeJobLater(jobId, delay) {
  const timer = setTimeout(() => {
    if (persistenceRetries.has(jobId)) { removeJobLater(jobId, 5000); return; }
    try {
      stateStore?.deleteJob(jobId);
      imageJobs.delete(jobId); cleanupTimers.delete(jobId);
    } catch {
      logLine('ERROR', `任务历史清理等待存储恢复: ${jobId}`);
      removeJobLater(jobId, 5000);
    }
  }, delay);
  timer.unref?.(); cleanupTimers.set(jobId, timer);
}

function pickNextJob() {
  const users = [...pendingByUser.keys()].filter((uid) => pendingByUser.get(uid).length).sort();
  if (!users.length) return null;
  // Keep the cursor's place even when that user's queue has just emptied.
  const nextUser = lastServedUserId ? users.findIndex((uid) => uid > lastServedUserId) : 0;
  const startIdx = nextUser < 0 ? 0 : nextUser;
  for (let i = 0; i < users.length; i += 1) {
    const userId = users[(startIdx + i) % users.length];
    const queue = pendingByUser.get(userId);
    if (!queue || !queue.length) continue;
    const index = queue.findIndex((candidate) => !candidate.referenceJobId || !['pending', 'running'].includes(imageJobs.get(candidate.referenceJobId)?.status));
    if (index < 0) continue;
    lastServedUserId = userId;
    return queue.splice(index, 1)[0];
  }
  return null;
}

function runWorker() {
  if (activeJob || stopping || retainedBytes() > MAX_RETAINED_BYTES) return;
  const job = pickNextJob();
  if (!job) return;
  activeJob = job;
  job.status = 'running';
  job.startedAt = Date.now();
  try { persist(job); } catch (error) {
    job.status = 'interrupted'; job.interruptionReason = 'pending-restart'; job.outcomeUnknown = false; job.error = '任务状态无法保存, 尚未调用上游'; job.finishedAt = Date.now();
    activeJob = null; persistEventually(job); cleanupJobLater(job.id); logLine('ERROR', `任务存储失败: ${error.message}`); return;
  }
  workerPromise = processImageJob(job).finally(() => {
    activeJob = null;
    workerPromise = null;
    releaseClaimedResults();
    runWorker();
  });
}

async function processImageJob(job) {
  let outcomeUnknown = false;
  try {
    if (job.referenceJobId) {
      const source = imageJobs.get(job.referenceJobId);
      if (!source || !['succeeded', 'expired'].includes(source.status)) throw new Error('参考分镜尚未生成成功, 请先完成参考分镜再重新提交本镜');
      const first = source.result?.body ? JSON.parse(source.result.body.toString('utf8')).data?.[0] : null;
      let reference = job.submission.referenceImage;
      if (first?.b64_json) reference = { id: source.clientContext.placeholderId, recordId: source.clientContext.placeholderId, name: '系列主体参考', dataUrl: `data:${first.mime_type};base64,${first.b64_json}` };
      if (!reference) throw new Error('参考分镜临时图片已释放, 请在保存原图的浏览器继续提交');
      validateReferenceSnapshot(source, reference);
      // Keep the four user references in order and append the continuity image separately.
      job.submission = { ...job.submission, referenceImage: reference };
      const { dataUrl: _image, ...metadata } = reference;
      job.recipe = { ...job.recipe, referenceImage: metadata };
    }
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
      if (job.creditId) stateStore.credits.authorized({ accessCodeId: job.accessCodeId, codeEpoch: job.codeEpoch });
      logLine('INFO', `[image-job] start ${job.id} user=${job.userId} provider=${config.name} mode=${config.generationMode} path=${job.upstreamPath}${index ? ' fallback' : ''}`);
      try {
        outcomeUnknown = true;
        jobResult = await normalizeImageResult(await executeImageJobWithProvider(job, config));
      } catch (error) {
        const message = `上游请求异常: ${formatThrownError(error)}`;
        jobResult = failedImageJobResult(502, message);
        jobResult.outcomeUnknown = !error.definiteFailure;
      }
      outcomeUnknown = Boolean(jobResult.ok || jobResult.outcomeUnknown);
      if (jobResult.ok) {
        const first = JSON.parse(jobResult.body.toString('utf8')).data[0];
        job.outputImageHash = imageHash(`data:${first.mime_type};base64,${first.b64_json}`);
        recordProviderSuccess(config.id);
        break;
      }
      const retryable = isRetryableJobResult(jobResult);
      if (retryable || jobResult.outcomeUnknown) recordProviderFailure(config.id, jobResult.error);
      if (!retryable || index === providers.length - 1) break;
      logLine('WARN', `[image-job] retryable ${job.id} provider=${config.name} status=${jobResult.status} error=${jobResult.error}`);
    }
    job.finishedAt = Date.now();
    job.result = jobResult;
    job.outcomeUnknown = Boolean(jobResult.outcomeUnknown);
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
    job.outcomeUnknown = outcomeUnknown;
    job.error = error.message || String(error);
    job.result = {
      status: 502,
      statusText: 'Queue job failed',
      contentType: 'application/json; charset=utf-8',
      cacheControl: '',
      body: Buffer.from(JSON.stringify({ error: job.error })),
      ok: false, outcomeUnknown,
    };
  } finally {
    if (job.status === 'succeeded') { job.submission = null; job.body = null; job.originalBody = null; }
    try { persist(job); } catch (error) { persistEventually(job); logLine('ERROR', `任务状态保存失败: ${error.message}`); }
    cleanupJobLater(job.id);
  }
}

// ----- Provider routing -----

export function chooseImageProvider(config, upstreamPath, contentType, excludeId, body) {
  const provider = rankedImageProviders(config, upstreamPath, contentType, excludeId, body)[0];
  if (!provider) throw requestError(`没有可用的生图通道, 请检查通道状态`, 503);
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
    let payload = {};
    try { if (body) payload = JSON.parse(Buffer.from(body).toString('utf8')); } catch { return []; }
    return providers.filter((provider) => {
      if (provider.generationMode !== 'images' && provider.generationMode !== 'responses') return false;
      if (payload.output_format && provider.capabilities?.outputFormats && !provider.capabilities.outputFormats.includes(payload.output_format)) return false;
      if (!payload.size || ['auto', '1024x1024', '1536x1024', '1024x1536'].includes(payload.size)) return true;
      return provider.generationMode === 'images' && /^gpt-image-2(?:-|$)/.test(provider.imageModel);
    });
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
  providerCircuitState.set(providerId, { failures: 0, openUntil: 0, lastError: '', lastSuccessAt: Date.now() });
}

function recordProviderFailure(providerId, error) {
  if (!providerId) return;
  const previous = providerCircuitState.get(providerId) || { failures: 0, openUntil: 0, lastError: '' };
  const failures = previous.failures + 1;
  const openUntil = failures >= PROVIDER_FAILURE_THRESHOLD ? Date.now() + PROVIDER_CIRCUIT_OPEN_MS : previous.openUntil || 0;
  providerCircuitState.set(providerId, { ...previous, failures, openUntil, lastError: String(error || ''), lastFailureAt: Date.now() });
  if (openUntil) logLine('WARN', `[image-provider] circuit-open provider=${providerId} failures=${failures} cooldownMs=${PROVIDER_CIRCUIT_OPEN_MS}`);
}

function providersForJob(job, config) {
  if (!job.autoProviderRouting) return [config];
  const providers = rankedImageProviders(config, job.upstreamPath, job.contentType, job.excludeProviderId, job.submission ? Buffer.from(JSON.stringify(toImagesPayload(job.submission))) : job.originalBody || job.body);
  const selectedIndex = providers.findIndex((provider) => provider.id === job.providerId);
  if (selectedIndex <= 0) return providers;
  const [selectedProvider] = providers.splice(selectedIndex, 1);
  return [selectedProvider, ...providers];
}

function applyJobProvider(job, provider) {
  job.providerId = provider.id;
  job.providerName = provider.name;
  if (job.submission) job.recipe = generationRecipe(job.submission, provider);
  else job.body = rewriteImageJobBody(provider, job.originalBody || job.body, job.contentType);
  persist(job);
}
