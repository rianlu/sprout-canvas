import { AlertCircle, Brush, Clock, Download, Expand, ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import type { ResultRecord } from '../../types/generation';
import type { QueueJob } from '../../types/queue';
import { buildDownloadName } from '../../lib/image/filename';
import { imageFileExtension } from '../../lib/image/format';

interface ResultStreamProps {
  records: ResultRecord[];
  jobs: QueueJob[];
  pendingIds?: string[];
  onRetry?: (jobId: string, placeholderId: string) => void;
  onDismiss?: (placeholderId: string) => void;
  onDelete?: (id: string) => void;
  onUseAsReference?: (record: ResultRecord) => void;
  onEditMask?: (record: ResultRecord) => void;
  onFullscreen?: (record: ResultRecord) => void;
}

function downloadRecord(record: ResultRecord) {
  const anchor = document.createElement('a');
  anchor.href = record.dataUrl;
  anchor.download = buildDownloadName(record.prompt, record.createdAt, imageFileExtension(record.dataUrl, record.outputFormat));
  anchor.click();
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function statusMeta(job: QueueJob): { label: string; icon: typeof Clock; spin: boolean } {
  if (job.status === 'running') return { label: '生成中', icon: Loader2, spin: true };
  if (job.status === 'pending') return { label: job.yourPosition ? `排队中 · 第 ${job.yourPosition} 位` : '排队中', icon: Clock, spin: false };
  if (job.status === 'failed') return { label: '生成失败', icon: AlertCircle, spin: false };
  return { label: '已取消', icon: X, spin: false };
}

function formatElapsed(ms: number) {
  if (!ms) return '';
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

export function ResultStream({ records, jobs, pendingIds = [], onRetry, onDismiss, onDelete, onUseAsReference, onEditMask, onFullscreen }: ResultStreamProps) {
  const completedIds = new Set(records.map((record) => record.id));
  const visibleJobs = jobs.filter((job) => {
    const id = job.clientContext?.placeholderId || job.id;
    return !completedIds.has(id) && job.status !== 'succeeded';
  });
  const knownIds = new Set<string>([...completedIds]);
  visibleJobs.forEach((job) => knownIds.add(job.clientContext?.placeholderId || job.id));
  const pendingOnly = pendingIds.filter((id) => !knownIds.has(id));
  const hasItems = records.length > 0 || visibleJobs.length > 0 || pendingOnly.length > 0;

  return (
    <section className="result-stream" aria-label="生成结果">
      {!hasItems && (
        <div className="empty-state" style={{ gridColumn: '1 / -1', minHeight: 320 }}>
          <ImagePlus className="empty-icon" size={28} aria-hidden="true" />
          <strong>还没有生成结果</strong>
          <span>提交后会显示排队和生成结果</span>
        </div>
      )}

      {pendingOnly.map((id) => (
        <article className="task-card running" key={id}>
          <div className="task-card-figure">
            <div className="task-state">
              <span className="state-icon"><Loader2 className="spin" size={26} aria-hidden="true" /></span>
              <strong>提交中</strong>
              <span className="state-meta">正在加入队列...</span>
            </div>
          </div>
        </article>
      ))}

      {visibleJobs.map((job) => {
        const placeholderId = job.clientContext?.placeholderId || job.id;
        const meta = statusMeta(job);
        const Icon = meta.icon;
        return (
          <article className={`task-card ${job.status === 'canceled' ? 'failed' : job.status}`} key={job.id}>
            <div className="task-card-figure">
              <div className="task-state">
                <span className="state-icon breathe"><Icon className={meta.spin ? 'spin' : ''} size={26} aria-hidden="true" /></span>
                <strong>{meta.label}</strong>
                <span className="state-meta">
                  {job.status === 'running' && <span>已等待 {formatElapsed(job.elapsedMs) || '—'}</span>}
                  {job.status === 'pending' && job.estimatedWaitMs > 0 && (
                    <span>预计还需约 {Math.max(1, Math.round(job.estimatedWaitMs / 60000))} 分钟</span>
                  )}
                  {job.status === 'failed' && <span style={{ color: 'var(--danger)' }}>{job.error || '生成失败'}</span>}
                </span>
                {(job.status === 'failed' || job.status === 'canceled') && (
                  <div className="retry-actions">
                    {job.status === 'failed' && job.canRetry && onRetry && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => onRetry(job.id, placeholderId)}>重试</button>
                    )}
                    {onDismiss && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDismiss(placeholderId)}>关闭</button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="task-card-body">
              <p className="prompt-line" title={job.clientContext?.prompt || '图片任务'}>{job.clientContext?.prompt || '图片任务'}</p>
              {job.status === 'pending' && (
                <div className="action-row">
                  <span />
                  <button type="button" className="link-btn danger" onClick={() => onDismiss?.(placeholderId)}>取消排队</button>
                </div>
              )}
            </div>
          </article>
        );
      })}

      {records.map((record) => (
        <article className="task-card" key={record.id}>
          <div className="task-card-figure">
            <img src={record.dataUrl} alt={record.prompt || '生成结果'} />
            <div className="hover-actions">
              <button type="button" onClick={() => downloadRecord(record)} title="下载图片" aria-label="下载图片"><Download size={16} /></button>
              {onUseAsReference && (
                <button type="button" onClick={() => onUseAsReference(record)} title="设为参考图" aria-label="设为参考图"><ImagePlus size={16} /></button>
              )}
              {onEditMask && (
                <button type="button" onClick={() => onEditMask(record)} title="局部修改" aria-label="局部修改"><Brush size={16} /></button>
              )}
              {onFullscreen && (
                <button type="button" onClick={() => onFullscreen(record)} title="全屏查看" aria-label="全屏查看"><Expand size={16} /></button>
              )}
            </div>
          </div>
          <div className="task-card-body">
            <div className="title-row">
              <strong title={record.prompt || '无提示词'}>{record.prompt || '无提示词'}</strong>
              <time>{formatTime(record.createdAt)}</time>
            </div>
            <div className="meta-chips">
              {record.mode !== 'text' && <span className="chip">{record.mode === 'reference' ? '参考生成' : '局部编辑'}</span>}
              {record.kind === 'series' && <span className="chip">系列</span>}
            </div>
            <div className="action-row">
              <button type="button" className="link-btn" onClick={() => downloadRecord(record)}><Download size={13} aria-hidden="true" />下载</button>
              {onDelete && (
                <button type="button" className="link-btn danger" onClick={() => onDelete(record.id)}><Trash2 size={13} aria-hidden="true" />删除</button>
              )}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
