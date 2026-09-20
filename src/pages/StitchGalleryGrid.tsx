import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefImage, ResultRecord } from '../types/generation';
import { SplitToolDrawer } from '../components/tools/SplitToolDrawer';
import { StitchIcon } from '../components/ui/StitchIcon';
import { StitchGalleryViewer } from '../components/gallery/StitchGalleryViewer';
import { ToastStack } from '../components/shell/QueueDrawer';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  cardRecords,
  cardTimestamp,
  cardTitle,
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
const RATIOS = [
  ['all', '全部'],
  ['1:1', '1:1'],
  ['16:9', '16:9'],
  ['9:16', '9:16'],
  ['4:3', '4:3'],
  ['3:4', '3:4'],
  ['3:2', '3:2'],
  ['2:3', '2:3'],
  ['21:9', '21:9'],
] as const;
const CHIP_WRAP = 'flex items-center gap-1 p-1 bg-surface-container rounded-xl overflow-x-auto select-none border border-outline-variant/30';
const chipClass = (active: boolean) =>
  `px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40 ${active ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'}`;

function timeGroup(timestamp: number): Group {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (timestamp >= today.getTime()) return 'today';
  const week = new Date(today);
  week.setDate(week.getDate() - 6);
  return timestamp >= week.getTime() ? 'week' : 'earlier';
}

function countLabel(singles: number, series: number) {
  const parts = [];
  if (singles) parts.push(`${singles} 张单图`);
  if (series) parts.push(`${series} 套系列`);
  return parts.join(' · ') || '暂无作品';
}

