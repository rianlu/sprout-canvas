import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelQueueJob, getQueueResult, listQueueJobs, retryQueueJob, submitQueueJob, type QueueSubmitInput } from '../lib/api/queue';
import { dataUrlFormat, normalizeImageOutputFormat, resultDataUrl } from '../lib/image/format';
import type { ResultKind, ResultRecord, StudioMode } from '../types/generation';
import type { QueueJob } from '../types/queue';

const ACTIVE_INTERVAL_MS = 2000;
const IDLE_INTERVAL_MS = 5000;

export function useQueue(onResult: (record: ResultRecord) => void) {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [globalActive, setGlobalActive] = useState(0);
  const [globalQueued, setGlobalQueued] = useState(0);
  const handled = useRef(new Set<string>());
  const workRef = useRef(false);

  const tick = useCallback(async () => {
    const data = await listQueueJobs();
    setJobs(data.jobs || []);
    setGlobalActive(data.globalActive || 0);
    setGlobalQueued(data.globalQueued || 0);
    workRef.current = (data.globalActive || 0) > 0 || (data.globalQueued || 0) > 0;
    for (const job of data.jobs || []) {
      if (job.status !== 'succeeded' || handled.current.has(job.id)) continue;
      handled.current.add(job.id);
      try {
        const result = await getQueueResult(job.id);
        const dataUrl = await resultDataUrl(result, job.clientContext?.outputFormat);
        if (!dataUrl) {
          handled.current.delete(job.id);
          continue;
        }
        const context = job.clientContext;
        onResult({
          id: context?.placeholderId || job.id,
          prompt: context?.prompt || '',
          dataUrl,
          providerId: job.providerId,
          providerName: job.providerName,
          mode: (context?.mode || 'text') as StudioMode,
          kind: (context?.kind || 'single') as ResultKind,
          outputFormat: dataUrlFormat(dataUrl) || normalizeImageOutputFormat(context?.outputFormat),
          createdAt: Date.now(),
        });
      } catch (error) {
        handled.current.delete(job.id);
        console.error('[useQueue] fetch result failed', job.id, error);
      }
    }
  }, [onResult]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;

    function clearScheduled() {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = 0;
      }
    }

    function schedule() {
      if (cancelled || document.hidden) return;
      clearScheduled();
      const interval = workRef.current ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
      timeoutId = window.setTimeout(async () => {
        timeoutId = 0;
        if (cancelled) return;
        await tick().catch(() => undefined);
        schedule();
      }, interval);
    }

    void tick().catch(() => undefined).then(() => { if (!cancelled) schedule(); });

    function handleVisibilityChange() {
      if (cancelled) return;
      if (document.hidden) {
        clearScheduled();
      } else {
        void tick().catch(() => undefined).then(() => { if (!cancelled) schedule(); });
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      clearScheduled();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [tick]);

  const submit = useCallback(async (input: QueueSubmitInput) => {
    const job = await submitQueueJob(input);
    setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    return job;
  }, []);

  const cancel = useCallback(async (jobId: string) => {
    await cancelQueueJob(jobId);
    await tick();
  }, [tick]);

  const retry = useCallback(async (jobId: string) => {
    const response = await retryQueueJob(jobId);
    setJobs((current) => [response.job, ...current.filter((item) => item.id !== response.job.id)]);
    await tick();
    return response.job;
  }, [tick]);

  return { jobs, globalActive, globalQueued, submit, cancel, retry, refresh: tick };
}
