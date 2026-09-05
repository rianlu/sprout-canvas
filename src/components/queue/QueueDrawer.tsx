import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, X } from 'lucide-react';
import type { QueueJob } from '../../types/queue';

interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
  jobs: QueueJob[];
  onCancelJob: (jobId: string) => void;
  onRetryJob: (jobId: string) => void;
}

const IDLE_AUTO_CLOSE_MS = 5 * 60 * 1000;

function jobStatusMeta(job: QueueJob): { label: string; icon: typeof Clock; className: string } {
  if (job.status === 'running') return { label: '生成中', icon: Loader2, className: 'running' };
  if (job.status === 'pending') return { label: job.yourPosition ? `排队中 · 第 ${job.yourPosition} 位` : '排队中', icon: Clock, className: 'pending' };
  if (job.status === 'succeeded') return { label: '已完成', icon: CheckCircle2, className: 'succeeded' };
  if (job.status === 'failed') return { label: '失败', icon: AlertCircle, className: 'failed' };
  return { label: '已取消', icon: X, className: 'canceled' };
}

function formatElapsed(ms: number): string {
  if (!ms) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function formatEstimate(ms: number): string {
  // estimatedWaitMs 由队列计算: 位次 × 平均耗时; 前端类型未声明时回退用 averageMs
  if (!ms) return '';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '即将开始';
  return `预计还需约 ${minutes} 分钟`;
}

function pendingEstimate(job: QueueJob): string {
  const base = job.yourPosition ? job.yourPosition * (job.averageMs || 0) : 0;
  return formatEstimate(base);
}

export function QueueDrawer({ open, onClose, jobs, onCancelJob, onRetryJob }: QueueDrawerProps) {
  const hasWork = jobs.some((job) => job.status === 'pending' || job.status === 'running');

  // 空闲 5 分钟自动收起 (PRD §4.7)
  useEffect(() => {
    if (!open || hasWork) return undefined;
    const timer = window.setTimeout(onClose, IDLE_AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, hasWork, onClose]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside className="queue-drawer open" role="dialog" aria-label="任务队列" aria-modal="false">
      <div className="queue-drawer-head">
        <div className="head-copy">
          <h2>任务队列</h2>
          <span className="chip chip-accent">{jobs.filter((job) => job.status === 'running').length} 运行</span>
          <span className="chip">{jobs.filter((job) => job.status === 'pending').length} 排队</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭任务队列">
          <X size={17} />
        </button>
      </div>

      <div className="queue-drawer-body">
        {jobs.length === 0 && <div className="empty-state">暂无任务。提交生成后这里会显示排队与进度.</div>}
        {jobs.map((job) => {
          const meta = jobStatusMeta(job);
          const Icon = meta.icon;
          return (
            <article key={job.id} className={`queue-task ${meta.className}`}>
              <div className="task-top">
                <div className="task-copy">
                  <strong>{job.clientContext?.prompt || '图片任务'}</strong>
                  <span className="task-sub">{meta.label}</span>
                </div>
                <Icon className={`state-icon ${meta.className === 'running' ? 'spin' : ''}`} size={16} aria-hidden="true" />
              </div>

              {job.status === 'running' && (
                <>
                  <div className="progress-track"><div className="fill breathe" /></div>
                  <div className="task-foot">
                    <span>已等待 {formatElapsed(job.elapsedMs) || '—'}</span>
                  </div>
                </>
              )}

              {job.status === 'pending' && (
                <div className="task-foot">
                  <span>{pendingEstimate(job)}</span>
                  <button type="button" className="link-btn danger" onClick={() => onCancelJob(job.id)}>取消</button>
                </div>
              )}

              {job.status === 'failed' && (
                <div className="task-foot">
                  <span className="error-text" style={{ color: 'var(--danger)', fontSize: 'inherit' }}>{job.error || '生成失败'}</span>
                  {job.canRetry && (
                    <button type="button" className="link-btn" onClick={() => onRetryJob(job.id)}>重试</button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="queue-drawer-foot">
        <span>严格单任务顺序出图</span>
        <span>任务记录保留 30 分钟</span>
      </div>
    </aside>
  );
}
