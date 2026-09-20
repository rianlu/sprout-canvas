import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefImage, ResultRecord } from '../types/generation';
import { SplitToolDrawer } from '../components/tools/SplitToolDrawer';
import { StitchIcon } from '../components/ui/StitchIcon';
import { StitchGalleryViewer } from '../components/gallery/StitchGalleryViewer';
import { ToastStack } from '../components/shell/QueueDrawer';
import {
  cardRecords,
  cardTimestamp,
  cardTitle,
  downloadRecord,
  downloadRecords,
  latestSceneVersions,
  type GalleryCard,
  type SeriesCard,
} from '../lib/image/gallery';
import { useImageMetadata } from '../hooks/useImageMetadata';
import { randomId } from '../lib/random/id';
import { RecordImage } from '../components/gallery/RecordImage';

interface GalleryProps {
  records: ResultRecord[];
  onClear: () => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onDeleteMany: (ids: string[]) => Promise<void>;
  onUseRecipe: (record: ResultRecord) => void;
  onUseAsRef: (record: ResultRecord) => void;
  onEditRecord: (record: ResultRecord) => void;
  onUseSeries: (card: SeriesCard) => void;
  onUseSliceAsRef: (ref: RefImage) => void;
}

type TypeFilter = 'all' | 'studio' | 'storyboard';
type Group = 'today' | 'week' | 'earlier';
const GROUPS: Group[] = ['today', 'week', 'earlier'];
const GROUP_LABEL = { today: '今日作品', week: '近 7 天', earlier: '往期作品' };
const SELECT_CLASS =
  'appearance-none bg-surface-container-lowest border border-outline-variant/40 hover:border-outline text-on-surface font-body-sm text-body-sm py-1.5 pl-3 pr-7 rounded-xl cursor-pointer shadow-xs transition-colors focus:ring-1 focus:ring-primary max-w-full';

function timeGroup(timestamp: number): Group {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (timestamp >= today.getTime()) return 'today';
  const week = new Date(today);
  week.setDate(week.getDate() - 6);
  return timestamp >= week.getTime() ? 'week' : 'earlier';
}

