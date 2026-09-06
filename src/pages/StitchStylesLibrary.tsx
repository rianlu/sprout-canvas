import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Maximize2, Palette, Search, X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { readDraft, writeDraft } from '../lib/storage/drafts';
import {
  ADVANCED_IMAGE_STYLES,
  ADVANCED_STYLE_GROUPS,
  BASIC_IMAGE_STYLES,
  BASIC_STYLE_GROUPS,
  type AdvancedImageStylePreset,
  type ImageStylePreset,
} from '../lib/styles/image-styles';

type AnyStyle = ImageStylePreset | AdvancedImageStylePreset;
import { ToastStack } from '../components/shell/QueueDrawer';

/* ============ 风格库 (照搬 Stitch 风格库稿, 类名原样) ============ */

interface StylesLibraryProps {
  onUseInStudio: (styleId: string) => void;
}

export function StylesLibrary({ onUseInStudio }: StylesLibraryProps) {
  const [tab, setTab] = useState<'basic' | 'advanced'>(() => (readDraft('style_tab') as 'basic' | 'advanced') || 'basic');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('全部');
  const [copiedId, setCopiedId] = useState('');
  const [detail, setDetail] = useState<AnyStyle | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const detailDialogRef = useFocusTrap<HTMLDivElement>(detail !== null);

  const groups = tab === 'basic' ? BASIC_STYLE_GROUPS : ADVANCED_STYLE_GROUPS;
  const allStyles = tab === 'basic' ? BASIC_IMAGE_STYLES : ADVANCED_IMAGE_STYLES;

  // ⌘K 聚焦搜索
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Esc 关闭灯箱
  useEffect(() => {
    if (!detail) return undefined;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setDetail(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  useEffect(() => { writeDraft('style_tab', tab); }, [tab]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allStyles.filter((style) => {
      if (group !== '全部' && style.group !== group) return false;
      if (!query) return true;
      const haystack = [style.name, style.englishName, style.description, style.group];
      return haystack.some((value) => value.toLowerCase().includes(query));
    });
  }, [allStyles, group, search]);

  function promptText(style: AnyStyle) {
    return 'template' in style ? style.template : style.prompt;
  }

  function exampleImageOf(style: AnyStyle): string | undefined {
    return 'exampleImage' in style ? style.exampleImage : undefined;
  }

  async function copyPrompt(style: AnyStyle) {
    try {
      await navigator.clipboard.writeText(promptText(style));
      setCopiedId(style.id);
      window.setTimeout(() => setCopiedId(''), 1600);
    } catch { /* ignore */ }
  }

  const groupCount = (name: string) => name === '全部' ? allStyles.length : allStyles.filter((s) => s.group === name).length;

  return (
    <main className="w-full pt-16 bg-surface min-h-[calc(100vh-4rem)]">
      {/* Header Banner */}
      <section className="w-full px-gutter-canvas pt-space-lg pb-space-md">
        <div className="max-w-[1720px] mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-lg">
            <div>
              <div className="flex items-center gap-2 mb-space-2xs text-secondary">
                <Palette size={18} aria-hidden />
                <span className="font-meta-sm text-meta-sm tracking-wider uppercase font-medium">自然心流 · 风格预设 · {allStyles.length} 款原生画风</span>
              </div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">自然生机画风库 · 艺术画风与质感</h1>
              <p className="font-body-md text-body-md text-on-surface-variant max-w-4xl mt-1 leading-relaxed">精选矿物颜料、手作纸质与植物光影肌理，一键固化画面风格与质感基底，赋予作品呼吸般的自然温润感。</p>
            </div>
            {/* 基础/高级 tab */}
            <div className="flex items-center gap-1 p-1 bg-surface-container-low rounded-xl">
              <button type="button" className={tab === 'basic' ? 'px-space-md py-1.5 rounded-lg bg-primary text-on-primary font-medium font-body-sm text-body-sm' : 'px-space-md py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface font-body-sm text-body-sm transition-colors'} onClick={() => { setTab('basic'); setGroup('全部'); }}>基础风格</button>
              <button type="button" className={tab === 'advanced' ? 'px-space-md py-1.5 rounded-lg bg-primary text-on-primary font-medium font-body-sm text-body-sm' : 'px-space-md py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface font-body-sm text-body-sm transition-colors'} onClick={() => { setTab('advanced'); setGroup('全部'); }}>高级质感</button>
            </div>
          </div>
        </div>
      </section>

      {/* Search & Filter (sticky) */}
      <section className="w-full px-gutter-canvas py-space-xs sticky top-16 z-30 bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(85,95,75,0.04)]">
        <div className="max-w-[1720px] mx-auto flex flex-col gap-space-xs">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center bg-surface-container-low rounded-xl px-space-sm py-2 gap-2 border border-outline-variant/30 focus-within:border-primary/50 transition-colors">
              <Search size={18} className="text-outline shrink-0" aria-hidden />
              <input
                ref={searchInputRef}
                className="flex-1 bg-transparent outline-none font-body-sm text-body-sm text-on-surface placeholder:text-outline"
                placeholder="搜索风格名称、英文关键词或画面质感..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button type="button" className="text-outline hover:text-on-surface transition-colors" onClick={() => setSearch('')} aria-label="清空搜索">
                  <X size={16} aria-hidden />
                </button>
              )}
              <span className="font-meta-sm text-[10px] text-outline border border-outline-variant/30 rounded px-1.5 py-0.5 shrink-0">⌘K</span>
            </div>
          </div>
          {/* 分类胶囊 */}
          <div className="relative flex items-center w-full">
            <div className="flex items-center gap-2 overflow-x-auto py-1 w-full scrollbar-none">
              {['全部', ...groups].map((name) => {
                const active = group === name;
                return (
                  <button
                    key={name}
                    type="button"
                    className={active
                      ? 'px-3.5 py-1.5 rounded-xl bg-primary text-on-primary font-body-sm text-body-sm font-medium shadow-sm transition-all shrink-0 flex items-center gap-1.5'
                      : 'px-3 py-1.5 rounded-xl bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high font-body-sm text-body-sm transition-all shrink-0 flex items-center gap-1.5'}
                    onClick={() => setGroup(name)}
                  >
                    <span>{name}</span>
                    <span className={active ? 'text-on-primary/80 font-meta-sm text-meta-sm' : 'font-meta-sm text-meta-sm'}>{groupCount(name)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* 卡片网格 */}
      <section className="w-full px-gutter-canvas py-space-lg">
        <div className="max-w-[1720px] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-lg">
            {filtered.map((style, index) => (
              <article key={style.id} className={`group rounded-2xl bg-surface-container-lowest p-space-md shadow-[0_4px_20px_rgba(85,95,75,0.06)] hover:shadow-[0_12px_32px_rgba(85,95,75,0.12)] transition-all duration-300 flex flex-col justify-between ${index === 0 && !search && group === '全部' ? 'ring-1 ring-primary/30' : ''}`}>
                <div>
                  {/* 图框 (示例图或植物色占位) */}
                  <div className="relative w-full h-64 rounded-xl overflow-hidden bg-surface-container-low mb-space-md cursor-pointer" onClick={() => setDetail(style)}>
                    {exampleImageOf(style)
                      ? <img className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out" src={exampleImageOf(style)} alt={style.name} loading="lazy" />
                      : <div className="w-full h-full bg-gradient-to-tr from-surface-container via-surface-container-low to-secondary-fixed-dim/20 flex items-center justify-center">
                          <span className="font-headline-sm text-headline-sm text-on-surface-variant/60">{style.englishName}</span>
                        </div>}
                    {index === 0 && !search && group === '全部' && (
                      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-surface/90 backdrop-blur-md font-meta-sm text-meta-sm text-primary font-medium flex items-center gap-1 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        <span>主理人精选 · 特别推介</span>
                      </div>
                    )}
                    <button type="button" className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-surface-bright/95 backdrop-blur-md flex items-center justify-center text-on-surface hover:bg-primary hover:text-on-primary shadow-md transition-all" onClick={(event) => { event.stopPropagation(); setDetail(style); }} aria-label={`查看 ${style.name} 详情`}>
                      <Maximize2 size={18} aria-hidden />
                    </button>
                  </div>
                  {/* 头部信息 */}
                  <div className="flex items-baseline justify-between mb-1">
                    <h3 className="font-headline-sm text-headline-sm text-on-surface">{style.name}</h3>
                    <span className="font-meta-sm text-meta-sm text-secondary font-medium">{style.group}</span>
                  </div>
                  <p className="font-meta-sm text-meta-sm text-on-surface-variant font-normal mb-space-md">{style.englishName} · {style.description}</p>
                </div>
                {/* 动作 */}
                <div className="flex items-center gap-2">
                  <button type="button" className="flex-1 py-2 rounded-xl bg-primary/90 hover:bg-primary text-on-primary font-body-sm text-body-sm font-medium shadow-sm transition-colors flex items-center justify-center gap-1.5" onClick={() => onUseInStudio(style.id)}>
                    以此风格创作
                  </button>
                  <button type="button" className="w-10 h-10 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface flex items-center justify-center transition-colors shrink-0" title="复制提示词" onClick={() => { void copyPrompt(style); }}>
                    <Copy size={16} aria-hidden />
                  </button>
                </div>
                {copiedId === style.id && (
                  <p className="font-meta-sm text-meta-sm text-primary text-center mt-2">已复制核心提示词</p>
                )}
              </article>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full py-space-xl text-center text-on-surface-variant font-body-sm text-body-sm">
                没有找到匹配的风格，换个关键词试试
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 详情灯箱 (照搬 modal) */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`风格详情 ${detail.name}`}>
          <div ref={detailDialogRef} className="relative w-full max-w-4xl bg-surface rounded-2xl shadow-[0_24px_60px_rgba(85,95,75,0.22)] overflow-hidden flex flex-col md:flex-row max-h-[90vh]">
            <button type="button" className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-surface-container-high/80 hover:bg-surface-container-highest flex items-center justify-center text-on-surface transition-colors" onClick={() => setDetail(null)} aria-label="关闭详情">
              <X size={18} aria-hidden />
            </button>
            {/* 图列 */}
            <div className="w-full md:w-1/2 h-72 md:h-auto relative bg-surface-container-low">
              {exampleImageOf(detail)
                ? <img className="w-full h-full object-cover" src={exampleImageOf(detail)} alt={detail.name} />
                : <div className="w-full h-full bg-gradient-to-tr from-surface-container via-surface-container-low to-secondary-fixed-dim/20 flex items-center justify-center"><span className="font-headline-sm text-headline-sm text-on-surface-variant/60">{detail.englishName}</span></div>}
              <div className="absolute bottom-4 left-4 right-4 px-space-md py-space-xs rounded-xl bg-surface/90 backdrop-blur-md shadow-sm flex items-center justify-between text-on-surface">
                <span className="font-meta-sm text-meta-sm">{detail.englishName}</span>
                <span className="font-meta-sm text-meta-sm text-primary font-medium">{detail.group}</span>
              </div>
            </div>
            {/* 信息列 */}
            <div className="w-full md:w-1/2 p-space-lg overflow-y-auto flex flex-col justify-between gap-space-md">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-meta-sm text-meta-sm font-medium">{detail.group}</span>
                </div>
                <h2 className="font-headline-lg text-headline-lg text-on-surface mb-1">{detail.name}</h2>
                <p className="font-meta-sm text-meta-sm text-secondary mb-space-md">{detail.englishName} — {detail.description}</p>
                {/* Prompt 公式 */}
                <div className="mb-space-md">
                  <label className="block font-meta-sm text-meta-sm text-on-surface-variant mb-1 font-medium">核心提示词模版 (Prompt Formula)</label>
                  <div className="p-space-md rounded-xl bg-surface-container-low text-on-surface font-meta-sm text-meta-sm leading-relaxed relative group">
                    <span>{promptText(detail)}</span>
                    <button type="button" className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-surface-container-lowest/90 hover:bg-surface-container text-on-surface flex items-center justify-center transition-colors" onClick={() => { void copyPrompt(detail); }} aria-label="复制提示词">
                      <Copy size={14} aria-hidden />
                    </button>
                  </div>
                </div>
                {/* 参数配方 (从 prompt 提取要点展示) */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-xl bg-surface-container-low/60">
                    <p className="font-meta-sm text-meta-sm text-outline mb-0.5">画面主语言</p>
                    <p className="font-body-sm text-body-sm text-on-surface font-medium">{/[a-zA-Z]/.test(promptText(detail).slice(0, 10)) ? '英文关键词' : '中文描述'}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-surface-container-low/60">
                    <p className="font-meta-sm text-meta-sm text-outline mb-0.5">适用模式</p>
                    <p className="font-body-sm text-body-sm text-on-surface font-medium">文生图 / 图生图</p>
                  </div>
                </div>
              </div>
              {/* 底部动作 */}
              <div className="flex items-center gap-2">
                <button type="button" className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-medium shadow-sm transition-colors" onClick={() => { onUseInStudio(detail.id); setDetail(null); }}>
                  以此风格创作
                </button>
                <button type="button" className="px-space-md py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface font-body-sm text-body-sm transition-colors" onClick={() => { void copyPrompt(detail); }}>
                  复制 Prompt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
