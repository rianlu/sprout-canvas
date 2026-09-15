import type { QueueDelivery, QueueJob } from '../types/queue';

export function isQueueActive(job: QueueJob): boolean {
  return ['pending', 'running', 'submitting'].includes(job.status) || job.status === 'succeeded' && !job.acknowledgedAt;
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