export function GalleryGrid({ records, onClear, onDeleteMany, onUseRecipe, onUseAsRef, onEditRecord, onUseSeries, onUseSliceAsRef }: GalleryProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [ratio, setRatio] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [viewer, setViewer] = useState<{ cards: GalleryCard[]; index: number } | null>(null);
  const [splitRecord, setSplitRecord] = useState<ResultRecord | null>(null);
  const [working, setWorking] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'error'; message: string }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const confirmRef = useFocusTrap<HTMLDivElement>(confirming);
  const metadata = useImageMetadata(records);
  const pushToast = useCallback((type: 'info' | 'success' | 'error', message: string) => {
    const id = randomId();
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3200);
  }, []);

  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    setConfirming(false);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !viewer && !confirming) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape' && confirming) { event.preventDefault(); setConfirming(false); }
      else if (event.key === 'Escape' && selecting && !viewer) { event.preventDefault(); exitSelect(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, exitSelect, selecting, viewer]);

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
        if (typeFilter === 'studio' && card.kind !== 'single') return false;
        if (typeFilter === 'storyboard' && card.kind !== 'series') return false;
        const items = cardRecords(card);
        if (ratio !== 'all' && !items.some((record) => metadata[record.id]?.ratio === ratio)) return false;
        const query = search.trim().toLowerCase();
        return (
          !query ||
          cardTitle(card).toLowerCase().includes(query) ||
          items.some((record) => [record.prompt, record.recipe?.prompt, record.recipe?.styleName].filter(Boolean).join(' ').toLowerCase().includes(query))
        );
      }),
    [cards, metadata, ratio, search, typeFilter],
  );

  const visibleRecords = useMemo(() => filtered.flatMap(cardRecords), [filtered]);
  const selectedRecords = visibleRecords.filter((record) => selected.has(record.id));
  const selectedCount = selectedRecords.length;
  const grouped = useMemo(() => {
    const groups: Record<Group, GalleryCard[]> = { today: [], week: [], earlier: [] };
    for (const card of filtered) groups[timeGroup(cardTimestamp(card))].push(card);
    return groups;
  }, [filtered]);
  const singlesCount = cards.filter((card) => card.kind === 'single').length;
  const seriesCount = cards.filter((card) => card.kind === 'series').length;
  const selectedSingles = filtered.filter((card) => card.kind === 'single' && cardRecords(card).some((record) => selected.has(record.id))).length;
  const selectedSeries = filtered.filter((card) => card.kind === 'series' && cardRecords(card).some((record) => selected.has(record.id))).length;

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
  const confirmDelete = async () => {
    if (!selectedCount || working) return;
    setWorking(true);
    try {
      if (selectedCount === records.length) await onClear();
      else {
        const sceneKeys = new Set(selectedRecords.filter((record) => record.sceneId).map((record) => `${record.seriesId}:${record.sceneId}`));
        await onDeleteMany(records.filter((record) => selected.has(record.id) || sceneKeys.has(`${record.seriesId}:${record.sceneId}`)).map((record) => record.id));
      }
      pushToast('success', `已删除 ${countLabel(selectedSingles, selectedSeries).replace(' · ', '和')}`);
      exitSelect();
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
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-space-2xs text-secondary font-meta-sm text-meta-sm">
            <StitchIcon name="photo_library" size={18} />
            <span>本地保存</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-space-sm">
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">展馆</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface-variant font-meta-sm text-meta-sm">
              {countLabel(singlesCount, seriesCount)}
            </span>
          </div>
          <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
            点击图片打开详情. 批量下载或删除请点管理作品.
          </p>
        </div>
        <div className="flex flex-col gap-2 bg-surface-container-low border border-outline-variant/30 p-space-md rounded-2xl">
          <div className="flex items-center gap-2">
            <div className={`${CHIP_WRAP} min-w-0 shrink`} role="group" aria-label="作品类型">
              {(
                [
                  ['all', 'auto_stories', '全部', cards.length],
                  ['studio', 'brush', '单图', singlesCount],
                  ['storyboard', 'view_carousel', '系列', seriesCount],
                ] as const
              ).map(([id, icon, label, count]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={typeFilter === id}
                  className={`flex items-center gap-1.5 ${chipClass(typeFilter === id)}`}
                  onClick={() => setTypeFilter(id)}
                >
                  <StitchIcon name={icon} size={15} />
                  {label}
                  <span className={`font-meta-sm text-[10px] ${typeFilter === id ? 'px-1.5 rounded-full bg-white/20' : 'opacity-75'}`}>
                    {count}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 items-center rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-3.5 py-2 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:max-w-xl sm:ml-auto">
              <StitchIcon name="search" size={19} className="mr-2 shrink-0 text-primary" />
              <input
                ref={searchRef}
                aria-label="检索作品"
                className="w-full min-w-0 border-none bg-transparent p-0 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-0"
                placeholder="检索画面描述, 提示词或系列名称..."
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div className={`${CHIP_WRAP}`} role="group" aria-label="画幅比例">
            {RATIOS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={ratio === id} className={chipClass(ratio === id)} onClick={() => setRatio(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={CHIP_WRAP} role="group" aria-label="作品排序">
              <button type="button" aria-pressed={sort === 'newest'} className={chipClass(sort === 'newest')} onClick={() => setSort('newest')}>最新</button>
              <button type="button" aria-pressed={sort === 'oldest'} className={chipClass(sort === 'oldest')} onClick={() => setSort('oldest')}>最早</button>
            </div>
            {selecting ? (
              <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="管理作品">
                <button
                  type="button"
                  className="h-8 px-3 rounded-xl bg-secondary-container text-on-secondary-container font-meta-sm text-meta-sm font-medium hover:bg-secondary-fixed disabled:opacity-40"
                  disabled={!selectedCount || working}
                  onClick={() => void batchDownload(selectedRecords)}
                >
                  下载{selectedCount ? ` ${selectedCount}` : ''}
                </button>
                <button
                  type="button"
                  className="h-8 px-3 rounded-xl bg-error-container text-on-error-container font-meta-sm text-meta-sm font-medium hover:bg-error/20 disabled:opacity-40"
                  aria-label="删除选中作品"
                  disabled={!selectedCount || working}
                  onClick={() => setConfirming(true)}
                >
                  删除{selectedCount ? ` ${selectedCount}` : ''}
                </button>
                <button type="button" className="h-8 px-3 rounded-xl bg-surface-container text-on-surface font-meta-sm text-meta-sm hover:bg-surface-container-high" onClick={exitSelect}>取消</button>
              </div>
            ) : (
              <button
                type="button"
                className="h-8 shrink-0 px-3 rounded-xl bg-secondary-container font-meta-sm text-meta-sm font-medium text-on-secondary-container hover:bg-secondary-fixed disabled:opacity-40"
                disabled={!filtered.length}
                onClick={() => setSelecting(true)}
              >
                管理作品
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-10">
          {(sort === 'newest' ? GROUPS : [...GROUPS].reverse()).map(
            (group) =>
              grouped[group].length > 0 && (
                <section key={group} id={`group-${group}`} className="flex flex-col gap-4 scroll-mt-32 md:scroll-mt-20">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/30 pb-2.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-primary ${group === 'today' ? 'bg-primary-fixed' : 'bg-surface-container'}`}>
                        <StitchIcon name={group === 'today' ? 'wb_sunny' : 'calendar_month'} size={16} />
                      </div>
                      <h2 className="font-headline-sm text-headline-sm text-on-surface">{GROUP_LABEL[group]}</h2>
                      <span className={`px-2.5 py-0.5 rounded-full font-meta-sm text-[11px] ${group === 'today' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>
                        {countLabel(
                          grouped[group].filter((card) => card.kind === 'single').length,
                          grouped[group].filter((card) => card.kind === 'series').length,
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {grouped[group].map((card) => {
                      const items = cardRecords(card);
                      const cover = items[0];
                      const title = cardTitle(card);
                      const info = metadata[cover.id];
                      const series = card.kind === 'series';
                      const date = new Date(cardTimestamp(card));
                      const checked = items.every((record) => selected.has(record.id));
                      return (
                        <article
                          key={series ? card.seriesId : cover.id}
                          className={`gallery-card group relative isolate bg-surface-container-lowest border rounded-2xl p-2.5 shadow-[0_2px_10px_rgba(70,80,60,0.04)] hover:shadow-[0_12px_28px_rgba(70,80,60,0.12)] hover:-translate-y-1 transition-all duration-300 flex flex-col min-w-0 ${selecting && checked ? 'border-primary' : 'border-outline-variant/40'}`}
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
                              aria-label={selecting ? `选择${series ? '系列' : '作品'}: ${title}` : `检视${series ? '系列' : '作品'}: ${title}`}
                              aria-pressed={selecting ? checked : undefined}
                              onClick={() => { if (selecting) toggle(items); else openViewer(card); }}
                            >
                              <RecordImage
                                alt={title}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                record={cover}
                                loading="lazy"
                              />
                            </button>
                            <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none z-10">
                              <span className={`px-2 py-0.5 rounded-md backdrop-blur-md font-meta-sm text-[10px] shadow-xs flex items-center gap-1 ${series ? 'bg-primary text-on-primary font-medium' : 'bg-surface-bright/90 text-secondary'}`}>
                                <StitchIcon name={series ? 'view_carousel' : 'brush'} size={13} />
                                {series ? `系列 · ${items.length} 幕` : '单图'}
                              </span>
                              {selecting && (
                                <input
                                  className="pointer-events-auto w-4 h-4 rounded accent-primary border-outline-variant/60 shadow-xs cursor-pointer"
                                  type="checkbox"
                                  checked={checked}
                                  ref={(element) => {
                                    if (element) element.indeterminate = items.some((record) => selected.has(record.id)) && !checked;
                                  }}
                                  onChange={() => toggle(items)}
                                  aria-label={`选择${series ? '系列' : '作品'}: ${title}`}
                                />
                              )}
                            </div>
                          </div>
                          <div className="pt-2.5 px-1 flex flex-col gap-1">
                            <div className="flex items-center justify-between gap-2 text-[11px] text-on-surface-variant">
                              <span className="font-meta-sm truncate">{info ? `${info.size} · ${info.ratio}` : '读取画幅中'}</span>
                              <span className="font-meta-sm text-outline shrink-0">{cover.outputFormat?.toUpperCase()}</span>
                            </div>
                            <h3 className="font-body-md text-body-md text-on-surface font-medium truncate" title={title}>{title}</h3>
                            <span className="pt-1 font-meta-sm text-[11px] text-on-surface-variant">
                              {group === 'today'
                                ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
                                : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                            </span>
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
            <p className="font-headline-sm text-headline-sm">{records.length ? '没有匹配的作品' : '展馆等待第一幅画作'}</p>
            <p className="text-on-surface-variant font-body-sm text-body-sm">
              {records.length ? '调整筛选条件或试试其他关键词.' : '在单图创作或系列策划中生成的作品会保存在这里.'}
            </p>
            {records.length > 0 && (
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs"
                onClick={() => { setTypeFilter('all'); setRatio('all'); setSearch(''); }}
              >
                重置筛选
              </button>
            )}
          </div>
        )}
      </div>
      {confirming && (
        <div className="fixed inset-0 z-50 bg-inverse-surface/45 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { if (!working) setConfirming(false); }}>
          <div
            ref={confirmRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gallery-delete-title"
            className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="gallery-delete-title" className="font-headline-sm text-headline-sm text-on-surface">确认删除作品</h3>
            <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
              确定永久删除选中的{countLabel(selectedSingles, selectedSeries).replace(' · ', '和')}吗?
              {selectedSeries > 0 ? ' 系列会连同各幕旧版本一起删除.' : ''}
              删除后无法恢复.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="px-3 py-2 rounded-lg bg-surface-container font-body-sm text-body-sm" disabled={working} onClick={() => setConfirming(false)}>取消</button>
              <button type="button" className="px-3 py-2 rounded-lg bg-error text-on-error font-body-sm text-body-sm disabled:opacity-60" disabled={working} onClick={() => void confirmDelete()}>确认删除</button>
            </div>
          </div>
        </div>
      )}
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
