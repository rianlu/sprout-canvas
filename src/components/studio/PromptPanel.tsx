import type { GenerationConfig } from '../../types/generation';
import type { ImageStylePreset } from '../../lib/styles/image-styles';
import { Card } from '../ui/Card';
import { GenerationSettingsPanel } from './GenerationSettingsPanel';
import { StylePicker } from './StylePicker';

interface PromptPanelProps {
  config: GenerationConfig;
  onChange: (patch: Partial<GenerationConfig>) => void;
  onSubmit: () => void;
  submitting: boolean;
  selectedStyle: ImageStylePreset | null;
  onStyleChange: (style: ImageStylePreset | null) => void;
}

export function PromptPanel({ config, onChange, onSubmit, submitting, selectedStyle, onStyleChange }: PromptPanelProps) {
  return (
    <Card className="prompt-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Prompt</span>
          <h2>画面描述</h2>
        </div>
      </div>
      <label className="field prompt-field">
        <span>提示词</span>
        <textarea value={config.prompt} onChange={(event) => onChange({ prompt: event.target.value })} placeholder="描述主体, 风格, 构图, 光线, 色彩和需要修改的位置..." />
      </label>
      <StylePicker selected={selectedStyle} onChange={onStyleChange} />
      <GenerationSettingsPanel config={config} onChange={onChange} onSubmit={onSubmit} submitting={submitting} />
    </Card>
  );
}
