import type { StudioMode } from '../../types/generation';

const modes: Array<{ key: StudioMode; label: string; desc: string }> = [
  { key: 'text', label: '文字生成', desc: '从提示词直接生成图片' },
  { key: 'reference', label: '参考生成', desc: '上传参考图, 自动调度 provider' },
  { key: 'edit', label: '局部编辑', desc: '矩形选区, 精确修改局部' },
];

export function ModeSwitcher({ value, onChange }: { value: StudioMode; onChange: (mode: StudioMode) => void }) {
  return (
    <div className="mode-switcher" role="group" aria-label="生成模式">
      {modes.map((mode) => (
        <button key={mode.key} className={value === mode.key ? 'active' : ''} aria-pressed={value === mode.key} onClick={() => onChange(mode.key)}>
          <strong>{mode.label}</strong>
          <span>{mode.desc}</span>
        </button>
      ))}
    </div>
  );
}
