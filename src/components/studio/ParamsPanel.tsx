import { Loader2, Settings2, Sparkles } from 'lucide-react';
import type { GenerationConfig } from '../../types/generation';
import { formatRequestSize, qualityLabel, sizeTierLabel } from '../../lib/api/generation';

const ASPECT_OPTIONS: Array<{ value: GenerationConfig['aspectRatio']; label: string; sub: string; w: number; h: number }> = [
  { value: '1:1', label: '1:1', sub: '1024×1024', w: 16, h: 16 },
  { value: '3:4', label: '3:4', sub: '768×1024', w: 12, h: 16 },
  { value: '4:3', label: '4:3', sub: '1024×768', w: 16, h: 12 },
  { value: '9:16', label: '9:16', sub: '1024×1792', w: 9, h: 16 },
  { value: '16:9', label: '16:9', sub: '1792×1024', w: 16, h: 9 },
  { value: '21:9', label: '21:9', sub: '2048×864', w: 21, h: 9 },
];

const EXTENDED_ASPECTS: Array<{ value: GenerationConfig['aspectRatio']; label: string; sub: string; w: number; h: number }> = [
  { value: '3:2', label: '3:2', sub: '1536×1024', w: 15, h: 10 },
  { value: '2:3', label: '2:3', sub: '1024×1536', w: 10, h: 15 },
];

const QUALITY_OPTIONS: Array<{ value: GenerationConfig['quality']; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '快速' },
  { value: 'medium', label: '标准' },
  { value: 'high', label: '精细' },
];

const FORMAT_OPTIONS: Array<{ value: GenerationConfig['outputFormat']; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'jpeg', label: 'JPEG' },
];

const COUNT_OPTIONS = [1, 2, 4];

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

interface ParamsPanelProps {
  config: GenerationConfig;
  onChange: (patch: Partial<GenerationConfig>) => void;
  onSubmit: () => void;
  submitting: boolean;
  promptEmpty: boolean;
  /** 系列页等场景隐藏内置提交按钮, 由外层提供 */
  hideSubmit?: boolean;
}

