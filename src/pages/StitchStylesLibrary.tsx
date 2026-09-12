import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useStyleCatalog } from '../hooks/useStyleCatalog';
import { StitchIcon } from '../components/ui/StitchIcon';
import type { StyleRecord } from '../../shared/style-contract.mjs';

interface StylesLibraryProps {
  onUseInStudio: (style: StyleRecord) => Promise<void>;
}

export function StylesLibrary({ onUseInStudio }: StylesLibraryProps) {
  const { styles, categories, loading, error, refresh } = useStyleCatalog();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [compact, setCompact] = useState(false);
  const [detail, setDetail] = useState<StyleRecord | null>(null);
  const [copied, setCopied] = useState('');
  const [applying, setApplying] = useState('');
  const [actionError, setActionError] = useState('');
  const applyLock = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(Boolean(detail));
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !detail) { event.preventDefault(); inputRef.current?.focus(); }
      if (event.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [detail]);
  useEffect(() => {
    if (!detail) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [detail]);
  const groups = ['全部', ...categories, ...(styles.some((style) => !style.category) ? ['未分类'] : [])];
  const selectedCategory = groups.includes(category) ? category : '全部';
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return styles.filter((style) => (selectedCategory === '全部' || (style.category || '未分类') === selectedCategory)
      && (!query || [style.name, style.prompt, style.author, style.category].join(' ').toLowerCase().includes(query)));
  }, [styles, search, selectedCategory]);
  async function copy(style: StyleRecord) {
    try { await navigator.clipboard.writeText(style.prompt); setCopied(style.id); window.setTimeout(() => setCopied(''), 2200); }
    catch { setActionError('复制失败, 请在详情中选择并复制提示词'); }
  }
  async function apply(style: StyleRecord) {
    if (applyLock.current) return;
    applyLock.current = true; setApplying(style.id); setActionError('');
    try { await onUseInStudio(style); }
    catch (error) { setActionError(error instanceof Error ? error.message : '模板载入失败, 请重试'); }
    finally { applyLock.current = false; setApplying(''); }
  }
  const actions = (style: StyleRecord) => <div className="flex items-center gap-2">
    <button type="button" className="flex-1 py-2.5 px-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-body-sm text-body-sm font-medium flex items-center justify-center gap-1.5" onClick={() => void copy(style)}><StitchIcon name="content_copy" size={16} className="text-primary" />{copied === style.id ? '已复制' : '复制模板'}</button>
    <button type="button" className="flex-1 py-2.5 px-3 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60" disabled={Boolean(applying)} onClick={() => void apply(style)}>{applying === style.id ? '载入中...' : '发送到单图'}<StitchIcon name="north_east" size={16} /></button>
  </div>;
  return <div className="stitch-page w-full bg-surface">
    <section className="w-full px-gutter-canvas pt-space-lg pb-space-md">
      <div className="flex items-center gap-2 mb-space-2xs text-secondary"><StitchIcon name="palette" size={18} /><span className="font-meta-sm text-meta-sm tracking-wider">灵感画风 · {styles.length} 个模板</span></div>
      <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">灵感画风库 · 风格与创作模板</h1>
      <p className="font-body-md text-body-md text-on-surface-variant mt-1 leading-relaxed">从图片与提示词中寻找灵感, 复制模板或发送到单图创作后编辑使用.</p>
    </section>
    <section className="stitch-style-filters px-gutter-canvas py-3 sticky top-16 z-30 bg-surface/95 backdrop-blur-xl border-b border-outline-variant/25">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative w-full lg:w-80 shrink-0"><StitchIcon name="search" size={18} className="absolute left-3 top-3 text-outline" /><input ref={inputRef} aria-label="搜索风格" placeholder="搜索名称, 提示词或作者..." className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/25 outline-none focus:border-primary font-body-sm text-body-sm" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div className="flex flex-wrap items-center gap-1.5 flex-1" aria-label="风格分类">
          {groups.map((group) => <button type="button" key={group} aria-pressed={selectedCategory === group} className={`px-3 py-1.5 rounded-lg font-meta-sm text-meta-sm ${selectedCategory === group ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}`} onClick={() => setCategory(group)}>{group} {group === '全部' ? styles.length : styles.filter((style) => (style.category || '未分类') === group).length}</button>)}
        </div>
        <button type="button" className="self-end lg:self-auto p-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary" aria-label="紧凑展示" aria-pressed={compact} onClick={() => setCompact((value) => !value)}><StitchIcon name={compact ? 'view_module' : 'grid_view'} size={20} /></button>
      </div>
    </section>
    <main className="px-gutter-canvas py-space-lg">
      {(error || actionError) && <div role="alert" className="mb-4 p-3 rounded-xl bg-error-container text-on-error-container flex items-center gap-3"><span>{error || actionError}</span><button type="button" className="underline" onClick={() => { setActionError(''); void refresh(); }}>重试</button></div>}
      {loading && <p role="status" className="py-10 text-center text-on-surface-variant">正在读取风格库...</p>}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-space-lg ${compact ? 'lg:grid-cols-3 xl:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {filtered.map((style) => <article key={style.id} className="style-card group flex flex-col bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-md shadow-[0_4px_20px_rgba(85,95,75,0.05)]">
          <button type="button" aria-label={`放大 ${style.name}`} className="relative w-full aspect-[4/3] overflow-hidden rounded-xl bg-surface-container-low mb-4 text-left" onClick={() => setDetail(style)}>
            <img src={style.image} alt={style.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
            <span className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-surface-bright/95 text-secondary font-meta-sm text-meta-sm">{style.category || '未分类'}</span>
            <span className="absolute right-3 bottom-3 p-2 rounded-full bg-surface-bright/95 text-primary"><StitchIcon name="fullscreen" size={18} /></span>
          </button>
          <h3 className="font-headline-sm text-headline-sm text-on-surface truncate" title={style.name}>{style.name}</h3>
          <p className="font-meta-sm text-meta-sm text-secondary mt-1 mb-2 truncate">作者: {style.author || '未注明'}</p>
          <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-3 mb-4 flex-1 whitespace-pre-wrap">{style.prompt}</p>
          {actions(style)}
        </article>)}
      </div>
      {!loading && !error && filtered.length === 0 && <p className="py-12 text-center text-on-surface-variant">{styles.length ? '没有匹配的风格, 可清空搜索或切换分类.' : '风格库暂无已上架内容.'}</p>}
      <p className="mt-space-xl font-meta-sm text-meta-sm text-outline">示例图用于展示创作案例, 不会自动作为生图参考图. 来源与许可请查看各条详情.</p>
    </main>
    {detail && <div className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`风格详情 ${detail.name}`} onClick={() => setDetail(null)}>
      <div ref={dialogRef} className="relative w-full max-w-5xl bg-surface rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row max-h-[90vh]" onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label="关闭详情" className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center" onClick={() => setDetail(null)}><StitchIcon name="close" size={20} /></button>
        <div className="w-full md:w-1/2 h-60 md:h-auto shrink-0 bg-surface-container-low flex items-center justify-center"><img src={detail.image} alt={detail.name} className="w-full h-full object-contain max-h-[85vh]" /></div>
        <div className="w-full md:w-1/2 p-space-lg overflow-y-auto flex flex-col gap-4">
          <span className="self-start px-2 py-1 rounded-lg bg-primary-fixed text-on-primary-fixed font-meta-sm text-meta-sm">{detail.category || '未分类'}</span>
          <h2 className="font-headline-lg text-headline-lg pr-7">{detail.name}</h2>
          <p className="font-body-sm text-body-sm text-secondary">作者: {detail.author || '未注明'}</p>
          <div><p className="font-meta-sm text-meta-sm text-on-surface-variant mb-2">提示词模板</p><p className="p-4 rounded-xl bg-surface-container-low font-body-sm text-body-sm leading-relaxed whitespace-pre-wrap break-words">{detail.prompt}</p></div>
          <div className="flex flex-wrap gap-3 font-meta-sm text-meta-sm text-primary">
            {detail.sourceUrl && <a href={detail.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">查看原始作品</a>}
            {detail.collectionUrl && <a href={detail.collectionUrl} target="_blank" rel="noreferrer" className="hover:underline">初始素材来源</a>}
            {detail.license && (detail.licenseUrl ? <a href={detail.licenseUrl} target="_blank" rel="noreferrer" className="hover:underline">{detail.license}</a> : <span>{detail.license}</span>)}
          </div>
          <div className="mt-auto pt-2">{actions(detail)}</div>
        </div>
      </div>
    </div>}
  </div>;
}
