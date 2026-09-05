import { ImagePlus, Scissors } from 'lucide-react';
import type { StudioMode } from '../../types/generation';

const MODES: Array<{ value: StudioMode; label: string; hint: string }> = [
  { value: 'text', label: '文生图', hint: '仅提示词' },
  { value: 'reference', label: '参考生成', hint: '加参考图' },
  { value: 'edit', label: '局部编辑', hint: '图 + 蒙版' },
];

export function ModeTabs({ mode, onModeChange }: { mode: StudioMode; onModeChange: (mode: StudioMode) => void }) {
  return (
    <div className="mode-tabs" role="tablist" aria-label="生成模式">
      {MODES.map((item) => (
        <button key={item.value} type="button" role="tab" aria-selected={mode === item.value}
          className={mode === item.value ? 'active' : ''} onClick={() => onModeChange(item.value)}>
          {item.value === 'text' ? <ImagePlus size={16} aria-hidden="true" /> : <Scissors size={16} aria-hidden="true" />}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
