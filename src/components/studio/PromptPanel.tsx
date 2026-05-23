import type { GenerationConfig } from '../../types/generation';
import { Card } from '../ui/Card';
import { GenerationSettingsPanel } from './GenerationSettingsPanel';

interface PromptPanelProps {
  config: GenerationConfig;
  onChange: (patch: Partial<GenerationConfig>) => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function PromptPanel({ config, onChange, onSubmit, submitting }: PromptPanelProps) {
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
      <GenerationSettingsPanel config={config} onChange={onChange} onSubmit={onSubmit} submitting={submitting} />
    </Card>
  );
}
