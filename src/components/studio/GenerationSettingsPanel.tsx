import { Loader2 } from 'lucide-react';
import type { GenerationConfig } from '../../types/generation';
import { formatRequestSize, qualityLabel, sizeTierLabel } from '../../lib/api/generation';
import { Button } from '../ui/Button';

const ASPECT_RATIO_OPTIONS: Array<{ value: GenerationConfig['aspectRatio']; label: string }> = [
  { value: '1:1', label: '1:1 方图' },
  { value: '16:9', label: '16:9 横图' },
  { value: '9:16', label: '9:16 竖图' },
  { value: '4:3', label: '4:3 横版' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '3:2', label: '3:2 宽幅' },
  { value: '2:3', label: '2:3 长图' },
  { value: '21:9', label: '21:9 超宽' },
  { value: 'auto', label: '自动' },
];

const SIZE_TIER_OPTIONS: Array<{ value: GenerationConfig['sizeTier']; label: string; disabled?: boolean }> = [
  { value: '1K', label: '标准 1K' },
  { value: '2K', label: '高清 2K · 待确认', disabled: true },
  { value: '4K', label: '超清 4K · 待确认', disabled: true },
];

const QUALITY_OPTIONS: Array<{ value: GenerationConfig['quality']; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '快速' },
  { value: 'medium', label: '标准' },
  { value: 'high', label: '精细' },
];

interface GenerationSettingsPanelProps {
  config: GenerationConfig;
  onChange: (patch: Partial<GenerationConfig>) => void;
  onSubmit: () => void;
  submitting: boolean;
}

interface GenerationCoreSettingsProps {
  config: GenerationConfig;
  onChange: (patch: Partial<GenerationConfig>) => void;
  className?: string;
}

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function GenerationCoreSettings({ config, onChange, className = '' }: GenerationCoreSettingsProps) {
  return (
    <div className={`generation-core-settings ${className}`}>
      <div className="field-grid settings-grid core-settings-grid">
        <label className="field">
          <span>比例</span>
          <select value={config.aspectRatio} onChange={(event) => onChange({ aspectRatio: event.target.value as GenerationConfig['aspectRatio'] })}>
            {ASPECT_RATIO_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>清晰度</span>
          <select value={config.sizeTier} onChange={(event) => onChange({ sizeTier: event.target.value as GenerationConfig['sizeTier'] })}>
            {SIZE_TIER_OPTIONS.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>生成质量</span>
          <select value={config.quality} onChange={(event) => onChange({ quality: event.target.value as GenerationConfig['quality'] })}>
            {QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="settings-size-card" aria-live="polite">
          <span>实际尺寸</span>
          <strong>{formatRequestSize(config.requestSize)}</strong>
          <small>{sizeTierLabel(config.sizeTier)} · {qualityLabel(config.quality)}质量</small>
        </div>
      </div>
      <details className="advanced-settings inline-advanced">
        <summary>高级参数</summary>
        <div className="field-grid">
          <label className="field"><span>背景</span><select value={config.background} onChange={(event) => onChange({ background: event.target.value as GenerationConfig['background'] })}><option value="auto">自动</option><option value="opaque">不透明</option><option value="transparent">透明</option></select></label>
          <label className="field"><span>输出格式</span><select value={config.outputFormat} onChange={(event) => onChange({ outputFormat: event.target.value as GenerationConfig['outputFormat'] })}><option value="auto">自动</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
          <label className="field"><span>压缩率</span><input type="number" inputMode="numeric" min={10} max={100} value={config.outputCompression} onChange={(event) => { const n = Number(event.target.value); onChange({ outputCompression: Number.isFinite(n) ? n : 90 }); }} onBlur={(event) => onChange({ outputCompression: clampInt(Number(event.target.value), 10, 100, 90) })} /></label>
        </div>
      </details>
    </div>
  );
}

export function GenerationSettingsPanel({ config, onChange, onSubmit, submitting }: GenerationSettingsPanelProps) {
  return (
    <div className="generation-toolbar">
      <GenerationCoreSettings config={config} onChange={onChange} />
      <div className="generation-submit-row">
        <div className="settings-summary">
          <span>当前模式</span>
          <strong>{config.mode === 'text' ? '文生图 · 单张' : config.mode === 'reference' ? '参考生成 · 单张' : '局部编辑 · 单张'}</strong>
        </div>
        <Button variant="primary" className="generate-button" onClick={onSubmit} disabled={submitting}>{submitting ? (<><Loader2 className="spin" size={16} />正在提交...</>) : '提交生成任务'}</Button>
      </div>
    </div>
  );
}
