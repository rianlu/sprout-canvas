import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { StitchIcon } from '../components/ui/StitchIcon';
import { AdminEmpty, AdminHeading, AdminLoading, adminButton, adminField, adminPanel } from '../components/admin/AdminUI';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { CREDIT_LIMITS, type AccessCodeRecord, type CreditLedgerEntry, type CreditOperation, type CreditPrices } from '../../shared/credits-contract.mjs';
import { listAccessCodes, createAccessCodes, updateAccessCode, deleteAccessCode, resetAccessCode, accessCodeLedger, unresolvedCredits, resolveCredits, getCreditPrices, saveCreditPrices, getAccessCode } from '../lib/api/credits';
import { randomId } from '../lib/random/id';
import { compactPoints } from '../lib/credits';
import { ApiError } from '../lib/api/client';

const button = adminButton;
const field = adminField;
const time = (value: number) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未使用';
const kinds: Record<string, string> = { image: '图片生成', prompt: '提示词优化', series: '分镜拆解', admin: '管理操作' };
const events: Record<string, string> = { create: '初始额度', reserve: '预占', charge: '扣除', refund: '返还', adjust: '调整', unknown: '待核实', enable: '启用', disable: '停用', reset: '重置码', quota: '额度模式', delete: '删除' };
const unlimitedEvents: Record<string, string> = { reserve: '已受理', charge: '已完成', refund: '未扣点', unknown: '待核实' };
type Creation = { requestId: string; note: string; count: number; points: number; unlimited: boolean };
type Manager = { record: AccessCodeRecord; requestId: string; note: string; enabled: boolean; unlimited: boolean; delta: number; reason: string };
type Usage = { entries: CreditLedgerEntry[]; operations: CreditOperation[]; nextCursor: number | null; unresolvedCursor: number | null };
const editRecord = (record: AccessCodeRecord): Manager => ({ record, requestId: randomId(), note: record.note, enabled: record.enabled, unlimited: record.unlimited, delta: 0, reason: '' });

function Dialog({ title, busy, onClose, children, icon = 'lock' }: { title: string; busy: boolean; onClose: () => void; children: ReactNode; icon?: string }) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  useEffect(() => {
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape); };
  }, [busy, onClose]);
  return <div className="fixed inset-0 z-50 !m-0 bg-inverse-surface/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto rounded-3xl bg-surface-container-lowest border border-outline-variant/30 shadow-2xl">
      <div className="sticky top-0 z-10 bg-surface-container-lowest px-5 sm:px-7 py-5 flex items-center justify-between border-b border-outline-variant/30">
        <h2 className="font-headline-sm text-headline-sm flex items-center gap-3"><span className="flex w-9 h-9 items-center justify-center rounded-xl bg-surface-container-low text-primary"><StitchIcon name={icon} size={19} /></span>{title}</h2><button type="button" aria-label="关闭访问码弹窗" disabled={busy} onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-container-low hover:bg-surface-container"><StitchIcon name="close" size={20} /></button>
      </div><div className="p-5 sm:p-7 space-y-5">{children}</div>
    </div>
  </div>;
}
function QuotaInput({ label, value, unlimited, onValueChange, onUnlimitedChange, description, min = 0 }: { label: string; value: number; unlimited: boolean; onValueChange: (value: number) => void; onUnlimitedChange: (value: boolean) => void; description: string; min?: number }) {
  const id = useId();
  return <div className="space-y-2">
    <label htmlFor={id} className="block font-body-sm text-body-sm">{label}</label>
    <div className="flex items-center min-h-12 rounded-xl border border-outline-variant/40 bg-surface-container-low/70 focus-within:border-primary transition-colors">
      <input id={id} aria-describedby={`${id}-hint`} className="w-full min-w-0 flex-1 bg-transparent px-3 py-3 font-body-md text-body-md tabular-nums outline-none focus-visible:!outline-none disabled:text-outline disabled:cursor-not-allowed" type="number" min={min} max={CREDIT_LIMITS.points} step={1} required disabled={unlimited} value={value} onChange={(event) => onValueChange(Number(event.target.value))} />
      <span aria-hidden="true" className="pr-3 font-body-sm text-body-sm text-outline">点</span>
      <label className="relative flex shrink-0 self-stretch items-center gap-2 border-l border-outline-variant/40 px-3 cursor-pointer font-body-sm text-body-sm">
        无限额度<input type="checkbox" role="switch" className="peer absolute right-3 top-1/2 z-10 h-5 w-9 -translate-y-1/2 cursor-pointer opacity-0" checked={unlimited} onChange={(event) => onUnlimitedChange(event.target.checked)} />
        <span aria-hidden="true" className={`flex h-5 w-9 items-center rounded-full p-[3px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 ${unlimited ? 'bg-primary' : 'bg-outline/40'}`}><span className={`h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${unlimited ? 'translate-x-4' : 'translate-x-0'}`} /></span>
      </label>
    </div>
    <p id={`${id}-hint`} className="font-meta-sm text-meta-sm text-on-surface-variant leading-relaxed">{description}</p>
  </div>;
}
function Balance({ record }: { record: AccessCodeRecord }) {
  return <dl className="grid grid-cols-3 gap-2">{[['可用灵感点', record.unlimited ? '无限' : compactPoints(record.available), record.available], [record.unlimited ? '原额度占用' : '占用', compactPoints(record.reserved), record.reserved], ['累计用量', compactPoints(record.spent), record.spent]].map(([label, value, exact]) => <div key={label}><dt className="text-on-surface-variant font-meta-sm text-meta-sm">{label}</dt><dd title={value === '无限' ? '无限额度' : `${exact.toLocaleString()} 点`} className="mt-1 font-headline-sm text-headline-sm tabular-nums">{value}</dd></div>)}</dl>;
}

