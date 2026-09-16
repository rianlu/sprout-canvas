import type { QueueActivity } from '../../types/queue';
import { StitchIcon } from '../ui/StitchIcon';

export function QueueSummary({ activity }: { activity: QueueActivity }) {
  const loading = activity.connection === 'loading';
  const stale = activity.connection === 'stale';
  const busy = activity.globalActive > 0 || activity.globalQueued > 0;
  return (
    <aside aria-label="全站生图状态" className="rounded-xl border border-outline-variant/25 bg-surface-container-low/70 px-space-md py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-meta-sm text-meta-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-on-surface"><StitchIcon name="layers" size={17} />全站生图{stale ? ' · 上次状态' : ''}</span>
        {loading ? <span className="text-on-surface-variant">正在同步队列...</span> : <>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-primary"><span className={`h-1.5 w-1.5 rounded-full ${activity.globalActive ? 'bg-primary' : 'bg-outline/50'}`} /><strong className="font-semibold tabular-nums">{activity.globalActive}</strong>张生成中</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-2.5 py-1 text-on-surface-variant"><strong className="font-semibold tabular-nums">{activity.globalQueued}</strong>张等待</span>
        </>}
      </div>
      <p className="mt-2 font-meta-sm text-meta-sm text-on-surface-variant leading-relaxed">{stale ? '队列状态暂未更新, 正在重新连接.' : loading ? '正在读取全站任务数量.' : busy ? '等待数包含你的任务. 按创作者轮流绘制, 轮到后自动开始.' : '当前没有生图任务, 可以开始新的创作.'}</p>
    </aside>
  );
}
