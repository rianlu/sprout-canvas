import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, overlayOpen } from '../components/ui/Dialog';
import { ImageViewport } from '../components/gallery/ImageViewport';
import { ImagePreviewDialog } from '../components/image/ImagePreviewDialog';
import { useStyleCatalog } from '../hooks/useStyleCatalog';
import { StitchIcon } from '../components/ui/StitchIcon';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { StyleExampleImage } from '../components/image/StyleExampleImage';
import { useToasts } from '../components/ui/Toasts';
import { ColumnToggle, useCompactGrid } from '../components/ui/ColumnToggle';
import type { StyleRecord } from '../../shared/style-contract.mjs';

interface StylesLibraryProps {
  onUseInStudio: (style: StyleRecord) => Promise<void>;
}

export function StylesLibrary({ onUseInStudio }: StylesLibraryProps) {
  const { styles, categories, loading, error, refresh } = useStyleCatalog();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [compact, toggleCompact] = useCompactGrid('styles');
  const [detail, setDetail] = useState<StyleRecord | null>(null);
  const [fullWindow, setFullWindow] = useState(false);
  const [copied, setCopied] = useState('');
  const [applying, setApplying] = useState('');
  // Action failures use the app toast, which stays visible above the detail dialog.
  const { pushToast } = useToasts();
  const applyLock = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !overlayOpen()) { event.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const groups = ['全部', ...categories, ...(styles.some((style) => !style.category) ? ['未分类'] : [])];
  const selectedCategory = groups.includes(category) ? category : '全部';
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return styles.filter((style) => (selectedCategory === '全部' || (style.category || '未分类') === selectedCategory)
      && (!query || [style.name, style.prompt, style.author, style.category].join(' ').toLowerCase().includes(query)));
  }, [styles, search, selectedCategory]);
  async function copy(style: StyleRecord) {
    try { await navigator.clipboard.writeText(style.prompt); setCopied(style.id); window.setTimeout(() => setCopied(''), 2200); }
    catch { pushToast('error', '复制失败, 请在详情中选择并复制提示词'); }
  }
  async function apply(style: StyleRecord) {
    if (applyLock.current) return;
    applyLock.current = true; setApplying(style.id);
    try { await onUseInStudio(style); }
    catch (error) { pushToast('error', error instanceof Error ? error.message : '模板载入失败, 请重试'); }
    finally { applyLock.current = false; setApplying(''); }
  }
  const closeDetail = () => { setFullWindow(false); setDetail(null); };
  const actions = (style: StyleRecord, iconOnly = false) => {
    const labelClass = iconOnly ? 'hidden lg:inline' : undefined;
    const copyLabel = copied === style.id ? '已复制' : '复制模板';
    const applyLabel = applying === style.id ? '载入中...' : '发送到单图';
    return <div className="flex items-center gap-2">
      <button type="button" aria-label={copyLabel} title={copyLabel} className="flex-1 py-2.5 px-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-body-sm text-body-sm font-medium flex items-center justify-center gap-1.5" onClick={() => void copy(style)}><StitchIcon name="content_copy" size={16} className="text-primary" /><span className={labelClass}>{copyLabel}</span></button>
      <button type="button" aria-label={applyLabel} title={applyLabel} className="flex-1 py-2.5 px-3 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60" disabled={Boolean(applying)} onClick={() => void apply(style)}><span className={labelClass}>{applyLabel}</span><StitchIcon name="north_east" size={16} /></button>
    </div>;
  };
  return <div className="stitch-page w-full bg-surface">
    <section className="w-full px-gutter-canvas pt-space-lg pb-space-md">
      <div className="flex items-center gap-2 mb-space-2xs text-secondary"><StitchIcon name="palette" size={18} /><span className="font-meta-sm text-meta-sm tracking-wider">灵感画风 · {styles.length} 个模板</span></div>
      <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">灵感画风库 · 风格与创作模板</h1>
      <p className="font-body-md text-body-md text-on-surface-variant mt-1 leading-relaxed">从图片与提示词中寻找灵感, 复制模板或发送到单图创作后编辑使用.</p>
    </section>
    <section className="stitch-style-filters px-gutter-canvas py-3 sticky top-16 z-30 bg-surface/95 backdrop-blur-xl border-b border-outline-variant/25">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative w-full lg:w-80 shrink-0"><StitchIcon name="search" size={18} className="absolute left-3 top-3 text-outline" /><input ref={inputRef} aria-label="搜索风格" placeholder="搜索名称, 提示词或作者..." className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/25 outline-none focus:border-primary font-body-sm text-body-sm" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SegmentedControl
            label="风格分类"
            className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            value={selectedCategory}
            onChange={setCategory}
            options={groups.map((group) => ({ id: group, label: `${group} ${group === '全部' ? styles.length : styles.filter((style) => (style.category || '未分类') === group).length}` }))}
            itemClassName={(active) => `shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg font-meta-sm text-meta-sm ${active ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}`}
          />
          <ColumnToggle compact={compact} onToggle={toggleCompact} className="p-2 bg-surface-container-low hover:bg-surface-container" />
        </div>
      </div>
    </section>
    <main className="px-gutter-canvas py-space-lg">
      {error && <div role="alert" className="mb-4 p-3 rounded-xl bg-error-container text-on-error-container flex items-center gap-3"><span>{error}</span><button type="button" className="underline" onClick={() => void refresh()}>重试</button></div>}
      {loading && <p role="status" className="py-10 text-center text-on-surface-variant">正在读取风格库...</p>}
      <div className={`grid ${compact ? 'grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-space-lg xl:grid-cols-4' : 'grid-cols-1 gap-space-lg sm:grid-cols-2 lg:grid-cols-3'}`}>
        {filtered.map((style) => <article key={style.id} className={`style-card group flex flex-col bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-[0_4px_20px_rgba(85,95,75,0.05)] ${compact ? 'p-3 lg:p-space-md' : 'p-space-md'}`}>
          <button type="button" aria-label={`查看风格详情 ${style.name}`} className={`relative w-full aspect-[4/3] overflow-hidden rounded-xl bg-surface-container-low text-left ${compact ? 'mb-3 lg:mb-4' : 'mb-4'}`} onClick={() => setDetail(style)}>
            <StyleExampleImage src={style.image} alt={style.name} className="transition-transform duration-300 group-hover:scale-[1.02]" />
            <span className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-surface-bright/95 text-secondary font-meta-sm text-meta-sm">{style.category || '未分类'}</span>
          </button>
          <h3 className="font-headline-sm text-headline-sm text-on-surface truncate" title={style.name}>{style.name}</h3>
          <p className="font-meta-sm text-meta-sm text-secondary mt-1 mb-2 truncate">作者: {style.author || '未注明'}</p>
          <p className={`font-body-sm text-body-sm text-on-surface-variant line-clamp-3 flex-1 whitespace-pre-wrap ${compact ? 'mb-3 lg:mb-4' : 'mb-4'}`}>{style.prompt}</p>
          {actions(style, compact)}
        </article>)}
      </div>
      {!loading && !error && filtered.length === 0 && <p className="py-12 text-center text-on-surface-variant">{styles.length ? '没有匹配的风格, 可清空搜索或切换分类.' : '风格库暂无已上架内容.'}</p>}
      <p className="mt-space-xl font-meta-sm text-meta-sm text-outline">示例图用于展示创作案例, 不会自动作为生图参考图. 来源与许可请查看各条详情.</p>
    </main>
    {detail && <Dialog label={`风格详情 ${detail.name}`} onClose={closeDetail} backdropClassName="fixed inset-0 z-50 bg-inverse-surface/50 backdrop-blur-sm" viewportClassName="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" className="relative flex h-[min(92dvh,calc(100dvh-1.5rem))] w-[min(100%,calc(100vw-1.5rem))] max-w-7xl flex-col overflow-hidden rounded-2xl bg-surface shadow-[0_20px_60px_rgba(40,48,36,0.20)] sm:h-[min(88dvh,56rem)] sm:w-[min(80vw,80rem)]">
        <div className="h-16 px-3 md:px-space-lg bg-surface-container-lowest border-b border-outline-variant/30 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="font-headline-sm text-headline-sm text-on-surface truncate">{detail.name}</h2>
            <p className="mt-0.5 truncate font-meta-sm text-meta-sm text-on-surface-variant">{detail.category || '未分类'} · 作者 {detail.author || '未注明'}</p>
          </div>
          <button type="button" aria-label="关闭详情" className="viewer-tool-button" onClick={closeDetail}><StitchIcon name="close" size={20} /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-stretch overflow-hidden lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col">
            <ImageViewport key={detail.id} src={detail.image} alt={detail.name} onFullscreen={() => setFullWindow(true)} />
          </div>
          <aside className="flex max-h-[46%] min-h-0 w-full flex-col overflow-hidden border-t border-outline-variant/30 bg-surface-container-lowest lg:h-full lg:max-h-none lg:w-80 lg:flex-none lg:border-l lg:border-t-0">
            <div className="min-h-0 flex-1 space-y-space-md overflow-y-auto p-space-lg">
              <div>
                <p className="mb-2 font-meta-sm text-meta-sm text-on-surface-variant">提示词模板</p>
                <p className="rounded-xl bg-surface-container-low p-3 font-body-sm text-body-sm leading-relaxed whitespace-pre-wrap break-words">{detail.prompt}</p>
              </div>
              <div className="flex flex-wrap gap-3 font-meta-sm text-meta-sm text-primary">
                {detail.sourceUrl && <a href={detail.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">查看原始作品</a>}
                {detail.collectionUrl && <a href={detail.collectionUrl} target="_blank" rel="noreferrer" className="hover:underline">初始素材来源</a>}
                {detail.license && (detail.licenseUrl ? <a href={detail.licenseUrl} target="_blank" rel="noreferrer" className="hover:underline">{detail.license}</a> : <span>{detail.license}</span>)}
              </div>
            </div>
            <div className="shrink-0 border-t border-outline-variant/30 px-space-lg py-space-md">{actions(detail)}</div>
          </aside>
        </div>
      {fullWindow && <ImagePreviewDialog
        fullWindow
        label="全屏查看图片"
        title={detail.name}
        subtitle={`${detail.category || '未分类'} · 作者 ${detail.author || '未注明'}`}
        imageKey={detail.id}
        src={detail.image}
        alt={detail.name}
        closeLabel="退出全屏查看"
        onClose={() => setFullWindow(false)}
      />}
    </Dialog>}
  </div>;
}
