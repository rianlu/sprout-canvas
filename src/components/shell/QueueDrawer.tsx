import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, LoaderCircle, RefreshCw, X } from '../ui/icons';
import { StitchIcon } from '../ui/StitchIcon';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { QueueActivity, QueueJob } from '../../types/queue';
import { CreditStatus } from '../ui/CreditStatus';
import { CreditCost } from '../ui/CreditCost';
import { deliveryMessage, isQueueActive, personalQueuePosition } from '../../lib/queue-presentation';
import { QueueElapsed } from '../queue/QueueElapsed';
import { QueueSummary } from '../queue/QueueSummary';

export interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
  jobs: QueueJob[];
  activity: QueueActivity;
  onCancelJob: (jobId: string) => Promise<void>;
  onRetryJob: (jobId: string) => Promise<unknown>;
  onPrioritizeJob: (jobId: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  hasMore: boolean;
  loadingHistory: boolean;
}

function jobTitle(job: QueueJob): string {
  const prompt = job.clientContext?.prompt;
  return prompt && prompt.length > 0 ? (prompt.length > 30 ? prompt.slice(0, 30) + '…' : prompt) : '生成任务';
}

function statusLabel(job: QueueJob, open: boolean): {
  title: string;
  meta: ReactNode;
  icon: 'running' | 'queued' | 'failed' | 'succeeded';
} {
  if (job.supersededBy) return { title: jobTitle(job), meta: '已重新提交', icon: 'failed' };
  if (job.status === 'failed') return { title: jobTitle(job), meta: '生成失败 · 可换服务商重试', icon: 'failed' };
  if (job.status === 'interrupted') return { title: jobTitle(job), meta: job.outcomeUnknown ? '结果未知 · 需手动处理' : '等待恢复排队', icon: 'failed' };
  if (job.status === 'expired') return { title: jobTitle(job), meta: '临时结果已过期', icon: 'failed' };
  if (job.status === 'submitting') return { title: jobTitle(job), meta: '正在提交 · 等待确认', icon: 'running' };
  if (job.status === 'unsubmitted') return { title: jobTitle(job), meta: '提交待确认 · 可继续提交', icon: 'queued' };
  if (job.status === 'running')
    return { title: jobTitle(job), meta: <><QueueElapsed job={job} enabled={open} /> · 渲染中</>, icon: 'running' };
  if (job.status === 'succeeded') return job.acknowledgedAt && !job.delivery
    ? { title: jobTitle(job), meta: '已完成', icon: 'succeeded' }
    : { title: jobTitle(job), meta: deliveryMessage(job.delivery).title, icon: job.delivery?.phase === 'error' ? 'failed' : job.delivery ? 'running' : 'queued' };
  if (job.status === 'canceled') return { title: jobTitle(job), meta: '已取消', icon: 'succeeded' };
  return { title: jobTitle(job), meta: <>{personalQueuePosition(job.yourPosition)}<span className="block mt-1"><QueueElapsed job={job} enabled={open} /></span></>, icon: 'queued' };
}

/**
 * 保持右侧任务抽屉布局, 使用状态图标, 真实耗时与个人顺序.
 * 无实时进度时不显示比例条, 按 PRD §7.1 区分等待与实际处理状态.
 */
