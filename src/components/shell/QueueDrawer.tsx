import { useEffect } from 'react';
import { CircleAlert, CircleCheck, Info, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { QueueJob } from '../../types/queue';

export interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
  jobs: QueueJob[];
  onCancelJob: (jobId: string) => void;
  onRetryJob: (jobId: string) => void;
}

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `已渲染 ${seconds} 秒`;
  return `已渲染 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function jobTitle(job: QueueJob): string {
  const prompt = job.clientContext?.prompt;
  return prompt && prompt.length > 0 ? (prompt.length > 30 ? prompt.slice(0, 30) + '…' : prompt) : '生成任务';
}

function statusLabel(job: QueueJob): { title: string; meta: string; icon: 'running' | 'queued' | 'failed' | 'succeeded' } {
  if (job.status === 'failed') return { title: jobTitle(job), meta: '生成失败 · 可换服务商重试', icon: 'failed' };
  if (job.status === 'running') return { title: jobTitle(job), meta: `${formatElapsed(job.elapsedMs)} · 渲染中`, icon: 'running' };
  if (job.status === 'succeeded') return { title: jobTitle(job), meta: '已完成', icon: 'succeeded' };
  if (job.status === 'canceled') return { title: jobTitle(job), meta: '已取消', icon: 'succeeded' };
  return { title: jobTitle(job), meta: `排队中 · 第 ${job.yourPosition} 位`, icon: 'queued' };
}

/**
 * 右侧任务队列抽屉. DOM 照搬 Stitch 单图稿 #queue-drawer (类名原样).
 * 假进度百分比/剩余秒数按 PRD §7.1 剔除, 显示真实已等待时长与位次.
 */
export function QueueDrawer({ open, onClose, jobs, onCancelJob, onRetryJob }: QueueDrawerProps) {
  const activeCount = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;
  const runningLabel = activeCount > 0 ? `${activeCount} 运行中` : '空闲';

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className={`fixed top-16 right-0 bottom-0 w-sidebar-width bg-surface-bright/95 backdrop-blur-2xl shadow-[-8px_0_32px_rgba(85,95,75,0.08)] z-50 transform transition-transform duration-300 ease-out flex flex-col ${open ? '' : 'translate-x-full'}`}
      id="queue-drawer"
      role="dialog"
      aria-label="任务队列"
    >
      {/* 头部 */}
      <div className="p-space-lg flex items-center justify-between bg-surface-container-low/60">
        <div className="flex items-center gap-space-xs">
          <LoaderCircle className="text-primary" size={20} aria-hidden />
          <span className="font-headline-sm text-headline-sm text-on-surface">绘绘任务</span>
          <span className="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-meta-sm text-meta-sm">{runningLabel}</span>
        </div>
        <button
          type="button"
          className="w-7 h-7 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors"
          onClick={onClose}
          aria-label="关闭队列抽屉"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto p-space-lg space-y-space-md">
        {jobs.length === 0 && (
          <div className="text-center py-space-xl text-on-surface-variant font-body-sm text-body-sm">
            当前没有进行中的任务
          </div>
        )}
        {jobs.map((job) => {
          const { title, meta, icon } = statusLabel(job);
          return (
            <div key={job.id} className="p-space-md rounded-xl bg-surface-container-lowest shadow-[0_2px_12px_rgba(85,95,75,0.04)]">
              <div className="flex items-start justify-between gap-space-xs mb-space-xs">
                <div className="flex-1 min-w-0">
                  <h4 className="font-body-sm text-body-sm font-medium text-on-surface truncate">{title}</h4>
                  <p className="font-meta-sm text-meta-sm text-on-surface-variant truncate">{meta}</p>
                </div>
                {icon === 'running' && <LoaderCircle className="text-primary animate-spin" size={18} aria-hidden />}
                {icon === 'queued' && <CircleCheck className="text-on-surface-variant" size={18} aria-hidden />}
                {icon === 'failed' && <CircleAlert className="text-error" size={18} aria-hidden />}
              </div>
              {/* 呼吸进度条: running 时有 shimmer (无假百分比) */}
              <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mb-space-xs">
                {job.status === 'running' && <div className="h-full w-1/3 bg-primary rounded-full animate-pulse" />}
                {job.status === 'pending' && <div className="h-full w-0 bg-secondary-fixed rounded-full" />}
                {job.status === 'succeeded' && <div className="h-full w-full bg-primary rounded-full" />}
              </div>
              <div className="flex justify-between items-center text-on-surface-variant">
                <span className="font-meta-sm text-meta-sm">{job.status === 'running' || job.status === 'pending' ? '单任务通道 · 按序渲染' : ''}</span>
                {job.status === 'running' || job.status === 'pending' ? (
                  <button type="button" className="font-meta-sm text-meta-sm hover:text-error transition-colors" onClick={() => onCancelJob(job.id)}>取消</button>
                ) : job.status === 'failed' ? (
                  <button type="button" className="font-meta-sm text-meta-sm hover:text-primary transition-colors flex items-center gap-0.5" onClick={() => onRetryJob(job.id)}>
                    <RefreshCw size={12} aria-hidden /> 重试
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部 (稿内「清空已完成」无对应后端能力, 按 PRD §7.1 剔除, 保留文案栏) */}
      <div className="p-space-md bg-surface-container-low/60 flex items-center justify-center text-on-surface-variant">
        <span className="font-meta-sm text-meta-sm">草木生息 · 持续守护</span>
      </div>
    </div>
  );
}

/**
 * 全局 toast 栈. DOM 照搬 Stitch #toast-container (fixed bottom center, 逐条浮出).
 */
export function ToastStack({ toasts }: { toasts: { id: string; type: 'info' | 'success' | 'error'; message: string }[] }) {
  return (
    <div className="fixed bottom-space-lg left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-space-xs" id="toast-container">
      {toasts.map((toast) => {
        const Icon = toast.type === 'error' ? CircleAlert : toast.type === 'success' ? CircleCheck : Info;
        return (
          <div
            key={toast.id}
            className="pointer-events-auto px-space-md py-space-xs rounded-full bg-inverse-surface/90 text-inverse-on-surface backdrop-blur-md shadow-[0_12px_36px_rgba(85,95,75,0.15)] flex items-center gap-2"
            role={toast.type === 'error' ? 'alert' : 'status'}
          >
            <Icon className={toast.type === 'error' ? 'text-error' : 'text-primary-fixed-dim'} size={16} aria-hidden />
            <span className="font-body-sm text-body-sm">{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}

