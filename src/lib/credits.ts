import { useSyncExternalStore } from 'react';
import type { CreditBalance, CreditPrices, CreditQuote } from '../../shared/credits-contract.mjs';

export interface CreditSession { userId: string; accessCodeId: string; accessName: string; canGenerate: boolean; credits: CreditBalance | null; prices: CreditPrices | null }
const empty: CreditSession = { userId: '', accessCodeId: '', accessName: '', canGenerate: false, credits: null, prices: null };
let current: CreditSession = empty;
const listeners = new Set<() => void>();
export function setCreditSession(value: CreditSession | null) {
  const next = value || empty;
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const listener of listeners) listener();
}
export function syncCreditResponse(data: unknown) {
  if (!current.userId || !data || typeof data !== 'object') return;
  const value = data as { credits?: CreditBalance; prices?: CreditPrices };
  if (value.credits && value.credits.accessCodeId !== current.accessCodeId) return;
  if (value.credits || value.prices) setCreditSession({ ...current, credits: value.credits || current.credits, prices: value.prices || current.prices });
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useCredits() { return useSyncExternalStore(subscribe, () => current); }
export function getCreditSnapshot() { return current; }
export function getCreditQuote(): CreditQuote {
  if (!current.userId || !current.prices) throw new Error('请先使用访问码登录');
  if (!current.canGenerate) throw new Error('访问码已停用或重置, 请更换访问码后继续');
  return { accessCodeId: current.accessCodeId, userId: current.userId, version: current.prices.version, unlimited: current.credits?.unlimited ?? false };
}
export function bindCreditQuote(previous: CreditQuote | undefined, quote = getCreditQuote(), refreshPrice = false): CreditQuote {
  if (previous && (previous.accessCodeId !== quote.accessCodeId || previous.userId !== quote.userId)) throw new Error('此任务属于原访问码或原浏览器身份, 请切换回原访问码, 或确认后重新创建任务');
  return previous && !refreshPrice ? previous : quote;
}
export function creditCost(prices: CreditPrices | null, kind: 'image' | 'text', count = 1) { return current.credits?.unlimited ? '无限额度, 不扣减余额' : prices ? `预计 ${prices[kind] * count} 灵感点` : '正在同步灵感点'; }
export function compactPoints(points: number) {
  if (points >= 100_000_000) return `${Math.floor(points / 10_000_000) / 10} 亿`;
  if (points >= 10_000) return `${Math.floor(points / 1000) / 10} 万`;
  return points.toLocaleString();
}