export function ParamsPanel({ config, onChange, onSubmit, submitting, promptEmpty, hideSubmit }: ParamsPanelProps) {
  const allAspects = [...ASPECT_OPTIONS, ...EXTENDED_ASPECTS, { value: 'auto' as const, label: 'auto', sub: '自动', w: 16, h: 10 }];
  const current = allAspects.find((option) => option.value === config.aspectRatio) || allAspects[0];

  return (
    <div className="param-section">
      <div className="param-card">
        <div className="param-card-title">
          <span className="title-icon"><Settings2 size={14} aria-hidden="true" />生图参数</span>
          <span className="param-name">{formatRequestSize(config.requestSize)}</span>
        </div>

        <div className="field-label" style={{ marginBottom: 8 }}>
          <span>画面比例</span>
          <span className="param-name">{current.label === 'auto' ? '由模型决定' : current.sub}</span>
        </div>
        <div className="ratio-grid">
          {allAspects.map((option) => (
            <button key={option.value} type="button"
              className={`ratio-card ${config.aspectRatio === option.value ? 'active' : ''}`}
              onClick={() => onChange({ aspectRatio: option.value })}>
              <span className="ratio-visual" style={{ width: option.w, height: option.h }} />
              <strong>{option.label}</strong>
              <small>{option.sub}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="param-card">
        <div className="field-label" style={{ marginBottom: 8 }}>
          <span>清晰度</span>
          <span className="param-name">{sizeTierLabel(config.sizeTier)}</span>
        </div>
        <div className="seg-control" role="radiogroup" aria-label="清晰度">
          <button type="button" role="radio" aria-checked={config.sizeTier === '1K'} className={config.sizeTier === '1K' ? 'active' : ''} onClick={() => onChange({ sizeTier: '1K' })}>1K</button>
          <button type="button" role="radio" aria-checked={config.sizeTier === '2K'} disabled title="上游能力待确认">2K</button>
          <button type="button" role="radio" aria-checked={config.sizeTier === '4K'} disabled title="上游能力待确认">4K</button>
        </div>
      </div>

      <div className="param-card">
        <div className="field-label" style={{ marginBottom: 8 }}>
          <span>生成质量</span>
          <span className="param-name">{qualityLabel(config.quality)}</span>
        </div>
        <div className="seg-control" role="radiogroup" aria-label="生成质量">
          {QUALITY_OPTIONS.map((option) => (
            <button key={option.value} type="button" role="radio" aria-checked={config.quality === option.value}
              className={config.quality === option.value ? 'active' : ''} onClick={() => onChange({ quality: option.value })}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="param-card">
        <div className="field-label" style={{ marginBottom: 8 }}>
          <span>生成数量</span>
          <span className="param-name">张</span>
        </div>
        <div className="seg-control" role="radiogroup" aria-label="生成数量">
          {COUNT_OPTIONS.map((count) => (
            <button key={count} type="button" role="radio" aria-checked={config.imageCount === count}
              className={config.imageCount === count ? 'active' : ''} onClick={() => onChange({ imageCount: count })}>
              {count}
            </button>
          ))}
        </div>
      </div>

      <details className="collapsible param-card">
        <summary>高级参数</summary>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div className="field-label" style={{ marginBottom: 8 }}>
              <span>输出格式</span>
              <span className="param-name">output_format</span>
            </div>
            <div className="seg-control" role="radiogroup" aria-label="输出格式">
              {FORMAT_OPTIONS.map((option) => (
                <button key={option.value} type="button" role="radio" aria-checked={config.outputFormat === option.value}
                  className={config.outputFormat === option.value ? 'active' : ''} onClick={() => onChange({ outputFormat: option.value })}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="field-label" style={{ marginBottom: 8 }}>
              <span>背景</span>
              <span className="param-name">background</span>
            </div>
            <div className="seg-control" role="radiogroup" aria-label="背景">
              <button type="button" role="radio" aria-checked={config.background === 'auto'} className={config.background === 'auto' ? 'active' : ''} onClick={() => onChange({ background: 'auto' })}>自动</button>
              <button type="button" role="radio" aria-checked={config.background === 'opaque'} className={config.background === 'opaque' ? 'active' : ''} onClick={() => onChange({ background: 'opaque' })}>不透明</button>
              <button type="button" role="radio" aria-checked={config.background === 'transparent'} className={config.background === 'transparent' ? 'active' : ''} onClick={() => onChange({ background: 'transparent' })}>透明</button>
            </div>
          </div>
          {(config.outputFormat === 'jpeg' || config.outputFormat === 'webp') && (
            <div>
              <div className="field-label" style={{ marginBottom: 8 }}>
                <span>压缩率</span>
                <span className="param-name">{config.outputCompression}</span>
              </div>
              <div className="brush-size-row" style={{ padding: '0 2px' }}>
                <input type="range" min={10} max={100} value={config.outputCompression}
                  onChange={(event) => onChange({ outputCompression: Number(event.target.value) })}
                  onBlur={(event) => onChange({ outputCompression: clampInt(Number(event.target.value), 10, 100, 90) })}
                  aria-label="压缩率" />
                <span className="size-value">{config.outputCompression}</span>
              </div>
            </div>
          )}
        </div>
      </details>

      {!hideSubmit && (
      <div className="rail-submit">
        <button type="button" className="generate-cta" onClick={onSubmit} disabled={submitting || promptEmpty}>
          {submitting ? (<><Loader2 className="spin" size={18} aria-hidden="true" />正在提交...</>) : (<><Sparkles size={18} aria-hidden="true" />开始绘制<span className="kbd">⌘ ↵</span></>)}
        </button>
      </div>
      )}
    </div>
  );
}
