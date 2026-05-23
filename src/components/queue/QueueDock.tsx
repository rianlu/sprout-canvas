import { ChevronDown, ChevronUp, Clock, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import type { QueueJob } from '../../types/queue';

export function QueueDock({ jobs, active, queued, onCancelJob, onRetryJob }: { jobs: QueueJob[]; active: number; queued: number; onCancelJob: (jobId: string) => void; onRetryJob: (jobId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const previousJobCount = useRef(jobs.length);
  const hasJobs = jobs.length > 0;

  useEffect(() => {
    if (jobs.length > previousJobCount.current || active > 0 || queued > 0) setExpanded(true);
    previousJobCount.current = jobs.length;
  }, [active, jobs.length, queued]);

  const hasWork = active > 0 || queued > 0;

  return (
    <aside className={`queue-dock ${expanded ? 'expanded' : 'collapsed'} ${hasWork ? 'has-work' : 'is-idle'}`}>
      <button className="queue-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} title={expanded ? '收起任务队列' : '展开任务队列'}>
        <span className="queue-summary-copy">
          <span className="eyebrow">Queue</span>
          <strong>{expanded ? '任务队列' : hasWork ? '队列处理中' : '队列'}</strong>
        </span>
        <span className="queue-counts"><span>{active} 运行</span><span>{queued} 排队</span></span>
        <span className="queue-toggle-icon" aria-hidden="true">{expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</span>
      </button>
      {expanded && (
        <div className="queue-list">
          {!hasJobs && <div className="empty-state">暂无任务</div>}
          {jobs.map((job) => (
            <article key={job.id} className={`queue-card ${job.status}`}>
              <div className="queue-card-title">
                {job.status === 'running' ? <Loader2 className="spin" size={16} /> : <Clock size={16} />}
                <strong>{job.clientContext?.prompt || '图片任务'}</strong>
              </div>
              <p>{job.providerName || '自动调度'} · {job.status}</p>
              {job.status === 'pending' && <Button variant="ghost" onClick={() => onCancelJob(job.id)}><X size={14} />取消</Button>}
              {job.status === 'failed' && <p className="error-text">{job.error}</p>}
              {job.status === 'failed' && job.canRetry && <Button variant="ghost" onClick={() => onRetryJob(job.id)}>换服务商重试</Button>}
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}
