import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { StitchIcon } from '../components/ui/StitchIcon';
import { ToastStack } from '../components/shell/QueueDrawer';
import { STITCH_STYLES, STITCH_STYLE_GROUPS, STYLE_ATTRIBUTION, type StitchStyle } from '../lib/styles/stitch-styles';

interface StylesLibraryProps {
  target?: 'studio' | 'series';
  onUseInStudio: (styleId: string) => Promise<void>;
}

export function StylesLibrary({ target = 'studio', onUseInStudio }: StylesLibraryProps) {
  const applyLabel = target === 'series' ? '发送到系列' : '发送到单图';
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('全部');
  const [filter, setFilter] = useState<'all' | 'handmade' | 'photo'>('all');
  const [compact, setCompact] = useState(false);
  const [detail, setDetail] = useState<StitchStyle | null>(null);
  const [copied, setCopied] = useState('');
  const [applying, setApplying] = useState('');
  const [applyError, setApplyError] = useState('');
  const applyLock = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const categoriesRef = useRef<HTMLDivElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(Boolean(detail));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !detail) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  useEffect(() => {
    if (!detail) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [detail]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const catalog = STITCH_STYLES;
    return catalog.filter(
      (s) =>
        (group === '全部' || s.group === group) &&
        (filter !== 'handmade' || ['插画与纸本', '三维与微缩'].includes(s.group)) &&
        (filter !== 'photo' || s.group === '摄影与光影') &&
        (!query || [s.name, s.englishName, s.description, s.group, ...s.tags].join(' ').toLowerCase().includes(query)),
    );
  }, [search, group, filter]);

  async function copy(style: StitchStyle) {
    try {
      await navigator.clipboard.writeText(style.template);
      setCopied(style.id);
      window.setTimeout(() => setCopied(''), 2200);
    } catch {
      setCopied('error');
      window.setTimeout(() => setCopied(''), 2200);
    }
  }

  async function apply(styleId: string) {
    if (applyLock.current) return;
    applyLock.current = true;
    setApplying(styleId);
    setApplyError('');
    try {
      await onUseInStudio(styleId);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : '模板载入失败, 请重试');
    } finally {
      applyLock.current = false;
      setApplying('');
    }
  }
  const groupCount = (name: string) =>
    name === '全部' ? STITCH_STYLES.length : STITCH_STYLES.filter((s) => s.group === name).length;

  return (
    <div className="stitch-page w-full bg-surface">
      <section className="w-full px-gutter-canvas pt-space-lg pb-space-md">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-lg">
          <div>
            <div className="flex items-center gap-2 mb-space-2xs text-secondary">
              <StitchIcon name="palette" size={18} />
              <span className="font-meta-sm text-meta-sm tracking-wider uppercase font-medium">
                灵感画风 · 开源整理 · {STITCH_STYLES.length} 个预设
              </span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
              灵感画风库 · 风格与创作模板
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-4xl mt-1 leading-relaxed">
              从开源创作案例中整理画风, 涵盖纸本插画, 摄影, 三维微缩与视觉设计. {target === 'series' ? '可复制完整中文模板, 或为当前系列选用统一画风.' : '可复制完整中文模板, 或发送到单图创作后编辑使用.'}
            </p>
          </div>
        </div>
      </section>
      <section className="stitch-style-filters w-full px-gutter-canvas py-space-xs sticky top-16 z-30 bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(85,95,75,0.04)]">
        <div className="flex flex-col gap-space-xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-xs">
            <div className="relative flex-1 max-w-2xl">
              <StitchIcon
                name="search"
                size={20}
                className="absolute left-space-md top-1/2 -translate-y-1/2 text-on-surface-variant"
              />
              <input
                ref={inputRef}
                aria-label="搜索风格"
                className="w-full pl-11 pr-16 py-2 rounded-xl bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant/60 font-body-md text-body-md focus:bg-surface-container-lowest transition-all shadow-sm"
                placeholder="搜索风格、流派、材质、调色或艺术家..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded bg-surface-container font-meta-sm text-meta-sm text-on-surface-variant hidden sm:inline-block">
                ⌘ K
              </span>
            </div>
            <div className="flex items-center gap-space-xs self-end lg:self-auto">
              <div className="flex items-center p-1 rounded-xl bg-surface-container-low">
                {(
                  [
                    { id: 'all', name: '全览', icon: 'view_quilt' },
                    { id: 'handmade', name: '手作质感', icon: 'brush' },
                    { id: 'photo', name: '摄影光影', icon: 'photo_camera' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                    className={`px-2.5 py-1 rounded-lg font-body-sm text-body-sm transition-all flex items-center gap-1 ${filter === item.id ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
                  >
                    <StitchIcon name={item.icon} size={16} className={filter === item.id ? 'text-primary' : ''} />
                    {item.name}
                  </button>
                ))}
              </div>
              <div className="flex items-center p-0.5 rounded-xl bg-surface-container-low">
                {[false, true].map((dense) => (
                  <button
                    key={String(dense)}
                    type="button"
                    aria-label={dense ? '精简密格' : '舒适网格'}
                    aria-pressed={compact === dense}
                    onClick={() => setCompact(dense)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${compact === dense ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
                  >
                    <StitchIcon name={dense ? 'view_module' : 'grid_view'} size={18} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="relative flex items-center w-full">
            <div ref={categoriesRef} className="flex items-center gap-2 overflow-x-auto py-1 w-full pr-12">
              {['全部', ...STITCH_STYLE_GROUPS].map((name) => (
                <button
                  type="button"
                  key={name}
                  aria-pressed={group === name}
                  onClick={() => setGroup(name)}
                  className={`px-3 py-1.5 rounded-xl font-body-sm text-body-sm transition-all shrink-0 flex items-center gap-1.5 ${group === name ? 'bg-primary text-on-primary font-medium shadow-sm' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'}`}
                >
                  <span>{name}</span>
                  <span className="font-meta-sm text-meta-sm opacity-80">{groupCount(name)}</span>
                </button>
              ))}
            </div>
            <div className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none pl-6 pr-0.5">
              <button
                type="button"
                aria-label="更多风格分类"
                className="pointer-events-auto w-7 h-7 rounded-full bg-surface-container-lowest shadow-md flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all"
                onClick={() => categoriesRef.current?.scrollBy({ left: 250, behavior: 'smooth' })}
              >
                <StitchIcon name="chevron_right" size={16} />
              </button>
            </div>
          </div>
        </div>
      </section>
      <main className="w-full px-gutter-canvas py-space-md">
        <div
          className={`grid grid-cols-1 md:grid-cols-2 ${compact ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-space-lg`}
        >
          {filtered.map((style) => (
            <article
              key={style.id}
              className="group rounded-2xl bg-surface-container-lowest p-space-md shadow-[0_4px_20px_rgba(85,95,75,0.06)] hover:shadow-[0_12px_32px_rgba(85,95,75,0.12)] transition-all duration-300 flex flex-col justify-between"
            >
              <div>
                <div
                  className={`relative w-full ${compact ? 'h-44' : 'h-64'} rounded-xl overflow-hidden bg-surface-container-low mb-space-md`}
                >
                  <button
                    type="button"
                    aria-label={`查看 ${style.name} 详情`}
                    className="w-full h-full text-left"
                    onClick={() => setDetail(style)}
                  >
                    {style.image ? (
                      <img
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                        src={style.image}
                        alt={style.name}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-primary">
                        <StitchIcon name="palette" size={40} />
                        <span className="font-headline-sm text-headline-sm">{style.name}</span>
                      </div>
                    )}
                  </button>
                  <div
                    className={`absolute top-3 left-3 px-2.5 py-1 rounded-full bg-surface/90 backdrop-blur-md font-meta-sm text-meta-sm font-medium flex items-center gap-1 shadow-sm pointer-events-none ${style.id === 'open-15563' ? 'text-primary' : 'text-on-surface'}`}
                  >
                    {style.id === 'open-15563' ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    ) : (
                      <StitchIcon name={style.icon} size={14} className="text-primary" />
                    )}
                    <span>{style.eyebrow}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`放大 ${style.name}`}
                    className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-surface-bright/95 backdrop-blur-md flex items-center justify-center text-on-surface hover:bg-primary hover:text-on-primary shadow-md transition-all"
                    onClick={() => setDetail(style)}
                  >
                    <StitchIcon name="fullscreen" size={18} />
                  </button>
                </div>
                <div className="flex items-baseline justify-between mb-1 gap-2">
                  <h3 className="font-headline-sm text-headline-sm text-on-surface">{style.name}</h3>
                  <span
                    className="font-meta-sm text-meta-sm text-secondary font-medium shrink-0"
                    title="模板来源"
                  >
                    {style.source.license}
                  </span>
                </div>
                <p className="font-meta-sm text-meta-sm text-on-surface-variant font-normal mb-space-xs">
                  {style.englishName}
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-2 mb-space-md">
                  {style.template}
                </p>
                <div className="flex flex-wrap gap-1.5 mb-space-lg">
                  {style.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-1 rounded-lg bg-surface-container-low text-on-surface-variant font-meta-sm text-meta-sm"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="pt-space-sm bg-surface-container-lowest flex items-center gap-space-xs">
                <button
                  type="button"
                  className="flex-1 py-2 px-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-body-sm text-body-sm font-medium transition-colors flex items-center justify-center gap-1.5"
                  onClick={() => {
                    void copy(style);
                  }}
                >
                  <StitchIcon name="content_copy" size={16} className="text-primary" />
                  {copied === style.id ? '已复制' : '复制模板'}
                </button>
                <button
                  type="button"
                  className="flex-1 py-2 px-3 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-medium transition-all shadow-sm flex items-center justify-center gap-1.5"
                  disabled={Boolean(applying)}
                  onClick={() => void apply(style.id)}
                >
                  {applying === style.id ? '载入中...' : applyLabel}
                  <StitchIcon name="north_east" size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="py-space-2xl text-center text-on-surface-variant">没有匹配的风格, 可清空搜索或切换分类.</p>
        )}
        <p className="mt-space-xl font-meta-sm text-meta-sm text-on-surface-variant">
          来源: <a className="text-primary hover:underline" href={STYLE_ATTRIBUTION.source} target="_blank" rel="noreferrer">awesome-gptimage2-prompts</a>.
          原始整理: YouMind OpenLab. 许可: CC BY 4.0. 名称和模板已中文化, 分类和画风已适配, 示例图已缩放.
          <a className="text-primary hover:underline ml-2" href="/assets/styles/ATTRIBUTION.txt" target="_blank" rel="noreferrer">完整署名说明</a>
        </p>
      </main>
      {detail && (
        <div
          className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-md flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`风格详情 ${detail.name}`}
          onClick={() => setDetail(null)}
        >
          <div
            ref={dialogRef}
            className="relative w-full max-w-4xl bg-surface rounded-2xl shadow-[0_24px_60px_rgba(85,95,75,0.22)] overflow-hidden flex flex-col md:flex-row max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-surface-container-high/80 hover:bg-surface-container-highest flex items-center justify-center text-on-surface"
              onClick={() => setDetail(null)}
              aria-label="关闭详情"
            >
              <StitchIcon name="close" size={18} />
            </button>
            <div className="w-full md:w-1/2 h-60 md:h-auto relative bg-surface-container-low shrink-0">
              {detail.image ? (
                <img className="w-full h-full object-cover" src={detail.image} alt={detail.name} />
              ) : (
                <div className="h-full min-h-60 flex items-center justify-center text-primary">
                  <StitchIcon name="palette" size={48} />
                </div>
              )}
            </div>
            <div className="w-full md:w-1/2 p-space-lg overflow-y-auto flex flex-col gap-space-md">
              <span className="self-start px-2.5 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-meta-sm text-meta-sm">
                {detail.group}
              </span>
              <div>
                <h2 className="font-headline-lg text-headline-lg">{detail.name}</h2>
                <p className="font-meta-sm text-meta-sm text-secondary mt-1">{detail.englishName}</p>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">{detail.description}</p>
              <div className="grid grid-cols-3 gap-2">
                {detail.tags.map((tag) => (
                  <span
                    key={tag}
                    className="p-2 rounded-lg bg-surface-container-low text-center font-meta-sm text-meta-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div>
                <p className="font-meta-sm text-meta-sm text-on-surface-variant mb-1">
                  中文提示词模板
                </p>
                <p className="p-space-md rounded-xl bg-surface-container-low font-meta-sm text-meta-sm leading-relaxed whitespace-pre-wrap">
                  {detail.template}
                </p>
              </div>
              <p className="font-meta-sm text-meta-sm text-outline">
                示例作者: {detail.source.author}. 画风已整理为可复用预设, 示例效果受提示词和参考图影响.
              </p>
              <div className="flex flex-wrap gap-3 font-meta-sm text-meta-sm text-primary">
                <a href={detail.source.url} target="_blank" rel="noreferrer">查看原始作品</a>
                <a href={STYLE_ATTRIBUTION.source} target="_blank" rel="noreferrer">开源提示词集</a>
                <a href={STYLE_ATTRIBUTION.license} target="_blank" rel="noreferrer">CC BY 4.0</a>
              </div>
              <div className="flex gap-2 mt-auto">
                <button
                  type="button"
                  className="flex-1 py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high font-body-sm text-body-sm"
                  onClick={() => {
                    void copy(detail);
                  }}
                >
                  {copied === detail.id ? '已复制' : '复制模板'}
                </button>
                <button
                  type="button"
                  className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm"
                  disabled={Boolean(applying)}
                  onClick={() => void apply(detail.id)}
                >
                  {applying === detail.id ? '载入中...' : applyLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ToastStack
        toasts={[
          ...(copied === 'error' ? [{ id: 'copy-error', type: 'error' as const, message: '复制失败, 请重试.' }] : []),
          ...(applyError ? [{ id: 'apply-error', type: 'error' as const, message: applyError }] : []),
        ]}
      />
    </div>
  );
}
