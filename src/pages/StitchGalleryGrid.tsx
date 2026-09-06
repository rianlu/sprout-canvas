import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Brush, BookOpenText, ChevronLeft, ChevronRight, Copy, Download, Images, Palette,
  Search, Sparkles, Trash2, X, ZoomIn,
} from 'lucide-react';
import type { ResultRecord } from '../types/generation';
import { imageFileExtension } from '../lib/image/format';
import { downloadZip } from '../lib/image/zip';
import { randomId } from '../lib/random/id';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ToastStack } from '../components/shell/QueueDrawer';

/* ============ 展馆 (照搬 Stitch 展馆稿, 类名原样) ============ */

interface GalleryProps {
  records: ResultRecord[];
  onClear: () => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onUseAsRef: (record: ResultRecord) => void;
}

type TypeFilter = 'all' | 'studio' | 'storyboard';
type SortMode = 'newest' | 'oldest';

/** 系列聚合视图: seriesId 分组 → 叠层卡 */
interface SeriesCard {
  kind: 'series';
  seriesId: string;
  masterPrompt: string;
  records: ResultRecord[];
  latestAt: number;
}

interface SingleCard {
  kind: 'single';
  record: ResultRecord;
}

type GalleryCard = SeriesCard | SingleCard;

function downloadRecord(record: ResultRecord, suffix = '') {
  const ext = imageFileExtension(record.dataUrl, record.outputFormat);
  const link = document.createElement('a');
  link.href = record.dataUrl;
  link.download = `sprout-${record.id.slice(-6)}${suffix}.${ext}`;
  link.click();
}

function timeGroup(timestamp: number): 'today' | 'week' | 'earlier' {
  const day = 86_400_000;
  const diff = Date.now() - timestamp;
  if (diff < day) return 'today';
  if (diff < day * 7) return 'week';
  return 'earlier';
}

const GROUP_LABEL: Record<string, string> = { today: '今日作品', week: '近7天', earlier: '往期作品' };
const GROUP_ORDER: Array<'today' | 'week' | 'earlier'> = ['today', 'week', 'earlier'];

