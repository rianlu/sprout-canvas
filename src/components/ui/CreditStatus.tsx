import type { CreditCharge } from '../../../shared/credits-contract.mjs';

export function CreditStatus({ credit, pending = false }: { credit?: CreditCharge | null; pending?: boolean }) {
  if (!credit) return null;
  if (credit.unlimited) {
    const state = pending ? '结算待同步' : { reserved: '等待执行', running: '处理中', charged: '已完成', refunded: '未扣点' }[credit.state];
    return <span className={`font-meta-sm text-meta-sm ${pending ? 'text-error' : 'text-on-surface-variant'}`}>无限额度 · {state}</span>;
  }
  const label = pending ? '结算待同步' : { reserved: '已预占', running: '已预占', charged: '已扣除', refunded: '已返还' }[credit.state];
  return <span className={`font-meta-sm text-meta-sm ${pending ? 'text-error' : 'text-on-surface-variant'}`}>{label} {credit.points} 灵感点</span>;
}
