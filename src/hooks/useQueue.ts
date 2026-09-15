import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { archiveQueueJobs, cancelQueueJob, listQueueJobs, prioritizeQueueJob, resumeQueueJob, submitQueueJob, submitQueueBatch, updateQueueJob, type QueueSubmitInput } from '../lib/api/queue';
import { ApiError } from '../lib/api/client';
import { attachLocalReference, getOutboxInput, isJobConsumed, listOutbox, removeOutbox, saveOutbox, saveOutboxBatch, markOutboxAccepted, collectUnusedReferences, replaceWorkspaceRequest } from '../lib/storage/gallery-db';
import { randomId } from '../lib/random/id';
import { validateGenerationSubmission } from '../../shared/generation-contract.mjs';
import type { ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';
import { bindCreditQuote, getCreditQuote } from '../lib/credits';
import { needsNewCreditIdentity, recoverSubmissionBatch } from '../lib/queue-recovery';
import { useQueueDelivery } from './useQueueDelivery';

function localJob(input: QueueSubmitInput, savedAt: number, jobId?: string, submitting = false): QueueJob {
  return { id: jobId || `local_${input.requestId}`, requestId: input.requestId, status: submitting ? 'submitting' : jobId ? 'interrupted' : 'unsubmitted', localOnly: true, outcomeUnknown: Boolean(jobId), clientContext: input.clientContext, error: submitting ? '' : jobId ? '服务端任务记录已过期, 可从本地配方重新生成' : '尚未确认提交, 可继续提交', canRetry: !submitting, retryOf: input.retryOf || '', providerId: '', providerName: '', yourPosition: 0, yourQueued: 0, globalActive: 0, globalQueued: 0, averageMs: 0, estimatedWaitMs: 0, queuedAt: savedAt, startedAt: 0, finishedAt: 0, elapsedMs: 0 };
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
  const submitting = useRef(new Map<string, { ownerId: string }>());
  const mutation = useRef(0);
  const workRef = useRef(false);
  const scope = useMemo(() => ({ enabled, ownerId, stopped: false }), [enabled, ownerId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const polling = useRef<{ scope: typeof scope; promise: Promise<void>; controller: AbortController } | null>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  const delivery = useQueueDelivery(onResult, enabled, ownerId);

  useEffect(() => {
    scope.stopped = false;
    historyCache.current.clear(); historyExpanded.current = false;
    jobsRef.current = []; setJobs([]); setHistoryCursor(''); setError('');
    setGlobalActive(0); setGlobalQueued(0); workRef.current = false;
    return () => { scope.stopped = true; if (polling.current?.scope === scope) polling.current.controller.abort(); };
  }, [scope]);

  const tick = useCallback(async () => {
    if (!scope.enabled || !scope.ownerId || scope.stopped || currentScope.current !== scope) return;
    if (polling.current?.scope === scope && !polling.current.controller.signal.aborted) return polling.current.promise.catch(() => {});
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    const isCurrent = () => currentScope.current === scope && !scope.stopped && !controller.signal.aborted;
    const version = mutation.current;
    const operation = (async () => {
      const outbox = await listOutbox();
      if (!isCurrent()) return;
      const data = await listQueueJobs({ requestIds: outbox.slice(0, 100).map((row) => row.requestId), signal });
      if (!isCurrent()) return;
      if (!data || !Array.isArray(data.jobs)) throw new Error('队列状态读取未完成, 请重试');
      if (data.userId !== scope.ownerId) { window.dispatchEvent(new Event('sprout:credits-refresh')); return; }
      const latest = [...(data.jobs || [])];
      for (let offset = 100; offset < outbox.length; offset += 100) {
        if (!isCurrent()) return;
        const page = await listQueueJobs({ limit: 1, requestIds: outbox.slice(offset, offset + 100).map((row) => row.requestId), signal });
        if (!isCurrent()) return;
        if (!page || !Array.isArray(page.jobs)) throw new Error('队列状态读取未完成, 请重试');
        if (page.userId !== scope.ownerId) return;
        latest.push(...page.jobs);
      }
      // A response started before submission changed must not replace a newer accepted job.
      if (!isCurrent() || mutation.current !== version) return;
      if (!historyExpanded.current) setHistoryCursor(data.historyCursor || '');
      for (const job of latest) if (historyCache.current.has(job.id)) historyCache.current.set(job.id, job);
      const serverJobs = [...new Map([...historyCache.current.values(), ...latest].map((job) => [job.id, job])).values()];
      const visible = serverJobs.filter((job) => !job.archivedAt).map((job) => ({ ...job, canRetry: !job.supersededBy && ['failed', 'expired', 'interrupted'].includes(job.status) && outbox.some((row) => row.requestId === job.requestId) }));
      for (const row of outbox) if (!serverJobs.some((job) => job.requestId === row.requestId) && !(row.jobId && await isJobConsumed(row.jobId))) visible.push(localJob(row.input, row.savedAt, row.jobId, submitting.current.get(row.requestId)?.ownerId === scope.ownerId));
      if (!isCurrent() || mutation.current !== version) return;
      setJobs(visible);
      jobsRef.current = visible;
      setGlobalActive(data.globalActive || 0);
      setGlobalQueued(data.globalQueued || 0);
      workRef.current = visible.some((job) => ['running', 'pending', 'submitting'].includes(job.status) || job.status === 'succeeded' && !job.acknowledgedAt);
      const unlinked = serverJobs.filter((job) => outbox.some((row) => row.requestId === job.requestId && row.jobId !== job.id));
      if (unlinked.length) await markOutboxAccepted(unlinked, false);
      for (const job of serverJobs) {
        if (!isCurrent()) return;
        const source = job.retryOf && serverJobs.find((item) => item.id === job.retryOf);
        if (source && outbox.some((row) => row.requestId === source.requestId)) await replaceWorkspaceRequest(source.requestId, job.requestId);
      }
      const replaced = outbox.filter((row) => serverJobs.some((job) => job.requestId === row.requestId && job.supersededBy));
      for (const row of replaced) { if (!isCurrent()) return; await removeOutbox(row.requestId); }
      if (replaced.length) await collectUnusedReferences();
      if (isCurrent()) { delivery.enqueue(serverJobs); setError(''); }
    })();
    polling.current = { scope, promise: operation, controller };
    try { await operation; }
    catch (cause) {
      if (isCurrent() && !(cause instanceof ApiError && cause.status === 401)) setError(cause instanceof Error && cause.name === 'TimeoutError' ? '队列连接超时, 正在重新连接' : cause instanceof Error ? cause.message : '队列连接失败');
    } finally { if (polling.current?.promise === operation) polling.current = null; }
  }, [scope, delivery.enqueue]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer = 0;
    async function poll() {
      window.clearTimeout(timer);
      await tick();
      if (!stopped && !document.hidden) { window.clearTimeout(timer); timer = window.setTimeout(poll, workRef.current ? 2000 : 5000); }
    }
    function reconnect() { window.clearTimeout(timer); if (!document.hidden) void poll(); }
    void poll();
    document.addEventListener('visibilitychange', reconnect);
    window.addEventListener('online', reconnect);
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', reconnect); window.removeEventListener('online', reconnect); };
  }, [enabled, tick]);

  const send = useCallback(async (inputs: QueueSubmitInput[], userId: string, post: () => Promise<QueueJob[]>, onAccepted?: () => void) => {
    if (inputs.some((input) => submitting.current.has(input.requestId))) throw new Error('请求正在提交, 请稍候');
    const token = { ownerId: userId };
    const submissionScope = currentScope.current;
    const isCurrent = () => currentScope.current === submissionScope && !submissionScope.stopped && submissionScope.enabled && submissionScope.ownerId === userId;
    const requestIds = new Set(inputs.map((input) => input.requestId));
    for (const id of requestIds) submitting.current.set(id, token);
    mutation.current++;
    let saved = false;
    let accepted: QueueJob[] = [];
    try {
      await saveOutboxBatch(inputs.map((input) => ({ input })));
      saved = true;
      if (!isCurrent()) throw new Error('访问身份已变化, 请重新确认提交');
      const local = inputs.map((input) => localJob(input, jobsRef.current.find((job) => job.requestId === input.requestId)?.queuedAt || Date.now(), undefined, true));
      jobsRef.current = [...local, ...jobsRef.current.filter((job) => !requestIds.has(job.requestId))];
      setJobs(jobsRef.current); workRef.current = true;
      const response = await post();
      if (!Array.isArray(response) || response.length !== inputs.length || response.some((job) => !job?.id || !requestIds.has(job.requestId)) || new Set(response.map((job) => job.requestId)).size !== inputs.length) throw new Error('提交响应尚未确认, 请在任务队列中查看');
      accepted = response;
      mutation.current++;
      if (isCurrent()) {
        const latest = accepted.map((job) => {
          const known = jobsRef.current.find((item) => item.id === job.id && !item.localOnly);
          return known && (!['pending', 'running'].includes(known.status) || known.startedAt > job.startedAt) ? known : job;
        });
        jobsRef.current = [...latest, ...jobsRef.current.filter((job) => !requestIds.has(job.requestId)).map((job) => {
          const replacement = accepted.find((next) => next.retryOf === job.id);
          return replacement ? { ...job, supersededBy: replacement.id, canRetry: false } : job;
        })];
        setJobs(jobsRef.current);
        onAccepted?.();
      }
      await markOutboxAccepted(accepted);
      for (const job of accepted) {
        const source = job.retryOf && jobsRef.current.find((item) => item.id === job.retryOf);
        if (source) await replaceWorkspaceRequest(source.requestId, job.requestId);
      }
      return accepted;
    } catch (cause) {
      if (!accepted.length) throw cause;
      if (isCurrent()) setError('任务已受理, 本地提交记录同步未完成, 正在重新核对');
      return accepted;
    } finally {
      for (const id of requestIds) if (submitting.current.get(id) === token) submitting.current.delete(id);
      mutation.current++;
      if (saved && isCurrent()) {
        jobsRef.current = jobsRef.current.map((job) => requestIds.has(job.requestId) && job.localOnly && job.status === 'submitting' ? { ...job, status: 'unsubmitted', canRetry: true, error: '尚未确认提交, 可继续提交' } : job);
        setJobs(jobsRef.current);
      }
      void tick();
    }
  }, [tick]);

  const submit = useCallback(async (value: QueueSubmitInput, onAccepted?: () => void) => {
    const quote = bindCreditQuote(value.creditQuote);
    const input = validateGenerationSubmission(await attachLocalReference({ ...value, creditQuote: quote }));
    return (await send([input], quote.userId, async () => [await submitQueueJob(input)], onAccepted))[0];
  }, [send]);

  const submitBatch = useCallback(async (inputs: QueueSubmitInput[], onAccepted?: () => void) => {
    const quote = getCreditQuote();
    const prepared = await Promise.all(inputs.map(async (input) => validateGenerationSubmission(await attachLocalReference({ ...input, creditQuote: bindCreditQuote(input.creditQuote, quote) }))));
    return send(prepared, quote.userId, async () => (await submitQueueBatch(prepared))?.jobs, onAccepted);
  }, [send]);

  const cancel = useCallback(async (jobId: string) => {
    const source = jobsRef.current.find((job) => job.id === jobId);
    if (source?.status === 'submitting') throw new Error('请求正在提交, 请等待确认后再操作');
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
    if (source.status === 'submitting') throw new Error('请求正在提交, 请稍候');
    if (source.status === 'succeeded') { delivery.retry(jobId); return source; }
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
      await markOutboxAccepted([job]);
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
  }, [submit, tick, delivery.retry]);

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
      if (!page || !Array.isArray(page.jobs)) throw new Error('历史任务读取未完成, 请重试');
      if (ownerRef.current !== ownerId || page.userId !== ownerId) return;
      for (const job of [...jobsRef.current, ...page.jobs]) if (!['pending', 'running', 'unsubmitted', 'submitting'].includes(job.status) && !job.localOnly) historyCache.current.set(job.id, job);
      historyExpanded.current = true;
      setHistoryCursor(page.historyCursor || '');
      await tick();
    } finally { setLoadingHistory(false); }
  }, [historyCursor, loadingHistory, tick, ownerId]);
  const refresh = useCallback(() => { delivery.retry(); return tick(); }, [delivery.retry, tick]);
  const visibleJobs = jobs.map((job) => ({ ...job, delivery: delivery.states.get(job.id) }));
  return { jobs: visibleJobs, globalActive, globalQueued, error: error || delivery.error, submit, submitBatch, cancel, retry, update, prioritize, archive, refresh, loadMore, hasMore: Boolean(historyCursor), loadingHistory };
}
