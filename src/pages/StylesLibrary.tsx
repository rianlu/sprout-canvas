import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Palette, Search, Wand2, X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { writeDraft } from '../lib/storage/drafts';
import {
  ADVANCED_IMAGE_STYLES,
  ADVANCED_STYLE_GROUPS,
  BASIC_IMAGE_STYLES,
  BASIC_STYLE_GROUPS,
  type AnyImageStylePreset,
} from '../lib/styles/image-styles';

interface StylesLibraryProps {
  /** 选中并发送到创作台: 持久化到草稿并跳页 */
  onUseInStudio: (styleId?: string) => void;
}

type StyleTab = 'basic' | 'advanced';

interface StyleDetailState {
  style: AnyImageStylePreset;
}

export function StylesLibrary({ onUseInStudio }: StylesLibraryProps) {
  const [tab, setTab] = useState<StyleTab>('basic');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('全部');
  const [copiedId, setCopiedId] = useState('');
  const [detail, setDetail] = useState<StyleDetailState | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const detailDialogRef = useFocusTrap<HTMLDivElement>(detail !== null);

  const groups = tab === 'basic' ? BASIC_STYLE_GROUPS : ADVANCED_STYLE_GROUPS;
  const allStyles = tab === 'basic' ? BASIC_IMAGE_STYLES : ADVANCED_IMAGE_STYLES;

  // Ctrl/Cmd+K 聚焦搜索
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

  // ESC 关闭灯箱
  useEffect(() => {
    if (!detail) return undefined;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setDetail(null); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detail]);

  // 切 tab 时重置分组
  useEffect(() => { setGroup('全部'); }, [tab]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allStyles.filter((style) => {
      if (group !== '全部' && style.group !== group) return false;
      if (!query) return true;
      const haystack = [style.name, style.englishName, style.description, style.group];
      if ('usage' in style) haystack.push(style.usage);
      return haystack.join(' ').toLowerCase().includes(query);
    });
  }, [allStyles, group, search]);

  function promptText(style: AnyImageStylePreset) {
    return 'template' in style ? style.template : style.prompt;
  }

  async function copyPrompt(style: AnyImageStylePreset) {
    try {
      await navigator.clipboard.writeText(promptText(style));
      setCopiedId(style.id);
      window.setTimeout(() => setCopiedId(''), 1500);
    } catch { /* 剪贴板不可用时静默 */ }
  }

  function useInStudio(style: AnyImageStylePreset) {
    writeDraft('studio_style', style.id);
    onUseInStudio(style.id);
  }

  return (
    <div className="styles-library-page">
      <header className="page-head">
        <div className="page-head-copy">
          <h1>风格库</h1>
          <p>浏览风格预设, 复制提示词或直接发送到创作台</p>
        </div>
      </header>

      <div className="styles-search-bar">
        <div className="styles-search">
          <Search className="search-icon" size={16} aria-hidden="true" />
          <input ref={searchInputRef} type="text" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索风格名、描述或提示词..." aria-label="搜索风格" />
          <span className="kbd-hint" aria-hidden="true">Ctrl K</span>
        </div>
        <div className="styles-type-tabs" role="tablist" aria-label="风格类型">
          <button type="button" role="tab" aria-selected={tab === 'basic'} className={tab === 'basic' ? 'active' : ''} onClick={() => setTab('basic')}>
            普通风格 <span className="count">{BASIC_IMAGE_STYLES.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'advanced'} className={tab === 'advanced' ? 'active' : ''} onClick={() => setTab('advanced')}>
            高级风格 <span className="count">{ADVANCED_IMAGE_STYLES.length}</span>
          </button>
        </div>
      </div>

      <div className="styles-groups-bar">
        <button type="button" className={`filter-pill ${group === '全部' ? 'active' : ''}`} onClick={() => setGroup('全部')}>
          全部 <span className="count">{allStyles.length}</span>
        </button>
        {groups.map((groupName) => (
          <button key={groupName} type="button" className={`filter-pill ${group === groupName ? 'active' : ''}`} onClick={() => setGroup(groupName)}>
            {groupName} <span className="count">{allStyles.filter((style) => style.group === groupName).length}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <Palette className="empty-icon" size={28} aria-hidden="true" />
          <strong>没有匹配的风格</strong>
          <span>换个关键词, 或清除筛选条件</span>
        </div>
      ) : (
        <div className="style-library-grid">
          {filtered.map((style) => (
            <article key={style.id} className="style-card" onClick={() => setDetail({ style })} tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter') setDetail({ style }); }} role="button"
              aria-label={`查看风格 ${style.name}`}>
              {'exampleImage' in style && style.exampleImage && (
                <div className="style-figure">
                  <img src={style.exampleImage} alt={style.exampleAlt || `${style.name} 示例图`} loading="lazy" />
                  <span className="figure-badge">高级</span>
                </div>
              )}
              <div className="style-card-body">
                <div className="name-row">
                  <h3>{style.name}</h3>
                  <span className="english">{style.englishName}</span>
                </div>
                <p className="desc">{style.description}</p>
                <div className="tag-row">
                  <span className="chip">{style.group}</span>
                </div>
              </div>
              <div className="style-card-foot" onClick={(event) => event.stopPropagation()}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void copyPrompt(style); }}>
                  {copiedId === style.id ? <Check size={14} /> : <Copy size={14} />}
                  {copiedId === style.id ? '已复制' : '复制提示词'}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => useInStudio(style)}>
                  <Wand2 size={14} />
                  发送到创作台
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {detail && (
        <div className="style-detail-overlay" role="dialog" aria-modal="true" aria-label={`风格详情 ${detail.style.name}`}>
          <button type="button" className="backdrop" onClick={() => setDetail(null)} aria-label="关闭详情" />
          <div ref={detailDialogRef} className="style-detail-panel">
            <button type="button" className="icon-btn" style={{ position: 'absolute', top: 12, right: 12, zIndex: 2 }} onClick={() => setDetail(null)} aria-label="关闭">
              <X size={16} />
            </button>
            <div className="style-detail-media">
              {'exampleImage' in detail.style && detail.style.exampleImage ? (
                <img src={detail.style.exampleImage} alt={detail.style.exampleAlt || `${detail.style.name} 示例图`} />
              ) : (
                <div className="empty-state" style={{ width: '100%' }}>
                  <Palette className="empty-icon" size={28} aria-hidden="true" />
                  <span>普通风格无示例图</span>
                </div>
              )}
            </div>
            <div className="style-detail-info">
              <div className="detail-head">
                <span className="chip chip-accent">{detail.style.group}</span>
                <h2>{detail.style.name}</h2>
                <span className="detail-english">{detail.style.englishName}</span>
              </div>
              <div className="prompt-template-block">
                <div className="block-label">
                  <span>{'template' in detail.style ? '提示词模板 ({主题} 为占位符)' : '提示词'}</span>
                  <button type="button" className="link-btn" onClick={() => { void copyPrompt(detail.style); }}>
                    {copiedId === detail.style.id ? <Check size={13} /> : <Copy size={13} />}复制
                  </button>
                </div>
                <code>{promptText(detail.style)}</code>
              </div>
              <div className="usage-note">
                <strong>用法</strong>
                <p>{'usage' in detail.style && detail.style.usage ? detail.style.usage : '追加到提示词末尾, 与主体描述搭配使用'}</p>
              </div>
              <div className="style-detail-actions">
                <button type="button" className="btn" onClick={() => setDetail(null)}>关闭预览</button>
                <button type="button" className="btn btn-primary" onClick={() => useInStudio(detail.style)}>
                  <Wand2 size={15} />载入并前往创作台
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
