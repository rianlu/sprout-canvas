import { useEffect, useRef, useState } from 'react';
import { seriesAspects, type SceneEdit } from '../../hooks/useSeriesStudio';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { StitchIcon } from '../ui/StitchIcon';
import type { ImageCapabilities } from '../../types/provider';
import { CreditCost } from '../ui/CreditCost';
import { MAX_SCENE_PROMPT_LENGTH } from '../../../shared/series-planning.mjs';

export function SceneEditor({ value, onChange, onSave, onClose, actionLabel, imageCapabilities, estimatedPoints = 0 }: { value: SceneEdit; onChange: (value: SceneEdit) => void; onSave: () => Promise<void>; onClose: () => void; actionLabel: string; imageCapabilities?: ImageCapabilities; estimatedPoints?: number }) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const formats = imageCapabilities?.formats || ['png', 'jpeg', 'webp'];
  useEffect(() => { const key = (event: KeyboardEvent) => { if (saving.current && event.key === 'Tab') event.preventDefault(); if (event.key === 'Escape') { event.preventDefault(); if (!saving.current) onClose(); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  useEffect(() => { if (busy) ref.current?.focus(); }, [busy, ref]);
  const close = () => { if (!saving.current) onClose(); };
  return <div className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-md flex items-center justify-center p-4" onClick={close}>
    <div ref={ref} role="dialog" aria-modal="true" aria-busy={busy} tabIndex={-1} aria-label={`调整第 ${value.index + 1} 镜`} className="w-full max-w-xl max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden rounded-2xl bg-surface shadow-xl outline-none" onClick={(event) => event.stopPropagation()}>
      <div className="shrink-0 flex items-center justify-between gap-3 p-space-md border-b border-outline-variant/20"><h2 className="font-headline-sm text-headline-sm">第 {value.index + 1} 镜设置</h2><button type="button" aria-label="关闭本镜设置" disabled={busy} onClick={close} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container disabled:opacity-40"><StitchIcon name="close" size={20} /></button></div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-space-md">
        <fieldset disabled={busy} className="space-y-space-md min-w-0">
          <label className="block text-body-sm">画面提示词<textarea aria-label="本镜画面提示词" rows={5} maxLength={MAX_SCENE_PROMPT_LENGTH} value={value.prompt} onChange={(event) => onChange({ ...value, prompt: event.target.value })} className="mt-1 w-full p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 disabled:opacity-60" /></label>
          <div className="grid grid-cols-3 gap-space-sm text-body-sm">
            <label className="min-w-0">画幅<select aria-label="本镜画幅" value={value.aspectRatio} onChange={(event) => onChange({ ...value, aspectRatio: event.target.value as SceneEdit['aspectRatio'] })} className="w-full mt-1 p-2 rounded-lg bg-surface-container-low">{seriesAspects(imageCapabilities?.customSizes, value.aspectRatio).map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.label}</option>)}</select></label>
            <label className="min-w-0">质量<select aria-label="本镜质量" value={value.quality} onChange={(event) => onChange({ ...value, quality: event.target.value as SceneEdit['quality'] })} className="w-full mt-1 p-2 rounded-lg bg-surface-container-low"><option value="auto">自动</option><option value="low">快速</option><option value="medium">标准</option><option value="high">精细</option></select></label>
            <label className="min-w-0">格式{formats.length === 1 ? <span aria-label="本镜格式" className="block mt-1 p-2 rounded-lg bg-surface-container-low">{formats[0].toUpperCase()}</span> : <select aria-label="本镜格式" value={value.outputFormat} onChange={(event) => onChange({ ...value, outputFormat: event.target.value as SceneEdit['outputFormat'] })} className="w-full mt-1 p-2 rounded-lg bg-surface-container-low">{formats.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select>}</label>
          </div>
        </fieldset>
      </div>
      <div className="shrink-0 p-space-md border-t border-outline-variant/20 space-y-2">
        {estimatedPoints === 0 && <p className="font-meta-sm text-meta-sm text-on-surface-variant">保存设置不额外扣点</p>}
        <button type="button" disabled={busy || !value.prompt.trim()} onClick={() => { if (saving.current) return; saving.current = true; setBusy(true); void onSave().finally(() => { saving.current = false; setBusy(false); }); }} className="w-full py-2.5 rounded-xl bg-primary text-on-primary inline-flex items-center justify-center gap-2 disabled:opacity-50">{busy ? '保存中...' : actionLabel}{estimatedPoints > 0 && <CreditCost points={estimatedPoints} />}</button>
      </div>
    </div>
  </div>;
}
