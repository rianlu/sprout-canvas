import type { QueueDelivery, QueueJob } from '../types/queue';

export type QueueTiming = Pick<QueueJob, 'id' | 'status' | 'queuedAt' | 'startedAt' | 'finishedAt' | 'serverNow' | 'receivedAt'>;

export function queueElapsedMs(job: QueueTiming, now: number): number {
  const start = job.status === 'pending' ? job.queuedAt : job.startedAt;
  if (!start) return 0;
  const live = job.status === 'pending' || job.status === 'running';
  const elapsedSinceReceipt = live && job.receivedAt !== undefined ? Math.max(0, now - job.receivedAt) : 0;
  return Math.max(0, (job.finishedAt || job.serverNow) - start) + elapsedSinceReceipt;
}

export function formatQueueDuration(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
  return `${Math.floor(seconds / 3600)} 时 ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
}

export function personalQueuePosition(position: number): string {
  return position > 0 ? `我的待生成第 ${position} 张` : '已加入我的待生成';
}

export function isQueueActive(job: QueueJob): boolean {
  return ['pending', 'running', 'submitting'].includes(job.status) || job.status === 'succeeded' && !job.acknowledgedAt;
}

export function canDismissQueueJob(job: QueueJob): boolean {
  if (isQueueActive(job) || job.status === 'unsubmitted' || job.interruptionReason === 'pending-restart') return false;
  return true;
}

export function deliveryMessage(delivery?: QueueDelivery): { title: string; detail: string } {
  if (!delivery) return { title: '等待领取作品', detail: '图片已生成, 等待接收原图' };
  if (delivery?.phase === 'error') return {
    title: delivery.failedPhase === 'confirming' ? '领取确认待重试' : '作品领取待重试',
    detail: delivery.error || '领取暂未完成, 可重新领取',
  };
  if (delivery?.phase === 'saving') return { title: '正在保存作品', detail: '正在写入本地展馆, 请稍候' };
  if (delivery?.phase === 'confirming') return { title: '正在确认领取', detail: '作品已保存, 正在确认领取状态' };
  return { title: '正在下载原图', detail: '图片已生成, 正在接收原图' };
}