export function AccessCodeManager({ active, reviewCodeId, onReviewOpened }: { active: boolean; reviewCodeId?: string | null; onReviewOpened?: () => void }) {
  const [codes, setCodes] = useState<AccessCodeRecord[]>([]);
  const [total, setTotal] = useState(0); const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [creation, setCreation] = useState<Creation | null>(null);
  const [manager, setManager] = useState<Manager | null>(null);
  const [managerStale, setManagerStale] = useState(false);
  const [usageRecord, setUsageRecord] = useState<AccessCodeRecord | null>(null);
  const [secrets, setSecrets] = useState<(AccessCodeRecord & { code?: string })[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [danger, setDanger] = useState<{ kind: 'reset' | 'delete'; requestId: string } | null>(null);
  const [prices, setPrices] = useState<CreditPrices | null>(null); const [priceError, setPriceError] = useState('');
  const [priceRequestId, setPriceRequestId] = useState(randomId);
  const lock = useRef(false); const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++sequence.current; setLoading(true);
    try { const result = await listAccessCodes(search, status); if (version === sequence.current) { setCodes(result.codes); setTotal(result.total); setNextCursor(result.nextCursor); } }
    catch (cause) { if (version === sequence.current) setError(cause instanceof Error ? cause.message : '读取访问码失败'); }
    finally { if (version === sequence.current) setLoading(false); }
  }, [search, status]);
  useEffect(() => { if (!active) return; const timer = window.setTimeout(() => void refresh(), 250); return () => { window.clearTimeout(timer); sequence.current++; }; }, [active, refresh]);
  const readPrices = useCallback(async () => {
    setPriceError('');
    try { setPrices((await getCreditPrices()).prices); setPriceRequestId(randomId()); }
    catch (cause) { setPriceError(cause instanceof Error ? cause.message : '点值读取失败'); }
  }, []);
  useEffect(() => { if (active && !prices) void readPrices(); }, [active, prices, readPrices]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败, 请重试');
      if (manager && cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') setManagerStale(true);
    }
    finally { lock.current = false; setBusy(false); }
  }
  function patch(value: Partial<Manager>) { setManager((old) => old && { ...old, ...value }); }
  const close = useCallback(() => { setCreation(null); setManager(null); setManagerStale(false); setSecrets(null); setUsageRecord(null); setUsage(null); setDanger(null); setError(''); setMessage(''); }, []);
  function openRecord(record: AccessCodeRecord) {
    setManager(editRecord(record)); setManagerStale(false); setUsageRecord(null); setUsage(null); setDanger(null);
    void run(async () => { setManager(editRecord((await getAccessCode(record.id)).accessCode)); });
  }
  async function refreshManager() {
    if (!manager) return;
    const latest = (await getAccessCode(manager.record.id)).accessCode;
    setManager((current) => !current || current.record.id !== latest.id ? current : {
      ...current, record: latest, requestId: randomId(),
      note: current.note === current.record.note ? latest.note : current.note,
      enabled: current.enabled === current.record.enabled ? latest.enabled : current.enabled,
      unlimited: current.unlimited === current.record.unlimited ? latest.unlimited : current.unlimited,
    });
    setCodes((current) => current.map((record) => record.id === latest.id ? latest : record));
    setDanger((current) => current && { ...current, requestId: randomId() });
    setManagerStale(false);
    setMessage('数据已刷新, 已保留尚未保存的修改, 请核对后继续');
  }
  function openUsage(record: AccessCodeRecord) {
    setManager(null); setUsageRecord(record); setUsage(null);
    void run(() => loadUsage(record.id));
  }
  function settleUnknown(id: string, decision: 'charge' | 'refund') {
    const codeId = usageRecord?.id;
    if (!codeId) return;
    void run(async () => {
      await resolveCredits(id, { requestId: randomId(), decision });
      await loadUsage(codeId);
      await refresh();
      setMessage('核实结果已保存');
    });
  }
  async function loadUsage(id: string) {
    const results = await Promise.allSettled([accessCodeLedger(id), unresolvedCredits(id), getAccessCode(id)]);
    const failure = results.find((result) => result.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason;
    const [ledger, pending, latest] = results;
    if (ledger.status !== 'fulfilled' || pending.status !== 'fulfilled' || latest.status !== 'fulfilled') return;
    setUsage({ entries: ledger.value.entries, operations: pending.value.operations, nextCursor: ledger.value.nextCursor, unresolvedCursor: pending.value.nextCursor });
    setUsageRecord(latest.value.accessCode);
    setCodes((old) => old.map((record) => record.id === id ? latest.value.accessCode : record));
  }
  useEffect(() => {
    if (!active || !reviewCodeId || busy || lock.current) return;
    onReviewOpened?.();
    setCreation(null); setManager(null); setSecrets(null); setUsageRecord(null); setUsage(null); setDanger(null);
    void run(() => loadUsage(reviewCodeId));
  }, [active, reviewCodeId, onReviewOpened, busy]);
  function saveCreation(event: FormEvent) {
    event.preventDefault(); if (!creation) return; const value = creation;
    void run(async () => {
      const result = await createAccessCodes({ requestId: value.requestId, note: value.note, initialPoints: value.unlimited ? 0 : value.points, count: value.count, unlimited: value.unlimited });
      setCreation(null); setSecrets(result.codes); await refresh();
    });
  }
  function saveManager(event: FormEvent) {
    event.preventDefault(); if (!manager || managerStale) return; const value = manager;
    void run(async () => {
      await updateAccessCode(value.record.id, { requestId: value.requestId, version: value.record.version, note: value.note, enabled: value.enabled, unlimited: value.unlimited, delta: value.unlimited ? 0 : value.delta });
      setManager(null); setUsage(null); setMessage('访问码设置已保存'); await refresh();
    });
  }
  function confirmDanger(event: FormEvent) {
    event.preventDefault(); if (!manager || !danger || managerStale) return; const record = manager.record; const action = danger;
    void run(async () => {
      const input = { requestId: action.requestId, version: record.version };
      if (action.kind === 'reset') { const result = await resetAccessCode(record.id, input); setSecrets([{ ...result.accessCode, code: result.code }]); }
      else { await deleteAccessCode(record.id, input); setMessage('访问码已删除, 旧码已失效'); }
      setManager(null); setDanger(null); setUsage(null); await refresh();
    });
  }
  const feedback = (error || message) && <p role={error ? 'alert' : 'status'} className={`p-3 rounded-xl font-body-sm text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container'}`}>{error || message}</p>;
  return <main className="admin-page space-y-6">
    <AdminHeading icon="lock" eyebrow="访问权限 · 测试额度" title="访问码管理" description="按访问码分配灵感点, 也可以为朋友共享一份额度.">
      <button type="button" disabled={busy || loading} className={`${button} bg-surface-container-low hover:bg-surface-container`} onClick={() => void refresh()}><StitchIcon name="refresh" size={18} />刷新列表</button><button type="button" disabled={busy} className={`${button} bg-primary text-on-primary hover:bg-primary-container`} onClick={() => { setError(''); setMessage(''); setCreation({ requestId: randomId(), note: '', count: 1, points: 100, unlimited: false }); }}><StitchIcon name="add" size={18} />创建访问码</button>
    </AdminHeading>
    {!creation && !secrets && !manager && !usageRecord && feedback}
    <section aria-label="灵感点消耗设置" className={`${adminPanel} p-5 sm:p-6 flex flex-col xl:flex-row xl:items-center justify-between gap-5`}>
      <div className="max-w-sm"><h2 className="font-headline-sm text-headline-sm flex items-center gap-2"><StitchIcon name="spa" size={20} className="text-primary" />灵感点消耗</h2><p className="font-body-sm text-body-sm text-on-surface-variant mt-2">图片生成与文字处理的统一点值.<br />保存后对新任务生效, 已受理任务沿用原点值.</p></div>
      {prices ? <form onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await saveCreditPrices({ ...prices, requestId: priceRequestId }); setPrices(result.prices); setPriceRequestId(randomId()); setMessage('点值已保存, 已受理任务继续沿用原点值'); }); }}><fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
        <label className="font-body-sm text-body-sm flex flex-col gap-2">每张图片<input aria-label="图片灵感点" title="适用于文生图, 参考图生成和蒙版编辑" type="number" required min={1} max={CREDIT_LIMITS.price} step={1} className={`${field} max-w-28`} value={prices.image} onChange={(event) => setPrices({ ...prices, image: Number(event.target.value) })} /></label>
        <label className="font-body-sm text-body-sm flex flex-col gap-2">每次文字处理<input aria-label="文字灵感点" title="适用于提示词优化和分镜拆解" type="number" required min={1} max={CREDIT_LIMITS.price} step={1} className={`${field} max-w-28`} value={prices.text} onChange={(event) => setPrices({ ...prices, text: Number(event.target.value) })} /></label>
        <button type="submit" className={`${button} bg-primary text-on-primary`}>保存点值</button><button type="button" className={`${button} bg-surface-container-low hover:bg-surface-container`} onClick={() => void run(readPrices)}>读取最新点值</button>
      </fieldset></form> : <div className="flex items-center gap-3 text-body-sm text-on-surface-variant"><p role={priceError ? 'alert' : 'status'}>{priceError || '正在读取点值...'}</p>{priceError && <button type="button" className={`${button} bg-surface-container`} onClick={() => void readPrices()}>重新读取点值</button>}</div>}
    </section>
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3"><div className="relative w-full sm:max-w-sm"><StitchIcon name="search" size={18} className="absolute left-3 top-3.5 text-outline" /><input aria-label="搜索访问码" disabled={busy} className={`${field} !pl-10`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称或访问码尾号" /></div><select aria-label="访问码状态筛选" disabled={busy} className={`${field} sm:w-36`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select><span className="sm:ml-auto font-meta-sm text-meta-sm text-on-surface-variant">共 {total} 个访问码</span></div>
    {loading && !codes.length && <AdminLoading label="正在读取访问码..." />}
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">{codes.map((record) => <article key={record.id} className={`relative group p-5 ${adminPanel} hover:border-primary/50 transition-colors space-y-5`}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-body-md text-body-md font-medium break-words line-clamp-2">{record.note || '未命名访问码'}</h2><p className="font-mono text-meta-sm text-on-surface-variant mt-2">sc_••••{record.tail}</p></div><span className={`shrink-0 px-2 py-1 rounded-lg font-meta-sm text-meta-sm ${record.enabled ? 'bg-secondary-container/65 text-on-secondary-container' : 'bg-surface-container-low text-on-surface-variant'}`}>{record.enabled ? '已启用' : '已停用'}</span></div>
      <Balance record={record} />
      <button type="button" aria-label={`管理访问码 ${record.note || record.tail}`} disabled={busy} onClick={() => openRecord(record)} className="absolute inset-0 !m-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" />
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-outline-variant/25"><p className="font-meta-sm text-meta-sm text-outline">最近使用: {time(record.lastUsedAt)}</p><button type="button" aria-label={`用量明细 ${record.note || record.tail}`} title="查看用量明细" disabled={busy} onClick={() => openUsage(record)} className="relative z-10 flex items-center justify-center w-9 h-9 shrink-0 rounded-xl bg-surface-container-low text-secondary hover:bg-secondary-container hover:text-on-secondary-container transition-colors focus-visible:outline-primary"><StitchIcon name="view_timeline" size={19} /></button></div>
    </article>)}</div>
    {!loading && !error && !codes.length && <AdminEmpty icon="lock" title={search || status !== 'all' ? '没有匹配的访问码' : '创建第一份访问额度'} description={search || status !== 'all' ? '试试其他名称或尾号, 也可以调整状态筛选.' : '创建访问码后复制给使用者, 即可开始创作.'} />}
    {nextCursor !== null && <button type="button" disabled={busy} className={`${button} bg-surface-container`} onClick={() => void run(async () => { const version = sequence.current; const result = await listAccessCodes(search, status, nextCursor); if (version === sequence.current) { setCodes((old) => [...old, ...result.codes]); setNextCursor(result.nextCursor); } })}>加载更多访问码</button>}

    {active && creation && <Dialog title="创建访问码" busy={busy} onClose={close}>{feedback}<form onSubmit={saveCreation}><fieldset disabled={busy} className="space-y-4">
      <label className="flex flex-col gap-2 font-body-sm text-body-sm">访问名称(用户可见)<input aria-label="访问名称(用户可见)" className={field} maxLength={CREDIT_LIMITS.note} value={creation.note} onChange={(event) => setCreation({ ...creation, note: event.target.value })} placeholder="例如: 朋友共用, 第一轮测试" /><span className="font-meta-sm text-meta-sm text-on-surface-variant">显示在用户菜单中, 共用此码的人显示相同名称. 留空显示创作者.</span></label>
      <label className="flex flex-col gap-2 font-body-sm text-body-sm">创建数量<input aria-label="创建数量" className={field} type="number" min={1} max={CREDIT_LIMITS.batch} step={1} required value={creation.count} onChange={(event) => setCreation({ ...creation, count: Number(event.target.value) })} /><span className="text-on-surface-variant font-meta-sm text-meta-sm">支持一次创建 1 到 100 个码, 批量名称自动添加序号.</span></label>
      <QuotaInput label="每个码的初始灵感点" value={creation.points} unlimited={creation.unlimited} onValueChange={(points) => setCreation({ ...creation, points })} onUnlimitedChange={(unlimited) => setCreation({ ...creation, unlimited })} description={creation.unlimited ? '无限额度不扣减余额, 仍记录用量. 随时可以改回有限额度.' : '每个访问码独立分配此额度. 打开右侧开关可设为无限额度.'} />
      <div className="flex justify-end"><button type="submit" className={`${button} bg-primary text-on-primary`}>{busy ? '创建中...' : '创建并显示访问码'}</button></div>
    </fieldset></form></Dialog>}

    {active && manager && <Dialog title="管理访问码" busy={busy} onClose={close}>
      <div className="space-y-4 rounded-xl p-4 bg-surface-container-low"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono text-body-sm text-on-surface-variant">sc_••••{manager.record.tail}</p><span className="font-meta-sm text-meta-sm text-on-surface-variant">{manager.record.enabled ? '已启用' : '已停用'}</span></div><Balance record={manager.record} /></div>
      {feedback}
      {managerStale && <button type="button" disabled={busy} className={`${button} bg-surface-container`} onClick={() => void run(refreshManager)}><StitchIcon name="refresh" size={17} />刷新数据</button>}
        <form onSubmit={saveManager}><fieldset disabled={busy || Boolean(danger)} className="space-y-4">
          <label className="flex flex-col gap-2 font-body-sm text-body-sm">访问名称(用户可见)<input aria-label="访问名称(用户可见)" className={field} maxLength={CREDIT_LIMITS.note} value={manager.note} onChange={(event) => patch({ note: event.target.value })} placeholder="例如: 朋友共用, 第一轮测试" /><span className="font-meta-sm text-meta-sm text-on-surface-variant">显示在用户菜单中, 共用此码的人显示相同名称. 留空显示创作者.</span></label>
          <QuotaInput label="调整点数 (正数追加, 负数扣减)" value={manager.delta} min={-CREDIT_LIMITS.points} unlimited={manager.unlimited} onValueChange={(delta) => patch({ delta })} onUnlimitedChange={(unlimited) => patch({ unlimited })} description={manager.unlimited ? `原可用余额 ${manager.record.available.toLocaleString()} 点保留. 新任务不扣减余额, 已受理任务按原规则结算.` : `不调整时保持 0. 保存后可用约 ${(manager.record.available + manager.delta).toLocaleString()} 点, 最终以任务实时结算为准.`} />
          <label className="flex items-center justify-between gap-3 font-body-sm text-body-sm p-3 rounded-xl bg-surface-container-low"><span>允许使用此访问码</span><input type="checkbox" checked={manager.enabled} onChange={(event) => patch({ enabled: event.target.checked })} className="w-4 h-4 accent-primary" /></label>
          {!manager.enabled && manager.record.enabled && <p className="font-meta-sm text-meta-sm text-on-surface-variant">保存后停止新建任务, 未执行的任务会取消并释放占用点数. 已开始的任务正常收尾.</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="submit" disabled={managerStale} className={`${button} bg-primary text-on-primary`}>{busy ? '保存中...' : '保存修改'}</button>
          </div>
        </fieldset></form>
        <section className="pt-4 border-t border-outline-variant/30 space-y-3" aria-label="访问码操作">
          {!danger ? <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || managerStale} className={`${button} bg-surface-container text-on-surface`} onClick={() => { setError(''); setMessage(''); setDanger({ kind: 'reset', requestId: randomId() }); }}><StitchIcon name="refresh" size={17} />重置访问码</button><button type="button" disabled={busy || managerStale} className={`${button} bg-error-container/60 text-on-error-container`} onClick={() => { setError(''); setMessage(''); setDanger({ kind: 'delete', requestId: randomId() }); }}><StitchIcon name="delete_outline" size={17} />删除访问码</button></div> : <form onSubmit={confirmDanger}><fieldset disabled={busy} className="p-4 rounded-xl bg-surface-container-low space-y-3">
            <h3 className="font-body-md text-body-md font-medium">{danger.kind === 'reset' ? '确认重置访问码' : '确认删除访问码'}</h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant">{danger.kind === 'reset' ? '旧码将失效, 原额度与流水保留. 未执行的任务会取消, 已开始的任务正常收尾.' : '删除后旧码立即失效, 从列表移除且无法恢复. 未执行任务会取消, 历史流水保留用于核对. 执行中或待核实的任务需先处理完毕.'}</p>
            <p className="font-meta-sm text-meta-sm text-outline">此操作不会保存上方尚未提交的设置.</p>
            <div className="flex flex-wrap justify-end gap-2"><button type="button" className={`${button} bg-surface-container`} onClick={() => setDanger(null)}>取消操作</button><button type="submit" disabled={managerStale} className={`${button} ${danger.kind === 'delete' ? 'bg-error text-on-error' : 'bg-primary text-on-primary'}`}>{danger.kind === 'reset' ? '确认重置并显示新码' : '确认删除'}</button></div>
          </fieldset></form>}
        </section>
    </Dialog>}

    {active && usageRecord && <Dialog title="用量明细" icon="view_timeline" busy={busy} onClose={close}>
      <div className="space-y-4 rounded-xl p-4 bg-surface-container-low"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-body-md text-body-md font-medium break-words">{usageRecord.note || '未命名访问码'}</p><p className="font-mono text-body-sm text-on-surface-variant">sc_••••{usageRecord.tail}</p></div><Balance record={usageRecord} /></div>
      {feedback}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-meta-sm text-meta-sm text-on-surface-variant">累计用量包含无限额度任务的等值点数, 不代表余额扣减.</p><button type="button" disabled={busy} className={`${button} bg-surface-container`} onClick={() => void run(() => loadUsage(usageRecord.id))}><StitchIcon name="refresh" size={16} />刷新明细</button></div>
        {!usage && <p role="status" className="font-body-sm text-body-sm text-on-surface-variant">{busy ? '正在读取用量...' : '请刷新明细以重新读取用量.'}</p>}
        {usage && <>
          {usage.operations.length > 0 && <section aria-label="待核实任务" className="p-3 rounded-xl border border-outline-variant/40 space-y-3">
            <h3 className="font-body-md text-body-md font-medium">待核实任务</h3><p className="font-meta-sm text-meta-sm text-on-surface-variant">核对上游实际结果后再结算. 无限额度任务仅记录结果, 不扣减余额.</p>
            {usage.operations.map((op) => <div key={op.id} className="flex flex-wrap items-center justify-between gap-2 font-body-sm text-body-sm">
              <span>{kinds[op.kind]} · {op.unlimited ? '无限额度' : `${op.points} 点`} · {time(op.createdAt)}</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy} className={`${button} bg-primary text-on-primary`} onClick={() => settleUnknown(op.id, 'refund')}>返还点数</button>
                <button type="button" disabled={busy} className={`${button} bg-surface-container`} onClick={() => settleUnknown(op.id, 'charge')}>扣除点数</button>
              </div>
            </div>)}
          </section>}
          {usage.unresolvedCursor !== null && <button type="button" disabled={busy} className={`${button} bg-surface-container`} onClick={() => void run(async () => { const result = await unresolvedCredits(usageRecord.id, usage.unresolvedCursor!); setUsage((old) => old && { ...old, operations: [...old.operations, ...result.operations], unresolvedCursor: result.nextCursor }); })}>加载更多待核实任务</button>}
          <ol className="space-y-2">{usage.entries.map((entry) => <li key={entry.id} className="p-3 rounded-xl bg-surface-container-low">
            <div className="flex flex-wrap items-center justify-between gap-2 font-body-sm text-body-sm"><span>{kinds[entry.kind] || entry.kind} · {entry.operationUnlimited ? unlimitedEvents[entry.event] || events[entry.event] : events[entry.event] || entry.event}{entry.operationUnlimited ? ` · 无限额度 (等值 ${entry.operationPoints} 点)` : entry.operationPoints ? ` ${entry.operationPoints} 点` : entry.points ? ` ${entry.points > 0 ? '+' : ''}${entry.points} 点` : ''}</span><span className="text-on-surface-variant">{entry.unlimited ? '无限额度' : `可用 ${entry.available}`} · 占用 {entry.reserved}</span></div>
            <p className="mt-1 font-meta-sm text-meta-sm text-outline">{time(entry.createdAt)}{entry.operationId ? ` · ${entry.operationId.slice(-8)}` : ''}</p>{entry.reason && <p className="mt-1 font-body-sm text-body-sm break-words text-on-surface-variant">{entry.reason}</p>}
          </li>)}</ol>
          {usage.nextCursor !== null && <button type="button" disabled={busy} className={`${button} bg-surface-container`} onClick={() => void run(async () => { const result = await accessCodeLedger(usageRecord.id, usage.nextCursor!); setUsage((old) => old && { ...old, entries: [...old.entries, ...result.entries], nextCursor: result.nextCursor }); })}>加载更早的流水</button>}
        </>}
      </div>
    </Dialog>}

    {active && secrets && <Dialog title="保存访问码" busy={busy} onClose={close}>
      <p className="font-body-sm text-body-sm text-on-surface-variant">完整访问码仅在本次操作显示, 请复制保存. 忘记后可在列表中重置, 额度和流水不会丢失.</p>{feedback}
      {secrets.map((record) => <div key={record.id} className="rounded-xl p-3 bg-surface-container-low space-y-2"><p className="font-body-sm text-body-sm">{record.note || '未命名访问码'} · {record.unlimited ? '无限额度' : `可用 ${record.available} 点`}</p>{record.code ? <div className="flex gap-2"><input aria-label={`完整访问码 ${record.tail}`} readOnly value={record.code} className={`${field} font-mono min-w-0`} /><button type="button" className={`${button} bg-primary text-on-primary shrink-0`} onClick={() => void run(async () => { await navigator.clipboard.writeText(record.code!); setMessage('已复制访问码'); })}>复制</button></div> : <p role="status" className="font-body-sm text-body-sm text-error">该操作已成功, 完整码不再重复返回. 请关闭弹窗后重置尾号 {record.tail} 的访问码.</p>}</div>)}
      {secrets.some((record) => record.code) && <button type="button" className={`${button} bg-primary text-on-primary`} onClick={() => void run(async () => { await navigator.clipboard.writeText(secrets.filter((record) => record.code).map((record) => `${record.note || '访问码'}: ${record.code}`).join('\n')); setMessage('已复制全部访问码'); })}>复制全部</button>}
    </Dialog>}
  </main>;
}
