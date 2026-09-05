import { ArrowUpRight } from 'lucide-react';
import { useMemo } from 'react';
import { BASIC_IMAGE_STYLES } from '../../lib/styles/image-styles';

const QUICK_STYLE_IDS = ['watercolor', 'anime', 'photoreal', 'cinematic', 'minimal-line', '3d-render', 'ghibli-style', 'pixel-art'];

export function StyleQuickPicker({ styleId, onSelect, onOpenLibrary }: { styleId: string; onSelect: (styleId: string) => void; onOpenLibrary?: () => void }) {
  const quickStyles = useMemo(
    () => QUICK_STYLE_IDS.map((id) => BASIC_IMAGE_STYLES.find((style) => style.id === id)).filter(Boolean),
    [],
  );

  return (
    <div className="rail-section">
      <div className="rail-section-head">
        <span className="rail-title" style={{ fontSize: 'var(--fs-meta-md)', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>快捷风格</span>
        {onOpenLibrary && (
          <button type="button" className="link-btn t-meta" onClick={onOpenLibrary}>
            更多风格 <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="style-pills">
        {quickStyles.map((style) => (
          <button key={style!.id} type="button"
            className={`style-pill ${styleId === style!.id ? 'active' : ''}`}
            onClick={() => onSelect(styleId === style!.id ? '' : style!.id)}
            title={style!.description}>
            {style!.name}
          </button>
        ))}
      </div>
    </div>
  );
}
