import { useEffect, useState } from 'react';
import { seriesAspects, type SceneEdit } from '../../hooks/useSeriesStudio';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { StitchIcon } from '../ui/StitchIcon';
import type { ImageCapabilities } from '../../types/provider';

export function SceneEditor({ value, onChange, onSave, onClose, actionLabel, imageCapabilities }: { value: SceneEdit; onChange: (value: SceneEdit) => void; onSave: () => Promise<void>; onClose: () => void; actionLabel: string; imageCapabilities?: ImageCapabilities }) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  return <div className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`调整第 ${value.index + 1} 镜`} className="w-full max-w-xl rounded-2xl bg-surface p-space-lg shadow-xl space-y-space-md" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between"><h2 className="font-headline-sm text-headline-sm">第 {value.index + 1} 镜设置</h2><button type="button" aria-label="关闭本镜设置" onClick={onClose}><StitchIcon name="close" size={20} /></button></div>
      <label className="block text-body-sm">画面提示词<textarea aria-label="本镜画面提示词" rows={5} value={value.prompt} onChange={(event) => onChange({ ...value, prompt: event.target.value })} className="mt-1 w-full p-3 rounded-xl bg-surface-container-low border border-outline-variant/30" /></label>
      <div className="grid grid-cols-3 gap-space-sm text-body-sm">
        <label>画幅<select aria-label="本镜画幅" value={value.aspectRatio} onChange={(event) => onChange({ ...value, aspectRatio: event.target.value as SceneEdit['aspectRatio'] })} className="w-full mt-1 p-2 rounded-lg bg-surface-container-low">{seriesAspects(imageCapabilities?.customSizes, value.aspectRatio).map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.label}</option>)}</select></label>
        <label>质量<select aria-label="本镜质量" value={value.quality} onChange={(event) => onChange({ ...value, quality: event.target.value as SceneEdit['quality'] })} className="w-full mt-1 p-2 rounded-lg bg-surface-container-low"><option value="low">快速</option><option value="medium">标准</option><option value="high">精细</option><option value="auto">自动</option></select></label>
        <label>格式<select aria-label="本镜格式" value={value.outputFormat} onChange={(event) => onChange({ ...value, outputFormat: event.target.value as SceneEdit['outputFormat'] })} className="w-full mt-1 p-2 rounded-lg bg-surface-container-low">{(imageCapabilities?.formats || ['png', 'jpeg', 'webp']).map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select></label>
      </div>
      <button type="button" disabled={busy || !value.prompt.trim()} onClick={() => { setBusy(true); void onSave().finally(() => setBusy(false)); }} className="w-full py-2.5 rounded-xl bg-primary text-on-primary disabled:opacity-50">{busy ? '保存中...' : actionLabel}</button>
    </div>
  </div>;
}