export function GalleryGrid({ records, onClear, onDelete, onUseAsRef }: GalleryProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<{ card: GalleryCard; index: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'error'; message: string }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const pushToast = useCallback((type: 'info' | 'success' | 'error', message: string) => {
    const id = randomId();
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200);
  }, []);

  // ⌘K 聚焦
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 聚合: seriesId 分组
  const cards = useMemo<GalleryCard[]>(() => {
    const seriesMap = new Map<string, ResultRecord[]>();
    const singles: ResultRecord[] = [];
    for (const record of records) {
      if (record.kind === 'series' && record.seriesId) {
        const list = seriesMap.get(record.seriesId) ?? [];
        list.push(record);
        seriesMap.set(record.seriesId, list);
      } else {
        singles.push(record);
      }
    }
    const out: GalleryCard[] = [];
    for (const [seriesId, list] of seriesMap) {
      const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
      out.push({
        kind: 'series',
        seriesId,
        masterPrompt: sorted[0]?.masterPrompt || sorted[0]?.prompt || '系列作品',
        records: sorted,
        latestAt: Math.max(...sorted.map((r) => r.createdAt)),
      });
    }
    for (const record of singles) out.push({ kind: 'single', record });
    out.sort((a, b) => (a.kind === 'single' ? a.record.createdAt : a.latestAt) - (b.kind === 'single' ? b.record.createdAt : b.latestAt));
    return sort === 'newest' ? out.reverse() : out;
  }, [records, sort]);

  // 过滤
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (typeFilter === 'studio' && card.kind !== 'single') return false;
      if (typeFilter === 'storyboard' && card.kind !== 'series') return false;
      if (!query) return true;
      if (card.kind === 'single') return card.record.prompt.toLowerCase().includes(query);
      return card.masterPrompt.toLowerCase().includes(query) || card.records.some((r) => r.prompt.toLowerCase().includes(query));
    });
  }, [cards, typeFilter, search]);

  // 统计
  const stats = useMemo(() => {
    const singles = records.filter((r) => !(r.kind === 'series' && r.seriesId));
    const seriesGroups = new Set(records.filter((r) => r.kind === 'series' && r.seriesId).map((r) => r.seriesId!));
    return { total: records.length, studio: singles.length, series: seriesGroups.size };
  }, [records]);

  const grouped = useMemo(() => {
    const groups: Record<string, GalleryCard[]> = { today: [], week: [], earlier: [] };
    for (const card of filtered) {
      const ts = card.kind === 'single' ? card.record.createdAt : card.latestAt;
      groups[timeGroup(ts)].push(card);
    }
    return groups;
  }, [filtered]);

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedRecords = useMemo(() => records.filter((r) => selected.has(r.id)), [records, selected]);

  const batchDownload = async () => {
    if (selectedRecords.length === 0) return;
    await downloadZip(
      selectedRecords.map((r) => ({ name: `sprout-${r.id.slice(-6)}.${imageFileExtension(r.dataUrl, r.outputFormat)}`, dataUrl: r.dataUrl })),
      `sprout-batch-${Date.now()}.zip`,
    );
    pushToast('success', `已打包 ${selectedRecords.length} 张图片`);
  };

  const zipSeries = async (card: SeriesCard) => {
    await downloadZip(
      card.records.map((r, i) => ({ name: `scene-${String(i + 1).padStart(2, '0')}-${r.id.slice(-4)}.${imageFileExtension(r.dataUrl, r.outputFormat)}`, dataUrl: r.dataUrl })),
      `sprout-series-${card.seriesId.slice(-6)}.zip`,
    );
    pushToast('success', `已打包《${card.masterPrompt.slice(0, 12)}》全套 ${card.records.length} 幕`);
  };

  // ===== 查看器 =====
  const viewerRef = useFocusTrap<HTMLDivElement>(viewer !== null);
  const viewerRecords = viewer
    ? viewer.card.kind === 'series' ? viewer.card.records : [viewer.card.record]
    : [];
  const currentRecord = viewerRecords[viewer?.index ?? 0] ?? null;

  const stepViewer = (delta: number) => {
    setViewer((current) => {
      if (!current) return current;
      const total = current.card.kind === 'series' ? current.card.records.length : 1;
      return { ...current, index: (current.index + delta + total) % total };
    });
  };

  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewer(null);
      if (event.key === 'ArrowLeft') stepViewer(-1);
      if (event.key === 'ArrowRight') stepViewer(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { if (viewer) setZoom(1); }, [viewer?.index]);

  const viewerTitle = viewer?.card.kind === 'series' ? viewer.card.masterPrompt : currentRecord?.prompt || '';

  return (
    <main className="w-full pt-16 bg-surface min-h-[calc(100vh-4rem)]">
      <div className="w-full px-gutter-canvas py-space-lg max-w-[1560px] mx-auto flex flex-col gap-6">
        {/* 1. 头部 */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-outline-variant/30 pb-6">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 text-primary font-meta-sm text-[11px] tracking-widest uppercase">
              <span className="w-2 h-2 rounded-full bg-primary/70" />
              <span>自然心流 · 历史作品 · 浏览与下载</span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">作品展馆 · 浏览画作</h1>
              <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-surface-container text-secondary text-xs font-meta-sm border border-outline-variant/30">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                共 {stats.total} 幅作品 · 高保真原画
              </span>
            </div>
            <p className="mt-2 text-sm text-on-surface-variant max-w-3xl leading-relaxed">查看你生成的所有单图与系列作品，支持按条件检索、查看大图与批量下载原图。</p>
          </div>
        </div>

        {/* 2. 筛选工具条 */}
        <div className="flex flex-col gap-3.5 bg-surface-container-low/70 border border-outline-variant/35 p-4 rounded-2xl shadow-[0_2px_12px_rgba(85,95,75,0.03)] backdrop-blur-sm">
          <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3.5">
            {/* 类型胶囊 */}
            <div className="flex items-center gap-1.5 p-1 bg-surface-container rounded-xl overflow-x-auto select-none border border-outline-variant/30">
              {([
                { id: 'all' as TypeFilter, label: '全部画作', count: stats.total, icon: Images },
                { id: 'studio' as TypeFilter, label: '单图创作', count: stats.studio, icon: Brush },
                { id: 'storyboard' as TypeFilter, label: '系列策划', count: stats.series, icon: BookOpenText },
              ]).map((item) => {
                const active = typeFilter === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={active
                      ? 'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-primary text-on-primary shadow-sm transition-all whitespace-nowrap'
                      : 'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all whitespace-nowrap'}
                    onClick={() => setTypeFilter(item.id)}
                  >
                    <Icon size={15} aria-hidden />
                    {item.label}
                    <span className={active ? 'px-1.5 py-0.2 rounded-full bg-white/20 font-meta-sm text-[10px]' : 'font-meta-sm text-[10px] opacity-75'}>{item.count}</span>
                  </button>
                );
              })}
            </div>
            {/* 搜索 */}
            <div className="relative flex-1 max-w-xl">
              <div className="flex items-center bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-3.5 py-2 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <Search size={19} className="text-primary mr-2 shrink-0" aria-hidden />
                <input
                  ref={searchRef}
                  className="w-full bg-transparent border-none p-0 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-0"
                  placeholder="检索画面描述、提示词或系列名称..."
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="flex items-center gap-1 pl-2 border-l border-outline-variant/30 text-outline text-[11px] font-meta-sm">
                  <kbd className="px-1.5 py-0.5 rounded bg-surface-container font-mono text-[10px]">⌘</kbd>
                  <kbd className="px-1.5 py-0.5 rounded bg-surface-container font-mono text-[10px]">K</kbd>
                </div>
              </div>
            </div>
          </div>
          {/* 排序 + 批量动作 */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-outline-variant/20">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <select
                className="appearance-none bg-surface-container-lowest border border-outline-variant/40 hover:border-outline text-on-surface text-xs py-1.5 pl-3 pr-7 rounded-xl cursor-pointer shadow-xs transition-colors focus:ring-1 focus:ring-primary"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
              >
                <option value="newest">排序：生成时间 (最新优先)</option>
                <option value="oldest">排序：生成时间 (最早创作)</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5 bg-surface-container-lowest border border-outline-variant/40 px-2.5 py-1 rounded-xl shadow-xs ml-auto">
              <label className="flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer select-none">
                <input
                  className="w-3.5 h-3.5 rounded accent-primary text-primary focus:ring-primary cursor-pointer"
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === records.length}
                  onChange={(event) => setSelected(event.target.checked ? new Set(records.map((r) => r.id)) : new Set())}
                />
                <span className="text-xs text-on-surface font-medium">全选</span>
              </label>
              <div className="w-px h-3.5 bg-outline-variant/40 mx-0.5" />
              <button type="button" className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-fixed/50 hover:bg-primary-fixed text-on-primary-fixed text-xs font-medium transition-colors" onClick={() => { void batchDownload(); }} disabled={selected.size === 0}>
                <Download size={15} className="text-primary" aria-hidden />
                <span>批量下载原图 ({selected.size})</span>
              </button>
              <button type="button" className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-error-container text-error text-xs transition-colors" title="删除选中作品" onClick={() => { selected.forEach((id) => { void onDelete(id); }); setSelected(new Set()); pushToast('info', '已删除选中作品'); }}>
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
          </div>
        </div>

        {/* 3. 时间分组网格 */}
        {GROUP_ORDER.map((group) => grouped[group].length === 0 ? null : (
          <section key={group} id={`group-${group}`} className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="font-meta-sm text-meta-sm text-primary tracking-widest uppercase font-medium">{GROUP_LABEL[group]}</span>
              <span className="font-meta-sm text-meta-sm text-outline">{grouped[group].length} 项</span>
              <div className="flex-1 h-px bg-outline-variant/20" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-lg">
              {grouped[group].map((card) => {
                if (card.kind === 'single') {
                  const record = card.record;
                  const checked = selected.has(record.id);
                  return (
                    <article key={record.id} className="gallery-card group relative bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-2.5 shadow-[0_2px_10px_rgba(70,80,60,0.04)] hover:shadow-[0_12px_28px_rgba(70,80,60,0.12)] hover:-translate-y-1 transition-all duration-300 flex flex-col" data-source="studio">
                      <div className="relative overflow-hidden rounded-xl aspect-[4/3] bg-[#f5f3ec] border border-outline-variant/25">
                        <img alt={record.prompt.slice(0, 40)} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" src={record.dataUrl} />
                        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none z-10">
                          <span className="pointer-events-auto px-2 py-0.5 rounded-md bg-surface-bright/90 backdrop-blur-md text-secondary font-meta-sm text-[10px] shadow-xs">{record.createdAt === 0 ? '单图' : '单图创作'}</span>
                          <input className="card-checkbox pointer-events-auto w-4 h-4 rounded accent-primary border-outline-variant/60 shadow-xs cursor-pointer" type="checkbox" checked={checked} onChange={() => toggleSelect(record.id)} aria-label="选择此作品" />
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-t from-on-surface/65 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-2.5">
                          <div className="w-full grid grid-cols-2 gap-1.5">
                            <button type="button" className="py-1.5 bg-surface-container-lowest/95 backdrop-blur-md hover:bg-surface-container-lowest text-on-surface rounded-lg text-xs font-medium shadow-sm flex items-center justify-center gap-1 transition-colors" onClick={() => setViewer({ card, index: 0 })}>
                              <ZoomIn size={14} className="text-primary" aria-hidden /> 检视
                            </button>
                            <button type="button" className="py-1.5 bg-primary/95 backdrop-blur-md hover:bg-primary text-on-primary rounded-lg text-xs font-medium shadow-sm flex items-center justify-center gap-1 transition-colors" onClick={() => downloadRecord(record)}>
                              <Download size={14} aria-hidden /> 下载
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="pt-2.5 px-1 flex flex-col gap-1.5">
                        <h3 className="font-body-sm text-body-sm text-on-surface font-medium truncate">{record.prompt.slice(0, 30) || '未命名作品'}</h3>
                        <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
                          <span className="font-meta-sm text-outline">{record.kind === 'series' ? '系列分镜' : '单图创作'}</span>
                          <span className="font-meta-sm">{new Date(record.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </article>
                  );
                }
                // 系列叠层卡 (照搬稿: 双层纸垫 + 徽标 + 检视/打包)
                const cover = card.records[card.records.length - 1] ?? card.records[0];
                return (
                  <article key={card.seriesId} className="gallery-card group relative bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-2.5 shadow-[0_2px_10px_rgba(70,80,60,0.04)] hover:shadow-[0_12px_28px_rgba(70,80,60,0.12)] hover:-translate-y-1 transition-all duration-300 flex flex-col" data-source="storyboard">
                    <div className="absolute -top-1.5 inset-x-4 h-3 bg-surface-container-high rounded-t-xl border border-outline-variant/30 -z-10 shadow-xs" />
                    <div className="absolute -top-0.5 inset-x-2.5 h-3 bg-surface-container rounded-t-xl border border-outline-variant/35 -z-10 shadow-xs" />
                    <div className="relative overflow-hidden rounded-xl aspect-[4/3] bg-[#f5f3ec] border border-outline-variant/25">
                      <img alt={card.masterPrompt.slice(0, 40)} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" src={cover?.dataUrl} />
                      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none z-10">
                        <span className="pointer-events-auto px-2 py-0.5 rounded-md bg-primary text-on-primary font-meta-sm text-[10px] shadow-xs flex items-center gap-1 font-medium">
                          <BookOpenText size={13} aria-hidden />系列 · {card.records.length} 幕
                        </span>
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-on-surface/65 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-2.5">
                        <div className="w-full grid grid-cols-2 gap-1.5">
                          <button type="button" className="py-1.5 bg-surface-container-lowest/95 backdrop-blur-md hover:bg-surface-container-lowest text-on-surface rounded-lg text-xs font-medium shadow-sm flex items-center justify-center gap-1 transition-colors" onClick={() => setViewer({ card, index: 0 })}>
                            <BookOpenText size={14} className="text-primary" aria-hidden /> 检视画册
                          </button>
                          <button type="button" className="py-1.5 bg-primary/95 backdrop-blur-md hover:bg-primary text-on-primary rounded-lg text-xs font-medium shadow-sm flex items-center justify-center gap-1 transition-colors" onClick={() => { void zipSeries(card); }}>
                            <Download size={14} aria-hidden /> 打包全套
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="pt-2.5 px-1 flex flex-col gap-1.5">
                      <h3 className="font-body-sm text-body-sm text-on-surface font-medium truncate">{card.masterPrompt.slice(0, 30) || '系列作品'}</h3>
                      <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
                        <span className="font-meta-sm text-primary flex items-center gap-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                          连贯系列
                        </span>
                        <span className="font-meta-sm">{new Date(card.latestAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {filtered.length === 0 && (
          <div className="py-space-xl text-center flex flex-col items-center gap-space-sm">
            <Palette size={32} className="text-outline" aria-hidden />
            <p className="text-on-surface-variant font-body-sm text-body-sm">{records.length === 0 ? '展馆还是空的，去创作第一幅作品吧' : '没有匹配的作品，试试切换筛选条件'}</p>
          </div>
        )}
      </div>

      {/* 4. 沉浸查看器 (照搬查看器稿: 顶条 + 主区 + Filmstrip) */}
      {viewer && currentRecord && (
        <div className="fixed inset-0 z-50 bg-surface-dim/40 backdrop-blur-md flex items-center justify-center p-4 md:p-8" role="dialog" aria-modal="true" aria-label={viewerTitle.slice(0, 30)}>
          <div ref={viewerRef} className="relative w-full h-full max-h-[94vh] bg-surface-bright rounded-2xl shadow-[0_20px_60px_rgba(40,48,36,0.28)] flex flex-col">
            {/* 顶条 */}
            <div className="h-16 px-space-lg bg-surface-container-low/90 backdrop-blur-md flex items-center justify-between gap-space-md shrink-0">
              <div className="flex items-center gap-space-md min-w-0">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  {viewer.card.kind === 'series' ? <BookOpenText size={20} aria-hidden /> : <Brush size={20} aria-hidden />}
                </div>
                <div className="min-w-0">
                  <h2 className="font-headline-sm text-headline-sm text-on-surface truncate">{viewerTitle.slice(0, 40) || '作品检视'}</h2>
                  <p className="font-meta-sm text-meta-sm text-on-surface-variant mt-0.5 truncate">
                    {viewer.card.kind === 'series' ? `系列 · 第 ${viewer.index + 1} / ${viewer.card.records.length} 幕` : '单图作品'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-space-xs shrink-0">
                <button type="button" className="flex items-center gap-1 px-space-md py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary-container transition-all font-body-sm text-body-sm" onClick={() => downloadRecord(currentRecord)}>
                  <Download size={14} aria-hidden />
                  <span className="hidden sm:inline">下载本图</span>
                </button>
                {viewer.card.kind === 'series' && (
                  <button type="button" className="flex items-center gap-1 px-space-md py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-all font-body-sm text-body-sm" onClick={() => { void zipSeries(viewer.card as SeriesCard); }}>
                    <Download size={14} aria-hidden />
                    <span className="hidden sm:inline">打包全套</span>
                  </button>
                )}
                <button type="button" className="w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded transition-colors flex items-center justify-center" onClick={() => setViewer(null)} aria-label="关闭查看器">
                  <X size={18} aria-hidden />
                </button>
              </div>
            </div>

            {/* 主区: 左图 + 右配方侧栏 */}
            <div className="flex-1 flex flex-col md:flex-row min-h-0 relative">
              <div className="flex-1 flex flex-col min-w-0 bg-surface-dim/40 relative">
                {/* 缩放工具组 (滚轮缩放) */}
                <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 bg-surface-bright/90 backdrop-blur-md p-1 rounded-xl shadow-md">
                  <button type="button" className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="放大">
                    <ZoomIn size={16} aria-hidden />
                  </button>
                  <button type="button" className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors" onClick={() => setZoom((z) => Math.max(1, z - 0.25))} aria-label="缩小">
                    <ChevronLeft size={16} aria-hidden className="rotate-90" />
                  </button>
                  <span className="font-meta-sm text-meta-sm text-on-surface-variant px-1">{Math.round(zoom * 100)}%</span>
                </div>
                {/* 画布 (滚轮缩放 + 左右键) */}
                <div
                  className="flex-1 flex items-center justify-center overflow-auto p-space-lg"
                  onWheel={(event) => {
                    if (!event.ctrlKey && !event.metaKey) return;
                    event.preventDefault();
                    setZoom((z) => Math.min(4, Math.max(1, z + (event.deltaY < 0 ? 0.25 : -0.25))));
                  }}
                >
                  <img
                    src={currentRecord.dataUrl}
                    alt={currentRecord.prompt.slice(0, 60)}
                    className="rounded-xl shadow-lg transition-transform duration-200 select-none"
                    style={{ transform: `scale(${zoom})`, maxHeight: '70vh', maxWidth: '100%', objectFit: 'contain' }}
                    draggable={false}
                  />
                </div>
              </div>

              {/* 创作配方侧栏 */}
              <aside className="w-full md:w-80 shrink-0 bg-surface-container-lowest border-l border-outline-variant/25 overflow-y-auto p-space-lg flex flex-col gap-space-md max-h-[50vh] md:max-h-none">
                <div>
                  <p className="font-meta-sm text-meta-sm text-outline uppercase tracking-wider mb-1">创作配方</p>
                  <h3 className="font-headline-sm text-headline-sm text-on-surface">{viewerTitle.slice(0, 24) || '未命名'}</h3>
                </div>
                {viewer.card.kind === 'series' && (viewer.card as SeriesCard).masterPrompt && (
                  <div className="p-space-sm rounded-xl bg-surface-container-low/60 border border-outline-variant/20">
                    <p className="font-meta-sm text-meta-sm text-outline mb-1">Master Prompt · 世界观</p>
                    <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">{(viewer.card as SeriesCard).masterPrompt.slice(0, 120)}</p>
                  </div>
                )}
                <div className="p-space-sm rounded-xl bg-surface-container-low/60 border border-outline-variant/20">
                  <p className="font-meta-sm text-meta-sm text-outline mb-1">Scene Prompt · 本幕画面</p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">{currentRecord.prompt || '—'}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-xl bg-surface-container-low/60">
                    <p className="font-meta-sm text-meta-sm text-outline mb-0.5">画幅</p>
                    <p className="font-body-sm text-body-sm text-on-surface font-medium">{currentRecord.kind === 'series' ? '16:9 分镜' : '1:1 方图'}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-surface-container-low/60">
                    <p className="font-meta-sm text-meta-sm text-outline mb-0.5">格式</p>
                    <p className="font-body-sm text-body-sm text-on-surface font-medium">{(currentRecord.outputFormat || 'png').toUpperCase()}</p>
                  </div>
                </div>
                {/* 复制 + 动作 */}
                <div className="flex flex-col gap-2 mt-auto">
                  <button type="button" className="w-full py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface font-body-sm text-body-sm flex items-center justify-center gap-1.5 transition-colors" onClick={() => { void navigator.clipboard.writeText(currentRecord.prompt).then(() => pushToast('success', '已复制本幕提示词')); }}>
                    <Copy size={14} aria-hidden /> 复制本幕 Prompt
                  </button>
                  <button type="button" className="w-full py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm flex items-center justify-center gap-1.5 transition-colors" onClick={() => { onUseAsRef(currentRecord); setViewer(null); }}>
                    <Sparkles size={14} aria-hidden /> 基于此图再创作
                  </button>
                </div>
              </aside>
            </div>

            {/* 底部 Filmstrip (96px, 系列) */}
            {viewer.card.kind === 'series' && viewer.card.records.length > 1 && (
              <div className="h-24 px-space-lg py-2 bg-surface-container-low/95 backdrop-blur-md flex items-center justify-between gap-space-md shrink-0 border-t border-outline-variant/25">
                <div className="flex items-center gap-space-xs text-on-surface-variant font-meta-sm text-meta-sm shrink-0">
                  <BookOpenText size={18} className="text-primary" aria-hidden />
                  <span>{viewer.card.kind === 'series' ? viewer.card.records.length : 0} 幕</span>
                </div>
                <div className="flex-1 flex items-center justify-center gap-space-sm overflow-x-auto py-1">
                  {viewer.card.kind === 'series' && viewer.card.records.map((record, i) => (
                    <button
                      key={record.id}
                      type="button"
                      className={`w-16 h-11 rounded-lg overflow-hidden bg-surface-container relative shrink-0 transition-all ${i === viewer.index ? 'ring-2 ring-primary scale-105' : 'opacity-70 hover:opacity-100'}`}
                      onClick={() => setViewer((current) => current ? { ...current, index: i } : current)}
                      aria-label={`第 ${i + 1} 幕`}
                    >
                      <img className="w-full h-full object-cover" src={record.dataUrl} alt={record.prompt.slice(0, 20)} />
                      <span className="absolute bottom-0 inset-x-0 bg-inverse-surface/70 text-inverse-on-surface font-meta-sm text-[9px] text-center leading-4">{String(i + 1).padStart(2, '0')}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40" onClick={() => stepViewer(-1)} disabled={viewer.index === 0} aria-label="上一幕">
                    <ChevronLeft size={16} aria-hidden />
                  </button>
                  <button type="button" className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40" onClick={() => stepViewer(1)} disabled={viewer.index === (viewer.card.kind === 'series' ? viewer.card.records.length : 1) - 1} aria-label="下一幕">
                    <ChevronRight size={16} aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} />
    </main>
  );
}
