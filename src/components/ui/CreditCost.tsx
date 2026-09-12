import { useCredits } from '../../lib/credits';

export function CreditCost({ kind = 'image', count = 1, points, unlimited }: { kind?: 'image' | 'text'; count?: number; points?: number; unlimited?: boolean }) {
  const { credits, prices } = useCredits();
  const isUnlimited = unlimited ?? credits?.unlimited ?? false;
  if (isUnlimited) return null;
  const cost = points ?? (prices ? prices[kind] * count : null);
  const label = cost === null ? '正在同步灵感点' : `本次消耗 ${cost} 灵感点`;
  return <span data-credit-cost aria-label={label} title={label} className="inline-flex shrink-0 items-center rounded-full bg-secondary-container text-on-secondary-container px-2 py-0.5 font-meta-sm text-[11px] leading-5 font-medium tabular-nums whitespace-nowrap">{cost === null ? '同步中' : `-${cost.toLocaleString('zh-CN')}点`}</span>;
}