export function GalleryGrid({ records, onClear, onDeleteMany, onUseRecipe, onUseAsRef, onEditRecord, onUseSeries, onUseSliceAsRef }: GalleryProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [source, setSource] = useState('all');
  const [ratio, setRatio] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<{ cards: GalleryCard[]; index: number } | null>(null);
  const [splitRecord, setSplitRecord] = useState<ResultRecord | null>(null);
  const [working, setWorking] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'error'; message: string }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const metadata = useImageMetadata(records);
  const pushToast = useCallback((type: 'info' | 'success' | 'error', message: string) => {
    const id = randomId();
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3200);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !viewer) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer]);

  const cards = useMemo<GalleryCard[]>(() => {
    const series = new Map<string, ResultRecord[]>();
    const output: GalleryCard[] = [];
    for (const record of records) {
      if (record.kind === 'series' && record.seriesId) {
        const list = series.get(record.seriesId) ?? [];
        list.push(record);
        series.set(record.seriesId, list);
      } else output.push({ kind: 'single', record });
    }
    for (const [seriesId, list] of series) {
      list.sort((a, b) => a.createdAt - b.createdAt);
      output.push({
        kind: 'series',
        seriesId,
        records: latestSceneVersions(list),
        versions: list,
        masterPrompt: list[0].masterPrompt || list[0].prompt || '系列作品',
        latestAt: Math.max(...list.map((record) => record.createdAt)),
      });
    }
    return output.sort((a, b) =>
      sort === 'newest' ? cardTimestamp(b) - cardTimestamp(a) : cardTimestamp(a) - cardTimestamp(b),
    );
  }, [records, sort]);

  const filtered = useMemo(
    () =>
      cards.filter((card) => {
        if ((typeFilter === 'studio' || source === 'quick-studio') && card.kind !== 'single') return false;
        if ((typeFilter === 'storyboard' || source === 'storyboard-stream') && card.kind !== 'series') return false;
        const items = cardRecords(card);
        if (ratio !== 'all' && !items.some((record) => metadata[record.id]?.ratio === ratio)) return false;
        const query = search.trim().toLowerCase();
        return (
          !query ||
          cardTitle(card).toLowerCase().includes(query) ||
          items.some((record) => [record.prompt, record.recipe?.prompt, record.recipe?.styleName].filter(Boolean).join(' ').toLowerCase().includes(query))
        );
      }),
    [cards, metadata, ratio, search, source, typeFilter],
  );

  const visibleRecords = useMemo(() => filtered.flatMap(cardRecords), [filtered]);
  const selectedRecords = visibleRecords.filter((record) => selected.has(record.id));
  const selectedCount = selectedRecords.length;
  const allSelected = visibleRecords.length > 0 && selectedCount === visibleRecords.length;
  const grouped = useMemo(() => {
    const groups: Record<Group, GalleryCard[]> = { today: [], week: [], earlier: [] };
    for (const card of filtered) groups[timeGroup(cardTimestamp(card))].push(card);
    return groups;
  }, [filtered]);
  const singlesCount = cards.filter((card) => card.kind === 'single').length;
  const seriesCount = records.length - singlesCount;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = selectedCount > 0 && !allSelected;
  }, [selectedCount, allSelected]);

  const toggle = (items: ResultRecord[]) =>
    setSelected((current) => {
      const next = new Set(current);
      const checked = items.every((record) => current.has(record.id));
      items.forEach((record) => {
        if (checked) next.delete(record.id);
        else next.add(record.id);
      });
      return next;
    });
  const batchDownload = async (items: ResultRecord[], name?: string) => {
    if (!items.length || working) return;
    setWorking(true);
    try {
      await downloadRecords(items, name);
      pushToast('success', `已打包 ${items.length} 张原图`);
    } catch {
      pushToast('error', '图片打包失败, 请重试');
    } finally {
      setWorking(false);
    }
  };
  const deleteSelected = async () => {
    if (!selectedCount || working || !window.confirm(`确定永久删除选中的 ${selectedCount} 张作品及其旧版本吗? 删除后无法恢复.`))
      return;
    setWorking(true);
    try {
      if (selectedCount === records.length) await onClear();
      else {
        const sceneKeys = new Set(selectedRecords.filter((record) => record.sceneId).map((record) => `${record.seriesId}:${record.sceneId}`));
        await onDeleteMany(records.filter((record) => selected.has(record.id) || sceneKeys.has(`${record.seriesId}:${record.sceneId}`)).map((record) => record.id));
      }
      setSelected(new Set());
      pushToast('success', `已删除 ${selectedCount} 张作品`);
    } catch {
      pushToast('error', '删除未完成, 请检查本地存储后重试');
    } finally {
      setWorking(false);
    }
  };
  const openViewer = (card: GalleryCard) => setViewer({ cards: filtered, index: filtered.indexOf(card) });

  return (
    <main className="stitch-page w-full bg-surface">
      <div className="w-full px-gutter-canvas pt-space-lg pb-space-xl flex flex-col gap-space-lg">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-lg">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-space-2xs text-secondary font-meta-sm text-meta-sm tracking-wider uppercase font-medium">
              <StitchIcon name="photo_library" size={18} />
              <span>创作记录 · 本地保存 · 浏览与下载</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-space-sm">
              <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
                作品展馆 · 浏览画作
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface-variant font-meta-sm text-meta-sm">
                共 {records.length} 幅作品
              </span>
            </div>
            <p className="mt-1 font-body-md text-body-md text-on-surface-variant max-w-4xl leading-relaxed">
              查看你生成的所有单图与系列作品, 支持按条件检索, 查看大图与批量下载原图.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-space-md bg-surface-container-low border border-outline-variant/30 p-space-md rounded-2xl">
          <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3.5">
            <div className="flex items-center gap-1.5 p-1 bg-surface-container rounded-xl overflow-x-auto select-none border border-outline-variant/30">
              {(
                [
                  ['all', 'auto_stories', '全部画作', records.length],
                  ['studio', 'brush', '单图创作', singlesCount],
                  ['storyboard', 'view_carousel', '系列策划', seriesCount],
                ] as const
              ).map(([id, icon, label, count]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={typeFilter === id}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${typeFilter === id ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'}`}
                  onClick={() => setTypeFilter(id)}
                >
                  <StitchIcon name={icon} size={15} />
                  {label}
                  <span
                    className={`font-meta-sm text-[10px] ${typeFilter === id ? 'px-1.5 rounded-full bg-white/20' : 'opacity-75'}`}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>
            <div className="relative flex-1 max-w-xl">
              <div className="flex items-center bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-3.5 py-2 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <StitchIcon name="search" size={19} className="text-primary mr-2" />
                <input
                  ref={searchRef}
                  aria-label="检索作品"
                  className="w-full min-w-0 bg-transparent border-none p-0 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-0"
                  placeholder="检索画面描述, 提示词或系列名称..."
                  type="search"
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
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-outline-variant/20">
            <div className="flex flex-wrap items-center gap-2.5 text-xs min-w-0">
              <div className="relative">
                <select
                  aria-label="作品来源"
                  className={SELECT_CLASS}
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                >
                  <option value="all">来源: 全部来源</option>
                  <option value="quick-studio">来源: 快捷单图</option>
                  <option value="storyboard-stream">来源: 系列策划</option>
                </select>
                <StitchIcon
                  name="expand_more"
                  size={15}
                  className="absolute right-2 top-2 pointer-events-none text-on-surface-variant"
                />
              </div>
              <div className="relative">
                <select
                  aria-label="画幅比例"
                  className={SELECT_CLASS}
                  value={ratio}
                  onChange={(event) => setRatio(event.target.value)}
                >
                  <option value="all">画幅: 全部比例</option>
                  <option value="1:1">画幅: 1:1 方形</option>
                  <option value="16:9">画幅: 16:9 宽屏</option>
                  <option value="9:16">画幅: 9:16 竖屏</option>
                  <option value="4:3">画幅: 4:3 典雅</option>
                  <option value="3:4">画幅: 3:4 立轴</option>
                  <option value="3:2">画幅: 3:2 横幅</option>
                  <option value="2:3">画幅: 2:3 竖幅</option>
                  <option value="21:9">画幅: 21:9 全景</option>
                </select>
                <StitchIcon
                  name="expand_more"
                  size={15}
                  className="absolute right-2 top-2 pointer-events-none text-on-surface-variant"
                />
              </div>
              <div className="relative">
                <select
                  aria-label="作品排序"
                  className={SELECT_CLASS}
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="newest">排序: 生成时间 (最新优先)</option>
                  <option value="oldest">排序: 生成时间 (最早创作)</option>

                </select>
                <StitchIcon
                  name="sort"
                  size={15}
                  className="absolute right-2 top-2 pointer-events-none text-on-surface-variant"
                />
              </div>
              <div className="hidden md:flex items-center gap-1 ml-1 pl-2 border-l border-outline-variant/30 text-on-surface-variant">
                <span className="text-[11px] text-outline">跳转:</span>
                {GROUPS.map((group, index) => (
                  <button
                    key={group}
                    type="button"
                    disabled={!grouped[group].length}
                    className="px-2 py-0.5 rounded-md hover:bg-surface-container text-xs hover:text-primary disabled:opacity-40"
                    onClick={() =>
                      document.getElementById(`group-${group}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  >
                    {['今日', '近7天', '往期作品'][index]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 bg-surface-container-lowest border border-outline-variant/40 px-2.5 py-1 rounded-xl shadow-xs ml-auto">
              <label className="flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer select-none">
                <input
                  ref={allRef}
                  className="w-3.5 h-3.5 rounded accent-primary cursor-pointer"
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => toggle(visibleRecords)}
                  disabled={!visibleRecords.length}
                />
                <span className="text-xs text-on-surface font-medium">全选</span>
              </label>
              <div className="w-px h-3.5 bg-outline-variant/40 mx-0.5" />
              <button
                type="button"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-fixed/50 hover:bg-primary-fixed text-on-primary-fixed text-xs font-medium disabled:opacity-50"
                disabled={!selectedCount || working}
                onClick={() => void batchDownload(selectedRecords)}
              >
                <StitchIcon name="download" size={15} className="text-primary" />
                <span>批量下载原图 ({selectedCount})</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-error-container text-error text-xs disabled:opacity-40"
                title="永久删除选中作品"
                disabled={!selectedCount || working}
                onClick={() => void deleteSelected()}
              >
                <StitchIcon name="delete" size={15} />
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-10">
          {(sort === 'newest' ? GROUPS : [...GROUPS].reverse()).map(
            (group) =>
              grouped[group].length > 0 && (
                <section key={group} id={`group-${group}`} className="flex flex-col gap-4 scroll-mt-32 md:scroll-mt-20">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/30 pb-2.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div
                        className={`w-6 h-6 rounded-lg flex items-center justify-center text-primary ${group === 'today' ? 'bg-primary-fixed' : 'bg-surface-container'}`}
                      >
                        <StitchIcon name={group === 'today' ? 'wb_sunny' : 'calendar_month'} size={16} />
                      </div>
                      <h2 className="font-headline-sm text-headline-sm text-on-surface">
                        {GROUP_LABEL[group]}
                      </h2>
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-meta-sm text-[11px] ${group === 'today' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}
                      >
                        {grouped[group].reduce((total, card) => total + cardRecords(card).length, 0)} 幅作品
                        {grouped[group].some((card) => card.kind === 'series')
                          ? ` (含 ${grouped[group].filter((card) => card.kind === 'series').length} 套系列画册)`
                          : ''}
                      </span>
                    </div>
                    <span className="font-meta-sm text-xs text-on-surface-variant/70">
                      {group === 'today'
                        ? `${new Date().toLocaleDateString('zh-CN').replaceAll('/', '.')} · 创作记录`
                        : '全部作品'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {grouped[group].map((card) => {
                      const items = cardRecords(card);
                      const cover = items[0];
                      const title = cardTitle(card);
                      const info = metadata[cover.id];
                      const series = card.kind === 'series';
                      const date = new Date(cardTimestamp(card));
                      return (
                        <article
                          key={series ? card.seriesId : cover.id}
                          className="gallery-card group relative isolate bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-2.5 shadow-[0_2px_10px_rgba(70,80,60,0.04)] hover:shadow-[0_12px_28px_rgba(70,80,60,0.12)] hover:-translate-y-1 transition-all duration-300 flex flex-col min-w-0"
                          data-source={series ? 'storyboard' : 'studio'}
                        >
                          {series && (
                            <>
                              <div className="absolute -top-1.5 inset-x-4 h-3 bg-surface-container-high rounded-t-xl border border-outline-variant/30 -z-10 shadow-xs" />
                              <div className="absolute -top-0.5 inset-x-2.5 h-3 bg-surface-container rounded-t-xl border border-outline-variant/35 -z-10 shadow-xs" />
                            </>
                          )}
                          <div className="relative overflow-hidden rounded-xl aspect-[4/3] bg-surface-container border border-outline-variant/25">
                            <button
                              type="button"
                              className="w-full h-full block"
                              title={title}
                              aria-label={`检视${series ? '系列' : '作品'}: ${title}`}
                              onClick={() => openViewer(card)}
                            >
                              <RecordImage
                                alt={title}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                record={cover}
                                loading="lazy"
                              />
                            </button>
                            <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none z-10">
                              <span
                                className={`px-2 py-0.5 rounded-md backdrop-blur-md font-meta-sm text-[10px] shadow-xs flex items-center gap-1 ${series ? 'bg-primary text-on-primary font-medium' : 'bg-surface-bright/90 text-secondary'}`}
                              >
                                <StitchIcon name={series ? 'view_carousel' : 'brush'} size={13} />
                                {series ? `系列 · ${items.length} 幕` : '单图创作'}
                              </span>
                              <input
                                className="pointer-events-auto w-4 h-4 rounded accent-primary border-outline-variant/60 shadow-xs cursor-pointer"
                                type="checkbox"
                                checked={items.every((record) => selected.has(record.id))}
                                ref={(element) => {
                                  if (element)
                                    element.indeterminate =
                                      items.some((record) => selected.has(record.id)) &&
                                      !items.every((record) => selected.has(record.id));
                                }}
                                onChange={() => toggle(items)}
                                aria-label={`选择${series ? '系列' : '作品'}: ${title}`}
                              />
                            </div>
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-on-surface/65 to-transparent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-300 p-2.5 pointer-events-none">
                              <div className="w-full grid grid-cols-2 gap-1.5 pointer-events-auto">
                                <button
                                  type="button"
                                  className="py-1.5 bg-surface-container-lowest/95 backdrop-blur-md hover:bg-surface-container-lowest text-on-surface rounded-lg text-xs font-medium shadow-sm flex items-center justify-center gap-1"
                                  onClick={() => openViewer(card)}
                                >
                                  <StitchIcon
                                    name={series ? 'auto_stories' : 'zoom_in'}
                                    size={14}
                                    className="text-primary"
                                  />
                                  {series ? '检视画册' : '检视'}
                                </button>
                                <button
                                  type="button"
                                  disabled={working}
                                  className="py-1.5 bg-primary/95 hover:bg-primary text-on-primary rounded-lg text-xs font-medium shadow-sm flex items-center justify-center gap-1"
                                  onClick={() =>
                                    series
                                      ? void batchDownload(items, `sprout-series-${card.seriesId}`)
                                      : void downloadRecord(cover).catch(() => pushToast('error', '下载失败, 请检查本地原图'))
                                  }
                                >
                                  <StitchIcon name={series ? 'folder_zip' : 'download'} size={14} />
                                  {series ? '打包全套' : '下载'}
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="pt-2.5 px-1 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2 text-[11px] text-on-surface-variant">
                              <span className="font-meta-sm truncate">
                                {info ? `${info.size} · ${info.ratio}` : '读取画幅中'}
                              </span>
                              <span className="font-meta-sm text-outline shrink-0">{cover.outputFormat?.toUpperCase()}</span>
                            </div>
                            <h3 className="font-body-md text-body-md text-on-surface font-medium truncate" title={title}>
                              {title}
                            </h3>
                            <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                              {series ? `风格与分镜: ${cover.prompt}` : cover.prompt}
                            </p>
                            <div className="flex items-center justify-between pt-1.5 mt-0.5 border-t border-outline-variant/25 text-[11px] text-on-surface-variant">
                              <span className="font-meta-sm">
                                {group === 'today'
                                  ? date.toLocaleTimeString('zh-CN', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: false,
                                    })
                                  : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  title={series ? '打包全套' : '下载原图'}
                                  className="text-outline hover:text-primary flex"
                                  onClick={() =>
                                    series
                                      ? void batchDownload(items, `sprout-series-${card.seriesId}`)
                                      : void downloadRecord(cover).catch(() => pushToast('error', '下载失败, 请检查本地原图'))
                                  }
                                >
                                  <StitchIcon name={series ? 'folder_zip' : 'download'} size={14} />
                                </button>
                                <button
                                  type="button"
                                  title="查看详情"
                                  className="text-outline hover:text-primary flex"
                                  onClick={() => openViewer(card)}
                                >
                                  <StitchIcon name={series ? 'arrow_forward' : 'info'} size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ),
          )}
        </div>
        {filtered.length === 0 && (
          <div className="py-20 rounded-2xl border border-dashed border-outline-variant/50 text-center flex flex-col items-center gap-space-sm bg-surface-container-lowest/50">
            <StitchIcon name="gallery_thumbnail" size={40} className="text-outline" />
            <p className="font-headline-sm text-headline-sm">
              {records.length ? '没有匹配的作品' : '展馆等待第一幅画作'}
            </p>
            <p className="text-on-surface-variant font-body-sm text-body-sm">
              {records.length ? '调整筛选条件或试试其他关键词.' : '在单图创作或系列策划中生成的作品会保存在这里.'}
            </p>
            {records.length > 0 && (
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs"
                onClick={() => {
                  setTypeFilter('all');
                  setSource('all');
                  setRatio('all');
                  setSearch('');
                }}
              >
                重置筛选
              </button>
            )}
          </div>
        )}
      </div>
      {viewer && (
        <StitchGalleryViewer
          cards={viewer.cards}
          initialIndex={viewer.index}
          onClose={() => setViewer(null)}
          onUseAsRef={onUseAsRef}
          onEditRecord={onEditRecord}
          onUseRecipe={onUseRecipe}
          onUseSeries={onUseSeries}
          onSplit={(record) => { setViewer(null); setSplitRecord(record); }}
          onNotify={pushToast}
        />
      )}
      <SplitToolDrawer
        open={Boolean(splitRecord)}
        initialRecord={splitRecord}
        onClose={() => setSplitRecord(null)}
        galleryRecords={records}
        onUseAsReference={(ref) => { setSplitRecord(null); onUseSliceAsRef(ref); }}
      />
      <ToastStack toasts={toasts} />
    </main>
  );
}
