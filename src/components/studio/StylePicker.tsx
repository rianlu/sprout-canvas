import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BASIC_IMAGE_STYLES, BASIC_STYLE_GROUPS, type ImageStylePreset } from '../../lib/styles/image-styles';
import { Button } from '../ui/Button';

interface StylePickerProps {
  selected: ImageStylePreset | null;
  onChange: (style: ImageStylePreset | null) => void;
}

function matchesQuery(style: ImageStylePreset, query: string) {
  if (!query.trim()) return true;
  const value = query.trim().toLowerCase();
  return [style.name, style.englishName, style.description, style.group].some((item) => item.toLowerCase().includes(value));
}

export function StylePicker({ selected, onChange }: StylePickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'basic' | 'advanced'>('basic');
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => BASIC_IMAGE_STYLES.filter((style) => matchesQuery(style, query)), [query]);

  function choose(style: ImageStylePreset) {
    onChange(style);
    setOpen(false);
  }

  const modal = open ? createPortal(
    <div className="style-modal" role="dialog" aria-modal="true" aria-label="选择图片风格">
      <button className="style-modal-backdrop" aria-label="关闭风格选择" onClick={() => setOpen(false)} />
      <div className="style-modal-panel">
        <div className="style-modal-heading">
          <div>
            <span className="eyebrow">Style</span>
            <h2>选择图片风格</h2>
            <p>风格不会改写输入框, 只会在提交时自动追加到提示词.</p>
          </div>
          <Button variant="ghost" onClick={() => setOpen(false)}><X size={16} />关闭</Button>
        </div>

        <div className="style-tabs" role="tablist" aria-label="风格类型">
          <button className={tab === 'basic' ? 'active' : ''} onClick={() => setTab('basic')}>普通风格</button>
          <button className={tab === 'advanced' ? 'active' : ''} onClick={() => setTab('advanced')}>高级风格</button>
        </div>

        {tab === 'basic' ? (
          <>
            <label className="style-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索: 动漫, 像素, cinematic..." autoFocus />
            </label>
            <div className="style-groups">
              {BASIC_STYLE_GROUPS.map((group) => {
                const styles = filtered.filter((style) => style.group === group);
                if (!styles.length) return null;
                return (
                  <section className="style-group" key={group}>
                    <h3>{group}</h3>
                    <div className="style-grid">
                      {styles.map((style) => (
                        <button key={style.id} className={`style-card ${selected?.id === style.id ? 'active' : ''}`} onClick={() => choose(style)}>
                          <strong>{style.name}</strong>
                          <span>{style.englishName}</span>
                          <small>{style.description}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
              {!filtered.length && <div className="empty-state">没有匹配的风格.</div>}
            </div>
          </>
        ) : (
          <div className="empty-state large">高级风格会放更场景化的模板, 比如电商主图, 小红书封面, 品牌 KV, 电影海报等.</div>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="style-picker-row" aria-label="风格选择">
      <div className="style-picker-summary">
        <span>风格</span>
        {selected ? (
          <strong>{selected.name}<small>{selected.englishName}</small></strong>
        ) : (
          <strong>未选择<small>提交时不额外注入风格</small></strong>
        )}
      </div>
      <div className="style-picker-actions">
        {selected && <Button variant="ghost" onClick={() => onChange(null)}><X size={14} />清除</Button>}
        <Button onClick={() => setOpen(true)}>选择风格</Button>
      </div>

      {modal}
    </section>
  );
}
