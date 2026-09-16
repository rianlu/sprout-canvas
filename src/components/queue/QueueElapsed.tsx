import { useEffect, useRef, useState } from 'react';
import { formatQueueDuration, queueElapsedMs, type QueueTiming } from '../../lib/queue-presentation';

export function QueueElapsed({ job, enabled = true }: { job: QueueTiming; enabled?: boolean }) {
  const [, tick] = useState(0);
  const live = job.status === 'pending' || job.status === 'running';
  const key = `${job.id}:${job.status}:${job.status === 'pending' ? job.queuedAt : job.startedAt}`;
  const now = performance.now();
  const sample = `${job.serverNow}:${job.receivedAt}`;
  const clock = useRef({ key, sample, elapsed: queueElapsedMs(job, now), at: now });
  if (clock.current.key !== key || clock.current.sample !== sample) {
    const previous = clock.current;
    const elapsed = queueElapsedMs(job, now);
    // Keep advancing through delayed snapshots, then reset only on a stage change.
    clock.current = { key, sample, at: now, elapsed: live && previous.key === key ? Math.max(elapsed, previous.elapsed + Math.max(0, now - previous.at)) : elapsed };
  }
  const elapsed = clock.current.elapsed + (live ? Math.max(0, now - clock.current.at) : 0);

  useEffect(() => {
    if (!live || !enabled) return;
    let timer = 0;
    const resume = () => {
      window.clearInterval(timer);
      if (document.hidden) return;
      tick((value) => value + 1);
      timer = window.setInterval(() => tick((value) => value + 1), 1000);
    };
    resume();
    document.addEventListener('visibilitychange', resume);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, [live, enabled, key]);

  return <span role="timer" aria-live="off" data-job-timer={job.id} data-timer-stage={job.status} className="tabular-nums whitespace-nowrap">{job.status === 'pending' ? '已排队' : '已渲染'} {formatQueueDuration(elapsed)}</span>;
}
