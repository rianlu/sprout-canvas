import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AdminOverview } from '../../lib/api/admin';
import { adminPanel } from './AdminUI';

const levels = ['bg-surface-container', 'bg-primary/20', 'bg-primary/40', 'bg-primary/65', 'bg-primary'];

export function ActivityHeatmap({ activity }: { activity: AdminOverview['activity'] }) {
  const [selectedDate, setSelectedDate] = useState(activity.endDate);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { days } = activity;
  const leading = new Date(`${activity.startDate}T12:00:00Z`).getUTCDay();
  const weeks = Math.ceil((leading + days.length) / 7);
  const maximum = Math.max(1, ...days.map((day) => day.images + day.texts));
  const total = days.reduce((sum, day) => sum + day.images + day.texts, 0);
  const activeDays = days.filter((day) => day.images + day.texts > 0).length;
  const selected = days.find((day) => day.date === selectedDate) || days[days.length - 1];
  const detail = days.find((day) => day.date === hoverDate) || selected;
  const months = days.flatMap((day, index) => index === 0 || day.date.endsWith('-01') ? [{ column: Math.floor((leading + index) / 7) + 2, label: `${Number(day.date.slice(5, 7))}月` }] : []);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const revealSelected = () => {
      const selected = element.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected || element.clientWidth === 0) return;
      const cell = selected.getBoundingClientRect();
      const viewport = element.getBoundingClientRect();
      if (cell.right > viewport.right - 4) element.scrollLeft += cell.right - viewport.right + 4;
      else if (cell.left < viewport.left + 4) element.scrollLeft += cell.left - viewport.left - 4;
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activity.endDate]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offsets: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1 : event.key in offsets ? Math.max(0, Math.min(days.length - 1, index + offsets[event.key])) : null;
    if (next === null) return;
    event.preventDefault(); setHoverDate(null); setSelectedDate(days[next].date);
    scrollRef.current?.querySelector<HTMLButtonElement>(`[data-activity-date="${days[next].date}"]`)?.focus();
  }
  return <section aria-label="创作活跃度" className={`${adminPanel} p-5 sm:p-6 min-w-0`}>
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div><h2 className="font-headline-sm text-headline-sm">创作活跃度</h2><p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">最近 365 天完成 <span className="text-on-surface font-medium">{total.toLocaleString()}</span> 次创作, 每格代表一天.</p></div>
      <span className="px-3 py-1.5 rounded-lg bg-secondary-container/50 text-on-secondary-container font-meta-sm text-meta-sm">{activeDays} 天活跃</span>
    </div>
    <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain pb-3" onMouseLeave={() => setHoverDate(null)}>
      <div className="grid gap-1 min-w-[740px] p-1" style={{ gridTemplateColumns: `24px repeat(${weeks}, minmax(0, 1fr))`, gridTemplateRows: '18px repeat(7, auto)' }}>
        {months.filter((month, index) => month.column <= weeks && (index !== 0 || !months[1] || months[1].column - month.column >= 3)).map((month) => <span key={month.column} aria-hidden="true" className="font-meta-sm text-[11px] leading-none text-outline" style={{ gridColumn: `${month.column} / span ${Math.min(3, weeks + 2 - month.column)}`, gridRow: 1 }}>{month.label}</span>)}
        {[['一', 3], ['三', 5], ['五', 7]].map(([label, row]) => <span key={label} aria-hidden="true" className="flex items-center text-[11px] text-outline" style={{ gridColumn: 1, gridRow: Number(row) }}>{label}</span>)}
        {days.map((day, index) => {
          const count = day.images + day.texts;
          const level = count === 0 ? 0 : Math.ceil(count / maximum * 4);
          const label = `${day.date}, ${day.images} 次图片生成, ${day.texts} 次文字处理, ${day.points} 灵感点`;
          return <button key={day.date} type="button" data-activity-date={day.date} data-activity-count={count} aria-label={label} aria-pressed={selected.date === day.date} title={label} tabIndex={selected.date === day.date ? 0 : -1}
            className={`aspect-square rounded-[4px] border border-outline-variant/20 outline-none hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-primary ${selected.date === day.date ? 'ring-1 ring-primary ring-offset-2 ring-offset-surface-container-lowest' : ''} ${levels[level]}`}
            style={{ gridColumn: Math.floor((leading + index) / 7) + 2, gridRow: (leading + index) % 7 + 2 }}
            onMouseEnter={() => setHoverDate(day.date)} onFocus={() => setSelectedDate(day.date)} onClick={() => { setSelectedDate(day.date); setHoverDate(null); }} onKeyDown={(event) => navigate(event, index)} />;
        })}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 mt-2">
      <p role="status" aria-live="polite" className="font-meta-sm text-meta-sm text-on-surface-variant leading-relaxed"><span className="font-medium text-on-surface">{detail.date}</span> · {detail.images} 次生图 · {detail.texts} 次文字 · {detail.points.toLocaleString()} 灵感点</p>
      <div aria-label="颜色越深, 已完成创作越多" className="flex items-center gap-1.5 font-meta-sm text-meta-sm text-outline"><span className="mr-1">少</span>{levels.map((level) => <span key={level} aria-hidden="true" className={`w-3 h-3 rounded-[3px] border border-outline-variant/20 ${level}`} />)}<span className="ml-1">多</span></div>
    </div>
    <p className="mt-3 font-meta-sm text-meta-sm text-outline">{activity.startDate} 至 {activity.endDate} · 按北京时间结算日期统计, 可点击日期查看明细.</p>
  </section>;
}
