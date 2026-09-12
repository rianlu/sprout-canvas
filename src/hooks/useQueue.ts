import { useCallback, useEffect, useRef, useState } from 'react';
import { acknowledgeQueueJob, archiveQueueJobs, cancelQueueJob, getQueueResult, listQueueJobs, prioritizeQueueJob, resumeQueueJob, submitQueueJob, submitQueueBatch, updateQueueJob, type QueueSubmitInput } from '../lib/api/queue';
import { ApiError } from '../lib/api/client';
import { dataUrlFormat, resultDataUrls } from '../lib/image/format';
import { attachLocalReference, getOutboxInput, isJobConsumed, listOutbox, removeOutbox, saveOutbox, saveOutboxBatch, collectUnusedReferences, replaceWorkspaceRequest, completeWorkspaceRequest } from '../lib/storage/gallery-db';
import { randomId } from '../lib/random/id';
import { validateGenerationSubmission } from '../../shared/generation-contract.mjs';
import type { ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';
import { bindCreditQuote, getCreditQuote } from '../lib/credits';
import { needsNewCreditIdentity, recoverSubmissionBatch } from '../lib/queue-recovery';

function localJob(input: QueueSubmitInput, savedAt: number, jobId?: string): QueueJob {
  return { id: jobId || `local_${input.requestId}`, requestId: input.requestId, status: jobId ? 'interrupted' : 'unsubmitted', localOnly: true, outcomeUnknown: Boolean(jobId), clientContext: input.clientContext, error: jobId ? '服务端任务记录已过期, 可从本地配方重新生成' : '尚未确认提交, 可继续提交', canRetry: true, retryOf: input.retryOf || '', providerId: '', providerName: '', yourPosition: 0, yourQueued: 0, globalActive: 0, globalQueued: 0, averageMs: 0, estimatedWaitMs: 0, queuedAt: savedAt, startedAt: 0, finishedAt: 0, elapsedMs: 0 };
}

export function useQueue(onResult: (records: ResultRecord[], jobId: string) => Promise<unknown>, enabled = true, ownerId = '') {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [globalActive, setGlobalActive] = useState(0);
  const [globalQueued, setGlobalQueued] = useState(0);
  const [error, setError] = useState('');
  const [historyCursor, setHistoryCursor] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const historyCache = useRef(new Map<string, QueueJob>());
  const historyExpanded = useRef(false);
  const retrying = useRef(new Map<string, Promise<QueueJob>>());
  const handled = useRef(new Set<string>());
  const workRef = useRef(false);
  const polling = useRef<Promise<void> | null>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  useEffect(() => {
    historyCache.current.clear(); historyExpanded.current = false; handled.current.clear();
    jobsRef.current = []; setJobs([]); setHistoryCursor(''); setError('');
  }, [ownerId]);

  const tick = useCallback(async () => {
    if (!enabled || !ownerId) return;
    if (polling.current) return polling.current;
    const isCurrent = () => ownerRef.current === ownerId;
    const operation = (async () => {
      const outbox = await listOutbox();
      const data = await listQueueJobs({ requestIds: outbox.slice(0, 100).map((row) => row.requestId) });
      if (ownerRef.current !== ownerId) return;
      if (data.userId !== ownerId) { window.dispatchEvent(new Event('sprout:credits-refresh')); return; }
      const latest = [...(data.jobs || [])];
      for (let offset = 100; offset < outbox.length; offset += 100) {
        if (!isCurrent()) return;
        const page = await listQueueJobs({ limit: 1, requestIds: outbox.slice(offset, offset + 100).map((row) => row.requestId) });
        if (!isCurrent() || page.userId !== ownerId) return;
        latest.push(...page.jobs);
      }
      if (!historyExpanded.current) setHistoryCursor(data.historyCursor || '');
      for (const job of latest) if (historyCache.current.has(job.id)) historyCache.current.set(job.id, job);
      const serverJobs = [...new Map([...historyCache.current.values(), ...latest].map((job) => [job.id, job])).values()];
      const visible = serverJobs.filter((job) => !job.archivedAt).map((job) => ({ ...job, canRetry: !job.supersededBy && ['failed', 'expired', 'interrupted'].includes(job.status) && outbox.some((row) => row.requestId === job.requestId) }));
      for (const row of outbox) if (!serverJobs.some((job) => job.requestId === row.requestId) && !(row.jobId && await isJobConsumed(row.jobId))) visible.push(localJob(row.input, row.savedAt, row.jobId));
      if (!isCurrent()) return;
      setJobs(visible);
      jobsRef.current = visible;
      setGlobalActive(data.globalActive || 0);
      setGlobalQueued(data.globalQueued || 0);
      workRef.current = visible.some((job) => ['running', 'pending'].includes(job.status));
      for (const job of serverJobs) {
        if (!isCurrent()) return;
        const source = job.retryOf && serverJobs.find((item) => item.id === job.retryOf);
        if (source && outbox.some((row) => row.requestId === source.requestId)) await replaceWorkspaceRequest(source.requestId, job.requestId);
      }
      const replaced = outbox.filter((row) => serverJobs.some((job) => job.requestId === row.requestId && job.supersededBy));
      for (const row of replaced) { if (!isCurrent()) return; await removeOutbox(row.requestId); }
      if (replaced.length) await collectUnusedReferences();
      let failure = '';
      for (const job of serverJobs.sort((a, b) => a.finishedAt - b.finishedAt)) {
        if (!isCurrent()) return;
        if (!['succeeded', 'expired'].includes(job.status) || handled.current.has(job.id)) continue;
        try {
          if (job.acknowledgedAt || await isJobConsumed(job.id)) {
            if (!isCurrent()) return;
            if (await isJobConsumed(job.id)) await completeWorkspaceRequest(job.requestId);
            if (!isCurrent()) return;
            if (!job.acknowledgedAt) await acknowledgeQueueJob(job.id);
            if (!isCurrent()) return;
            handled.current.add(job.id);
            if (job.requestId) await removeOutbox(job.requestId);
            continue;
          }
          if (job.status !== 'succeeded') continue;
          const result = await getQueueResult(job.id);
          const images = await resultDataUrls(result);
          if (!isCurrent()) return;
          const context = job.clientContext;
          if (!images.length || !context) throw new Error('任务未返回可保存的作品');
          const records: ResultRecord[] = images.map((dataUrl, index) => ({
            id: index === 0 ? context.placeholderId : `${context.placeholderId}-${index + 1}`,
            prompt: context.prompt, dataUrl, providerId: job.providerId, providerName: job.providerName,
            mode: context.mode, kind: context.kind, outputFormat: dataUrlFormat(dataUrl) || 'png',
            createdAt: job.finishedAt || (result.created || 0) * 1000 || job.queuedAt,
            jobId: job.id, requestId: job.requestId, seriesId: context.seriesId, masterPrompt: context.masterPrompt,
            batchId: context.batchId, submittedAt: job.queuedAt,
            sceneId: context.sceneId, sceneIndex: context.sceneIndex, version: context.version,
            parentId: context.parentId, template: context.template, recipe: job.recipe || undefined,
            revisedPrompt: result.data?.[index]?.revised_prompt,
            width: result.data?.[index]?.width, height: result.data?.[index]?.height, bytes: result.data?.[index]?.bytes,
          }));
          await onResult(records, job.id);
          if (!isCurrent()) return;
          await completeWorkspaceRequest(job.requestId);
          if (!isCurrent()) return;
          await acknowledgeQueueJob(job.id);
          if (!isCurrent()) return;
          handled.current.add(job.id);
          if (job.requestId) await removeOutbox(job.requestId);
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 401) throw cause;
          failure = cause instanceof Error ? cause.message : '图片保存失败';
        }
      }
      if (isCurrent()) setError(failure ? `作品尚未保存: ${failure}. 请保持页面打开并重试.` : '');
    })();
    polling.current = operation;
    try { await operation; }
    catch (cause) { if (isCurrent() && !(cause instanceof ApiError && cause.status === 401)) setError(cause instanceof Error ? cause.message : '队列连接失败'); }
    finally { polling.current = null; }
  }, [enabled, ownerId, onResult]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer = 0;
    async function poll() {
      await tick();
      if (!stopped && !document.hidden) timer = window.setTimeout(poll, workRef.current ? 2000 : 5000);
    }
    function visibility() { window.clearTimeout(timer); if (!document.hidden) void poll(); }
    void poll();
    document.addEventListener('visibilitychange', visibility);
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [enabled, tick]);

  const submit = useCallback(async (value: QueueSubmitInput, onAccepted?: () => void) => {
    const quote = bindCreditQuote(value.creditQuote);
    const input = validateGenerationSubmission(await attachLocalReference({ ...value, creditQuote: quote }));
    await saveOutbox(input);
    try {
      const job = await submitQueueJob(input);
      if (ownerRef.current === quote.userId) onAccepted?.();
      await saveOutbox(input, job.id);
      const source = job.retryOf && jobsRef.current.find((item) => item.id === job.retryOf);
      if (source) await replaceWorkspaceRequest(source.requestId, job.requestId);
      const next = [job, ...jobsRef.current.filter((item) => item.requestId !== job.requestId).map((item) => item.id === job.retryOf ? { ...item, supersededBy: job.id, canRetry: false } : item)];
      if (ownerRef.current === quote.userId) { jobsRef.current = next; setJobs(next); }
      return job;
    } catch (cause) { await tick(); throw cause; }
  }, [tick]);

  const submitBatch = useCallback(async (inputs: QueueSubmitInput[], onAccepted?: () => void) => {
    const quote = getCreditQuote();
    const prepared = await Promise.all(inputs.map(async (input) => validateGenerationSubmission(await attachLocalReference({ ...input, creditQuote: bindCreditQuote(input.creditQuote, quote) }))));
    await saveOutboxBatch(prepared.map((input) => ({ input })));
    try {
      const { jobs: accepted } = await submitQueueBatch(prepared);
      if (ownerRef.current === quote.userId) onAccepted?.();
      for (const job of accepted) {
        const input = prepared.find((item) => item.requestId === job.requestId)!;
        await saveOutbox(input, job.id);
        const source = job.retryOf && jobsRef.current.find((item) => item.id === job.retryOf);
        if (source) await replaceWorkspaceRequest(source.requestId, job.requestId);
      }
      await tick();
      return accepted;
    } catch (cause) { await tick(); throw cause; }
  }, [tick]);

  const cancel = useCallback(async (jobId: string) => {
    const source = jobsRef.current.find((job) => job.id === jobId);
    if (source?.localOnly) await removeOutbox(source.requestId);
    else {
      await cancelQueueJob(jobId);
      if (source?.requestId) await removeOutbox(source.requestId);
    }
    await collectUnusedReferences();
    await tick();
  }, [tick]);

  const retry = useCallback(async (jobId: string) => {
    if (retrying.current.has(jobId)) return retrying.current.get(jobId)!;
    const operation = (async () => {
    const source = jobsRef.current.find((job) => job.id === jobId);
    if (!source) throw new Error('任务不存在');
    if (source.supersededBy) throw new Error('此任务已重新提交, 请查看最新任务');
    const input = await getOutboxInput(source.requestId);
    if (!input) throw new Error('本地原始配方不存在, 请回到创作页重新填写');
    const quote = getCreditQuote();
    const changedOwner = needsNewCreditIdentity(input, quote);
    if (changedOwner) {
      const recovered = await recoverSubmissionBatch([input], quote);
      const job = await submit(recovered.inputs[0]);
      await tick();
      return job;
    }
    if (source.status === 'unsubmitted' && !changedOwner) return submit({ ...input, creditQuote: bindCreditQuote(input.creditQuote, quote, true) });
    if (source.interruptionReason === 'pending-restart' && !source.outcomeUnknown && !changedOwner) {
      const restored = await attachLocalReference({ ...input, creditQuote: bindCreditQuote(input.creditQuote, quote) });
      const job = await resumeQueueJob(jobId, restored);
      await saveOutbox(restored, job.id);
      await tick();
      return job;
    }
    const settlement = source.credit?.unlimited ? '原任务使用无限额度, 未占用点数' : source.credit?.state === 'charged' ? '原占用点数已扣除' : source.credit?.state === 'refunded' ? '原占用点数已返还' : '占用点数待管理员核实';
    const nextCharge = quote.unlimited ? '当前为无限额度, 重新生成不扣减余额' : '重新生成会作为新任务扣点';
    if (source.outcomeUnknown && !changedOwner && !window.confirm(`上一次生成的结果未知, ${settlement}. ${nextCharge}, 是否继续?`)) throw new Error('已取消重新生成');
    const queuedRetry = (await listOutbox()).find((row) => row.input.retryOf === jobId);
    if (queuedRetry && !changedOwner) {
      const retryInput = await getOutboxInput(queuedRetry.requestId);
      if (retryInput) return submit(retryInput);
    }
    const next = { ...input, creditQuote: quote, requestId: randomId(), providerId: input.request.mask ? input.providerId : undefined, retryOf: source.localOnly || changedOwner ? undefined : jobId, clientContext: { ...input.clientContext, placeholderId: randomId(), parentId: input.clientContext.placeholderId, version: (input.clientContext.version || 1) + 1 } };
    if ((source.localOnly || changedOwner) && next.referenceJobId) {
      const restored = await attachLocalReference(next);
      if (!restored.referenceImage) throw new Error('原参考任务已过期, 请从本地作品重新选择参考图');
      next.request = { ...next.request, references: [restored.referenceImage, ...next.request.references].slice(0, 4) };
      delete next.referenceJobId; delete next.referenceImage;
    }
    const job = await submit(next);
    await replaceWorkspaceRequest(source.requestId, job.requestId);
    if (source.localOnly) await removeOutbox(source.requestId);
    await tick();
    return job;
    })();
    retrying.current.set(jobId, operation);
    try { return await operation; } finally { retrying.current.delete(jobId); }
  }, [submit, tick]);

  const update = useCallback(async (jobId: string, input: QueueSubmitInput) => {
    input = { ...input, creditQuote: bindCreditQuote(input.creditQuote) };
    const previous = await getOutboxInput(input.requestId);
    await saveOutbox(validateGenerationSubmission(input), jobId);
    let job;
    try { job = await updateQueueJob(jobId, input); }
    catch (cause) {
      if (previous && cause instanceof ApiError && cause.status >= 400 && cause.status < 500) await saveOutbox(previous, jobId);
      throw cause;
    }
    await tick();
    return job;
  }, [tick]);
  const prioritize = useCallback(async (jobId: string) => { await prioritizeQueueJob(jobId); await tick(); }, [tick]);
  const archive = useCallback(async () => { await archiveQueueJobs(); historyCache.current.clear(); historyExpanded.current = false; await tick(); }, [tick]);
  const loadMore = useCallback(async () => {
    if (!historyCursor || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const page = await listQueueJobs({ cursor: historyCursor });
      if (ownerRef.current !== ownerId || page.userId !== ownerId) return;
      for (const job of [...jobsRef.current, ...page.jobs]) if (!['pending', 'running', 'unsubmitted'].includes(job.status) && !job.localOnly) historyCache.current.set(job.id, job);
      historyExpanded.current = true;
      setHistoryCursor(page.historyCursor || '');
      await tick();
    } finally { setLoadingHistory(false); }
  }, [historyCursor, loadingHistory, tick, ownerId]);
  return { jobs, globalActive, globalQueued, error, submit, submitBatch, cancel, retry, update, prioritize, archive, refresh: tick, loadMore, hasMore: Boolean(historyCursor), loadingHistory };
}