export function QueueDrawer({ open, onClose, jobs, activity, onCancelJob, onRetryJob, onPrioritizeJob, onArchive, onLoadMore, hasMore, loadingHistory }: QueueDrawerProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  const [error, setError] = useState('');
  const visibleJobs = [...jobs].sort((a, b) => {
    if (a.status === 'running') return -1;
    if (b.status === 'running') return 1;
    if (a.status === 'pending' && b.status === 'pending') return a.yourPosition - b.yourPosition;
    if (a.status === 'pending') return -1;
    if (b.status === 'pending') return 1;
    return b.queuedAt - a.queuedAt;
  });
  const activeCount = jobs.filter((job) => isQueueActive(job) || job.status === 'unsubmitted').length;
  const runningLabel = activeCount > 0 ? `${activeCount} 项待完成` : '暂无待办';

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />}
      <div
        ref={dialogRef}
        className={`stitch-queue fixed top-16 right-0 bottom-0 w-sidebar-width max-w-full bg-surface-bright/95 backdrop-blur-2xl shadow-[-8px_0_32px_rgba(85,95,75,0.08)] z-50 transform transition-transform duration-300 ease-out flex flex-col ${open ? '' : 'translate-x-full invisible'}`}
        id="queue-drawer"
        role="dialog"
        aria-label="任务队列"
        aria-modal={open}
        aria-hidden={!open}
        inert={!open}
      >
        {/* 头部 */}
        <div className="p-space-lg flex items-center justify-between bg-surface-container-low/60">
          <div className="flex items-center gap-space-xs">
            <StitchIcon name="layers" className="text-primary" size={20} />
            <span className="font-headline-sm text-headline-sm text-on-surface">我的任务</span>
            <span className="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-meta-sm text-meta-sm">
              {runningLabel}
            </span>
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
          <QueueSummary activity={activity} />
          <p className="font-meta-sm text-meta-sm text-on-surface-variant">以下仅展示我的任务. 置顶只调整自己的待生成顺序.</p>
          {error && (
            <p role="alert" className="text-error text-xs">
              {error}
            </p>
          )}
          {visibleJobs.length === 0 && (
            <div className="text-center py-space-xl text-on-surface-variant font-body-sm text-body-sm">
              当前没有进行中的任务
            </div>
          )}
          {visibleJobs.map((job) => {
            const { title, meta, icon } = statusLabel(job, open);
            return (
              <div
                key={job.id}
                className="p-space-md rounded-xl bg-surface-container-lowest shadow-[0_2px_12px_rgba(85,95,75,0.04)]"
              >
                <div className="flex items-start justify-between gap-space-xs mb-space-xs">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-body-sm text-body-sm font-medium text-on-surface truncate">{title}</h4>
                    <p className="font-meta-sm text-meta-sm text-on-surface-variant truncate">{meta}</p>
                    <CreditStatus credit={job.credit} pending={job.settlementPending} />
                  </div>
                  {icon === 'running' && <LoaderCircle className="text-primary motion-safe:animate-spin" size={18} aria-hidden />}
                  {icon === 'queued' && <StitchIcon name="schedule" className="text-on-surface-variant" size={18} />}
                  {icon === 'succeeded' && <CircleCheck className="text-primary" size={18} aria-hidden />}
                  {icon === 'failed' && <CircleAlert className="text-error" size={18} aria-hidden />}
                </div>
                {(job.delivery?.error || job.error) && <p className={`font-meta-sm text-meta-sm mb-space-xs break-words ${job.status === 'unsubmitted' ? 'text-on-surface-variant' : 'text-error'}`}>{job.delivery?.error || job.error}</p>}
                <div className="flex flex-wrap gap-2 justify-between items-center text-on-surface-variant">
                  <span className="font-meta-sm text-meta-sm">
                    {job.status === 'pending' ? '轮到后自动开始' : job.status === 'running' ? '正在绘制本张' : ''}
                  </span>
                  {job.status === 'pending' || job.status === 'unsubmitted' ? (
                    <div className="flex gap-3">
                      {job.status === 'pending' && <button
                        type="button"
                        title="置顶到自己的待执行队列, 不影响其他用户"
                        className="font-meta-sm text-meta-sm hover:text-primary"
                        onClick={() => { setError(''); void onPrioritizeJob(job.id).catch((cause) => setError(cause.message)); }}
                      >
                        置顶
                      </button>}
                      {job.status === 'unsubmitted' && <button type="button" className="inline-flex items-center gap-1.5 font-meta-sm text-meta-sm text-primary" onClick={() => { void onRetryJob(job.id).catch((cause) => setError(cause.message)); }}>继续提交<CreditCost /></button>}
                      {job.status === 'pending' && <button
                        type="button"
                        className="font-meta-sm text-meta-sm hover:text-error transition-colors"
                        onClick={() => {
                          setError('');
                          void onCancelJob(job.id).catch(() => setError('取消失败, 任务可能已经开始'));
                        }}
                      >
                        取消
                      </button>}
                    </div>
                  ) : job.status === 'submitting' ? (
                    <span className="font-meta-sm text-meta-sm text-outline">提交中</span>
                  ) : job.status === 'succeeded' && job.delivery?.phase === 'error' ? (
                    <button type="button" className="font-meta-sm text-meta-sm text-primary flex items-center gap-1" onClick={() => { setError(''); void onRetryJob(job.id).catch((cause) => setError(cause.message)); }}><RefreshCw size={12} aria-hidden />重试领取</button>
                  ) : job.status === 'running' ? (
                    <span title="请求已发往上游, 无法撤回" className="font-meta-sm text-meta-sm text-outline">生成中</span>
                  ) : job.supersededBy ? (
                    <span className="font-meta-sm text-meta-sm text-on-surface-variant">历史记录</span>
                  ) : ['failed', 'expired', 'interrupted'].includes(job.status) ? (
                    <button
                      type="button"
                      disabled={!job.canRetry}
                      className="font-meta-sm text-meta-sm hover:text-primary transition-colors flex items-center gap-0.5 disabled:opacity-50"
                      onClick={() => {
                        setError('');
                        void onRetryJob(job.id).catch((cause) => setError(cause instanceof Error ? cause.message : '重试失败'));
                      }}
                    >
                      <RefreshCw size={12} aria-hidden /> {job.interruptionReason === 'pending-restart' ? '恢复排队' : '重新生成'}
                      <CreditCost points={job.interruptionReason === 'pending-restart' ? job.credit?.points : undefined} unlimited={job.interruptionReason === 'pending-restart' ? job.credit?.unlimited : undefined} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {hasMore && <button type="button" className="w-full py-2 rounded-xl bg-surface-container text-primary text-body-sm disabled:opacity-50" disabled={loadingHistory} onClick={() => void onLoadMore().catch(() => setError('历史任务读取失败, 请重试'))}>{loadingHistory ? '读取中...' : '加载更早的任务'}</button>}
        </div>

        <div className="p-space-md bg-surface-container-low/60 flex items-center justify-between text-on-surface-variant">
          <span className="font-meta-sm text-meta-sm">草木生息 · 持续守护</span>
          <button
            type="button"
            className="font-meta-sm text-meta-sm text-primary hover:underline disabled:opacity-40"
            title="收起已保存和已取消的任务"
            disabled={!visibleJobs.some((job) => job.status === 'succeeded' && job.acknowledgedAt || job.status === 'canceled')}
            onClick={() => { setError(''); void onArchive().catch(() => setError('清空失败, 请重试')); }}
          >
            清空已完成
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * 全局 toast 栈. DOM 照搬 Stitch #toast-container (fixed bottom center, 逐条浮出).
 */
export function ToastStack({
  toasts,
}: {
  toasts: { id: string; type: 'info' | 'success' | 'error'; message: string }[];
}) {
  return (
    <div
      className="fixed bottom-space-lg left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-space-xs max-w-[calc(100vw-2rem)] pointer-events-none"
      id="toast-container"
    >
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
