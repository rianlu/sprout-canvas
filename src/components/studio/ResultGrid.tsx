import { Clock, Download, Loader2, Trash2, X } from 'lucide-react';
import type { ResultRecord } from '../../types/generation';
import type { QueueJob } from '../../types/queue';
import { buildDownloadName } from '../../lib/image/filename';
import { Button } from '../ui/Button';

interface ResultGridProps {
  records: ResultRecord[];
  jobs?: QueueJob[];
  onDelete?: (id: string) => void;
  onRetry?: (jobId: string, placeholderId: string) => void;
  onDismiss?: (placeholderId: string) => void;
}

function downloadRecord(record: ResultRecord) {
  const anchor = document.createElement('a');
  anchor.href = record.dataUrl;
  anchor.download = buildDownloadName(record.prompt, record.createdAt);
  anchor.click();
}

function statusLabel(job: QueueJob) {
  if (job.status === 'pending') return job.yourPosition > 0 ? `排队中 · 第 ${job.yourPosition} 位` : '排队中';
  if (job.status === 'running') return '生成中';
  if (job.status === 'failed') return '生成失败';
  if (job.status === 'canceled') return '已取消';
  return '已完成';
}

export function ResultGrid({ records, jobs = [], onDelete, onRetry, onDismiss }: ResultGridProps) {
  const completedIds = new Set(records.map((record) => record.id));
  const visibleJobs = jobs.filter((job) => !completedIds.has(job.clientContext?.placeholderId || job.id) && job.status !== 'succeeded');
  const hasItems = records.length > 0 || visibleJobs.length > 0;

  return (
    <section className="result-grid current-task-grid">
      {!hasItems && <div className="empty-state large">提交后会显示当前排队和生成结果.</div>}
      {visibleJobs.map((job) => {
        const placeholderId = job.clientContext?.placeholderId || job.id;
        return (
          <article className={`result-card task-card ${job.status}`} key={job.id}>
            <div className="task-placeholder">
              {job.status === 'running' ? <Loader2 className="spin" size={22} /> : <Clock size={22} />}
              <strong>{statusLabel(job)}</strong>
              <span>{job.providerName || '自动调度'}</span>
            </div>
            <div className="result-meta">
              <strong className="prompt-clamp" title={job.clientContext?.prompt || '图片任务'}>{job.clientContext?.prompt || '图片任务'}</strong>
              {job.status === 'failed' && <span className="error-text">{job.error}</span>}
            </div>
            {(job.status === 'failed' || job.status === 'canceled') && (
              <div className="result-actions">
                {job.status === 'failed' && onRetry && <Button variant="ghost" onClick={() => onRetry(job.id, placeholderId)}>换服务商重试</Button>}
                {onDismiss && <Button variant="ghost" onClick={() => onDismiss(placeholderId)} aria-label="关闭"><X size={14} />关闭</Button>}
              </div>
            )}
          </article>
        );
      })}
      {records.map((record) => (
        <article className="result-card" key={record.id}>
          <img src={record.dataUrl} alt={record.prompt} />
          <div className="result-meta"><strong className="prompt-clamp" title={record.prompt || '无提示词'}>{record.prompt || '无提示词'}</strong><span>{record.providerName || '自动调度'}</span></div>
          <div className="result-actions">
            <Button variant="ghost" onClick={() => downloadRecord(record)}><Download size={14} />下载</Button>
            {onDelete && <Button variant="ghost" onClick={() => onDelete(record.id)}><Trash2 size={14} />删除</Button>}
          </div>
        </article>
      ))}
    </section>
  );
}
