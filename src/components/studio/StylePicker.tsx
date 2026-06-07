import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ADVANCED_IMAGE_STYLES, ADVANCED_STYLE_GROUPS, BASIC_IMAGE_STYLES, BASIC_STYLE_GROUPS, type AdvancedImageStylePreset, type AnyImageStylePreset, type ImageStylePreset } from '../../lib/styles/image-styles';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Button } from '../ui/Button';

interface StylePickerProps {
  selected: AnyImageStylePreset | null;
  onChange: (style: AnyImageStylePreset | null) => void;
}

function matchesQuery(style: ImageStylePreset, query: string) {
  if (!query.trim()) return true;
  const value = query.trim().toLowerCase();
  return [style.name, style.englishName, style.description, style.group].some((item) => item.toLowerCase().includes(value));
}

function matchesAdvancedQuery(style: AdvancedImageStylePreset, query: string) {
  if (!query.trim()) return true;
  const value = query.trim().toLowerCase();
  return [style.name, style.englishName, style.description, style.usage, style.group].some((item) => item.toLowerCase().includes(value));
}

export function StylePicker({ selected, onChange }: StylePickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'basic' | 'advanced'>('basic');
  const [query, setQuery] = useState('');
  const [previewStyle, setPreviewStyle] = useState<AdvancedImageStylePreset | null>(null);
  const modalPanelRef = useFocusTrap<HTMLDivElement>(open && !previewStyle);
  const examplePanelRef = useFocusTrap<HTMLDivElement>(Boolean(previewStyle));
  const filtered = useMemo(() => BASIC_IMAGE_STYLES.filter((style) => matchesQuery(style, query)), [query]);
  const filteredAdvanced = useMemo(() => ADVANCED_IMAGE_STYLES.filter((style) => matchesAdvancedQuery(style, query)), [query]);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (previewStyle) {
        setPreviewStyle(null);
        return;
      }
      setPreviewStyle(null);
      setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, previewStyle]);

  function closePicker() {
    setPreviewStyle(null);
    setOpen(false);
  }

  function choose(style: AnyImageStylePreset) {
    onChange(style);
    closePicker();
  }

  const modal = open ? createPortal(
    <div className="style-modal" role="dialog" aria-modal="true" aria-label="选择图片风格">
      <button className="style-modal-backdrop" aria-label="关闭风格选择" onClick={closePicker} />
      <div ref={modalPanelRef} className="style-modal-panel">
        <div className="style-modal-heading">
          <div>
            <span className="eyebrow">Style</span>
            <h2>选择图片风格</h2>
            <p>风格不会改写输入框, 只会在提交时自动追加到提示词.</p>
          </div>
          <Button variant="ghost" onClick={closePicker}><X size={16} />关闭</Button>
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
          <div className="style-groups advanced-style-groups">
            <label className="style-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索: 人像, 香水, 电商, 角色..." autoFocus />
            </label>
            {ADVANCED_STYLE_GROUPS.map((group) => {
              const styles = filteredAdvanced.filter((style) => style.group === group);
              if (!styles.length) return null;
              return (
                <section className="style-group" key={group}>
                  <h3>{group}</h3>
                  <div className="advanced-style-grid">
                    {styles.map((style) => (
                      <article key={style.id} className={`advanced-style-card ${selected?.id === style.id ? 'active' : ''}`}>
                        {style.exampleImage && <button className="advanced-style-thumb" onClick={() => setPreviewStyle(style)}><img src={style.exampleImage} alt={style.exampleAlt || style.name} /></button>}
                        <div className="advanced-style-content">
                          <span className="eyebrow">{style.group}{style.requiresReference ? ' · 需参考图' : ''}</span>
                          <strong>{style.name}</strong>
                          <p>{style.description}</p>
                          <small>{style.usage}</small>
                        </div>
                        <div className="advanced-style-actions">
                          {style.exampleImage && <Button variant="ghost" onClick={() => setPreviewStyle(style)}>查看示例</Button>}
                          <Button onClick={() => choose(style)}>{selected?.id === style.id ? '已选择' : '选择'}</Button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
            {!filteredAdvanced.length && <div className="empty-state">没有匹配的高级风格.</div>}
          </div>
        )}
      </div>
      {previewStyle?.exampleImage && (
        <div className="style-example-viewer" role="dialog" aria-modal="true" aria-label="高级风格示例图">
          <button className="style-example-backdrop" aria-label="关闭示例图" onClick={() => setPreviewStyle(null)} />
          <div ref={examplePanelRef} className="style-example-panel">
            <div className="style-example-heading">
              <div><span className="eyebrow">Example</span><h2>{previewStyle.name}</h2></div>
              <Button variant="ghost" onClick={() => setPreviewStyle(null)}><X size={16} />关闭</Button>
            </div>
            <img src={previewStyle.exampleImage} alt={previewStyle.exampleAlt || previewStyle.name} />
          </div>
        </div>
      )}
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
