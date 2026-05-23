import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelQueueJob, getQueueResult, listQueueJobs, retryQueueJob, submitQueueJob, type QueueSubmitInput } from '../lib/api/queue';
import { resultDataUrl } from '../lib/image/format';
import type { ResultKind, ResultRecord, StudioMode } from '../types/generation';
import type { QueueJob } from '../types/queue';

export function useQueue(onResult: (record: ResultRecord) => void) {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [globalActive, setGlobalActive] = useState(0);
  const [globalQueued, setGlobalQueued] = useState(0);
  const handled = useRef(new Set<string>());

  const tick = useCallback(async () => {
    const data = await listQueueJobs();
    setJobs(data.jobs || []);
    setGlobalActive(data.globalActive || 0);
    setGlobalQueued(data.globalQueued || 0);
    for (const job of data.jobs || []) {
      if (job.status !== 'succeeded' || handled.current.has(job.id)) continue;
      handled.current.add(job.id);
      const result = await getQueueResult(job.id);
      const dataUrl = resultDataUrl(result);
      if (!dataUrl) continue;
      const context = job.clientContext;
      onResult({
        id: context?.placeholderId || job.id,
        prompt: context?.prompt || '',
        dataUrl,
        providerId: job.providerId,
        providerName: job.providerName,
        mode: (context?.mode || 'text') as StudioMode,
        kind: (context?.kind || 'single') as ResultKind,
        createdAt: Date.now(),
      });
    }
  }, [onResult]);

  useEffect(() => {
    const timer = window.setInterval(() => { void tick().catch(() => undefined); }, 2200);
    void tick().catch(() => undefined);
    return () => window.clearInterval(timer);
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

