import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminEmpty, AdminHeading, AdminLoading, adminButton, adminPanel } from '../components/admin/AdminUI';
import { StitchIcon } from '../components/ui/StitchIcon';
import { getAdminOverview, type AdminOverview } from '../lib/api/admin';
import { compactPoints } from '../lib/credits';
import { ActivityHeatmap } from '../components/admin/ActivityHeatmap';

type Period = 'today' | 'month' | 'all';
const periods: { value: Period; label: string }[] = [{ value: 'today', label: '今日' }, { value: 'month', label: '本月' }, { value: 'all', label: '累计' }];
function PeriodSwitch({ label, value, onChange }: { label: string; value: Period; onChange: (value: Period) => void }) {
  return <div role="group" aria-label={label} className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-surface-container-low p-0.5">
    {periods.map((period) => <button key={period.value} type="button" aria-pressed={value === period.value} onClick={() => onChange(period.value)} className={`min-h-7 rounded-md px-2 font-meta-sm text-meta-sm transition-colors ${value === period.value ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>{period.label}</button>)}
  </div>;
}
const usageFor = (overview: AdminOverview, period: Period) => period === 'all' ? overview.usage : overview.usagePeriods[period];

export function AdminDashboard({ active, onNavigate, onEditStyle }: { active: boolean; onNavigate: (page: 'styles' | 'access') => void; onEditStyle: (styleId: string) => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pointsPeriod, setPointsPeriod] = useState<Period>('month');
  const [creationPeriod, setCreationPeriod] = useState<Period>('month');
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    try { const data = await getAdminOverview(); if (current === sequence.current) { setOverview(data); setError(''); } }
    catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : '概览读取失败'); }
    finally { if (current === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(visible, 30000);
    window.addEventListener('focus', visible);
    return () => { sequence.current++; window.clearInterval(timer); window.removeEventListener('focus', visible); };
  }, [active, refresh]);
  const stats = overview && [
    { label: '风格素材', value: overview.styles.total, unit: '款', description: `${overview.styles.published} 款已上架 · ${overview.styles.hidden} 款未上架`, icon: 'palette' },
    { label: '已启用访问码', value: overview.accessCodes.enabled, unit: '个', description: `共 ${overview.accessCodes.total} 个 · ${overview.accessCodes.disabled} 个已停用`, icon: 'lock' },
    { label: '灵感点用量', value: usageFor(overview, pointsPeriod).points, unit: '点', description: `${periods.find((period) => period.value === pointsPeriod)!.label}已结算, 包含无限额度用量`, icon: 'spa', period: true },
  ];
  const usage = overview && usageFor(overview, creationPeriod);
  return <main className="admin-page space-y-6">
    <AdminHeading icon="grid_view" eyebrow="管理空间 · 工作台概览" title="仪表盘" description="风格素材, 访问额度与创作使用情况, 在这里一目了然.">
      <button type="button" disabled={loading} className={`${adminButton} bg-surface-container-low hover:bg-surface-container`} onClick={() => void refresh()}><StitchIcon name="refresh" size={18} />{loading ? '刷新中...' : '刷新概览'}</button>
    </AdminHeading>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-error-container text-on-error-container"><span>{error}{overview && '. 当前显示上次读取的数据.'}</span><button type="button" disabled={loading} className="underline" onClick={() => void refresh()}>重新读取概览</button></div>}
    {!overview && loading && <AdminLoading label="正在读取管理概览..." />}
    {overview && <>
      <section aria-label="后台概览统计" className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">{stats!.map((stat) => <div key={stat.label} role="group" aria-label={stat.label} className={`${adminPanel} p-4 sm:p-5 ${stat.period ? 'col-span-2 lg:col-span-1' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-body-sm text-body-sm text-on-surface-variant">{stat.label}</p>{stat.period ? <PeriodSwitch label="灵感点统计时段" value={pointsPeriod} onChange={setPointsPeriod} /> : <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-surface-container-low text-primary"><StitchIcon name={stat.icon} size={18} /></span>}</div>
        <p title={stat.value.toLocaleString()} className="mt-4 mb-2 flex items-baseline gap-2"><strong className="font-headline-lg text-headline-lg tabular-nums">{compactPoints(stat.value)}</strong><span className="font-body-sm text-body-sm text-on-surface-variant">{stat.unit}</span></p>
        <p className="font-meta-sm text-meta-sm text-on-surface-variant leading-relaxed">{stat.description}</p>
      </div>)}</section>
      <ActivityHeatmap activity={overview.activity} />
      <section aria-label="创作使用概览" className={`${adminPanel} p-5 sm:p-6 flex flex-col`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-headline-sm text-headline-sm">创作使用</h2><PeriodSwitch label="创作统计时段" value={creationPeriod} onChange={setCreationPeriod} /></div>
        <div className="grid grid-cols-2 gap-5 py-6">
          {[{ label: '图片生成', icon: 'image', count: usage!.images, unit: '次', points: usage!.imagePoints }, { label: '文字处理', icon: 'edit_note', count: usage!.texts, unit: '次', points: usage!.textPoints }].map((item) => <div key={item.label}>
            <p className="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant"><StitchIcon name={item.icon} size={17} />{item.label}</p>
            <p className="mt-3 mb-2"><strong className="font-headline-lg text-headline-lg tabular-nums" title={item.count.toLocaleString()}>{compactPoints(item.count)}</strong><span className="ml-2 text-body-sm text-on-surface-variant">{item.unit}</span></p>
            <p className="font-meta-sm text-meta-sm text-secondary">等值 {item.points.toLocaleString()} 灵感点</p>
          </div>)}
        </div>
        <div className="mt-auto pt-4 border-t border-outline-variant/30 flex flex-wrap items-center justify-between gap-3">
          <p className="font-meta-sm text-meta-sm text-on-surface-variant">实际扣减 {usage!.deducted.toLocaleString()} 点 · 无限额度用量 {(usage!.points - usage!.deducted).toLocaleString()} 点</p>
          <button type="button" className="inline-flex items-center gap-1 text-primary font-body-sm text-body-sm hover:underline" onClick={() => onNavigate('access')}>管理访问额度<StitchIcon name="arrow_forward" size={16} /></button>
        </div>
      </section>
      <section aria-label="最近更新的风格" className={`${adminPanel} p-5 sm:p-6`}>
        <div className="flex items-center justify-between gap-3 mb-5"><div><h2 className="font-headline-sm text-headline-sm">最近整理的风格</h2><p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">最近新增或更新的图片与提示词.</p></div><button type="button" className="inline-flex items-center gap-1 shrink-0 font-body-sm text-body-sm text-primary hover:underline" onClick={() => onNavigate('styles')}>整理风格库<StitchIcon name="arrow_forward" size={16} /></button></div>
        {overview.styles.recent.length ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{overview.styles.recent.map((style) => <button type="button" key={style.id} aria-label={`编辑最近风格 ${style.name}`} className="group text-left min-w-0 rounded-xl" onClick={() => onEditStyle(style.id)}>
          <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-surface-container-low"><img src={style.image} alt={style.name} className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" /><span className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-surface-bright/95 font-meta-sm text-meta-sm text-secondary">{style.published ? '已上架' : '未上架'}</span></div>
          <p className="mt-3 font-body-md text-body-md font-medium truncate">{style.name}</p><p className="mt-1 font-meta-sm text-meta-sm text-on-surface-variant truncate">{style.author || '未注明作者'}</p>
        </button>)}</div> : <AdminEmpty icon="palette" title="从第一份风格开始" description="添加图片与提示词后, 就能在这里查看最近整理的素材." />}
      </section>
      <p className="font-meta-sm text-meta-sm text-outline text-right">更新于 {new Date(overview.updatedAt).toLocaleTimeString('zh-CN', { hour12: false, timeZone: overview.activity.timeZone })} · 北京时间 · 包含已删除访问码的历史用量</p>
    </>}
  </main>;
}
