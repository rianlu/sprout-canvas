import { useMemo, useState } from 'react';
import { Check, Copy, Palette, Search, Wand2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import {
  BASIC_IMAGE_STYLES,
  BASIC_STYLE_GROUPS,
  type ImageStylePreset,
} from '../lib/styles/image-styles';

interface StylesLibraryProps {
  onUseInStudio: (styleId?: string) => void;
}

export function StylesLibrary({ onUseInStudio }: StylesLibraryProps) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string>('全部');
  const [copiedId, setCopiedId] = useState('');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return BASIC_IMAGE_STYLES.filter((style) => {
      if (group !== '全部' && style.group !== group) return false;
      if (!query) return true;
      return style.name.toLowerCase().includes(query)
        || style.englishName.toLowerCase().includes(query)
        || style.description.toLowerCase().includes(query)
        || style.prompt.toLowerCase().includes(query);
    });
  }, [search, group]);

  async function copyPrompt(style: ImageStylePreset) {
    try {
      await navigator.clipboard.writeText(style.prompt);
      setCopiedId(style.id);
      window.setTimeout(() => setCopiedId(''), 1500);
    } catch { /* 剪贴板不可用时静默 */ }
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
          <input type="text" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索风格名、描述或提示词..." aria-label="搜索风格" />
          <span className="kbd-hint" aria-hidden="true">Ctrl K</span>
        </div>
      </div>

      <div className="styles-groups-bar">
        <button type="button" className={`filter-pill ${group === '全部' ? 'active' : ''}`} onClick={() => setGroup('全部')}>
          全部 <span className="count">{BASIC_IMAGE_STYLES.length}</span>
        </button>
        {BASIC_STYLE_GROUPS.map((groupName) => (
          <button key={groupName} type="button" className={`filter-pill ${group === groupName ? 'active' : ''}`} onClick={() => setGroup(groupName)}>
            {groupName} <span className="count">{BASIC_IMAGE_STYLES.filter((style) => style.group === groupName).length}</span>
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
            <article key={style.id} className="style-card">
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
              <div className="style-card-foot">
                <Button variant="ghost" className="btn-sm" onClick={() => { void copyPrompt(style); }}>
                  {copiedId === style.id ? <Check size={14} /> : <Copy size={14} />}
                  {copiedId === style.id ? '已复制' : '复制提示词'}
                </Button>
                <Button variant="primary" className="btn-sm" onClick={() => onUseInStudio(style.id)}>
                  <Wand2 size={14} />
                  发送到创作台
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
