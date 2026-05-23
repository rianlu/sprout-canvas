import type { GenerationConfig } from '../../types/generation';
import { Button } from '../ui/Button';

interface GenerationSettingsPanelProps {
  config: GenerationConfig;
  onChange: (patch: Partial<GenerationConfig>) => void;
  onSubmit: () => void;
  submitting: boolean;
}

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function GenerationSettingsPanel({ config, onChange, onSubmit, submitting }: GenerationSettingsPanelProps) {
  return (
    <div className="generation-toolbar">
      <div className="field-grid settings-grid">
        <label className="field"><span>比例</span><select value={config.aspectRatio} onChange={(event) => onChange({ aspectRatio: event.target.value as GenerationConfig['aspectRatio'] })}><option>1:1</option><option>16:9</option><option>9:16</option><option>4:3</option><option>3:4</option><option>auto</option></select></label>
        <label className="field"><span>张数</span><input type="number" inputMode="numeric" min={1} max={8} value={config.imageCount} onChange={(event) => { const n = Number(event.target.value); onChange({ imageCount: Number.isFinite(n) ? n : 1 }); }} onBlur={(event) => onChange({ imageCount: clampInt(Number(event.target.value), 1, 8, 1) })} /></label>
        <label className="field"><span>质量</span><select value={config.quality} onChange={(event) => onChange({ quality: event.target.value as GenerationConfig['quality'] })}><option>auto</option><option>low</option><option>medium</option><option>high</option></select></label>
        <label className="field"><span>背景</span><select value={config.background} onChange={(event) => onChange({ background: event.target.value as GenerationConfig['background'] })}><option>auto</option><option>opaque</option><option>transparent</option></select></label>
      </div>
      <details className="advanced-settings inline-advanced">
        <summary>高级参数</summary>
        <div className="field-grid">
          <label className="field"><span>输出格式</span><select value={config.outputFormat} onChange={(event) => onChange({ outputFormat: event.target.value as GenerationConfig['outputFormat'] })}><option>auto</option><option>png</option><option>jpeg</option><option>webp</option></select></label>
          <label className="field"><span>压缩率</span><input type="number" inputMode="numeric" min={10} max={100} value={config.outputCompression} onChange={(event) => { const n = Number(event.target.value); onChange({ outputCompression: Number.isFinite(n) ? n : 90 }); }} onBlur={(event) => onChange({ outputCompression: clampInt(Number(event.target.value), 10, 100, 90) })} /></label>
        </div>
      </details>
      <div className="generation-submit-row">
        <div className="settings-summary">
          <span>当前模式</span>
          <strong>{config.mode === 'text' ? '文生图' : config.mode === 'reference' ? '参考生成' : '局部编辑'}</strong>
        </div>
        <Button variant="primary" className="generate-button" onClick={onSubmit} disabled={submitting}>{submitting ? '正在提交...' : '提交生成任务'}</Button>
      </div>
    </div>
  );
}
