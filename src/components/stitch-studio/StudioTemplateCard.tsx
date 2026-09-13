import { useState } from 'react';
import type { StudioStyleTemplate } from '../../lib/image/recipe';
import { StitchIcon } from '../ui/StitchIcon';

export function StudioTemplateCard({ template, onChange, onRemove, disabled }: { template: StudioStyleTemplate; onChange: () => void; onRemove: () => void; disabled: boolean }) {
  const [imageUnavailable, setImageUnavailable] = useState(false);
  return <div role="group" aria-label="已选提示词模板" className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
    <div className="flex items-center gap-3">
      <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-surface-container flex items-center justify-center">
        {template.image && !imageUnavailable
          ? <img src={template.image} alt={`${template.name} 模板示例`} className="w-full h-full object-contain" onError={() => setImageUnavailable(true)} />
          : <span className="flex flex-col items-center gap-1 text-outline"><StitchIcon name="image" size={24} /><span className="font-meta-sm text-[10px]">暂无预览</span></span>}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-body-sm text-body-sm font-semibold text-on-surface line-clamp-2 break-words" title={template.name}>{template.name}</h3>
        <button type="button" disabled={disabled} onClick={onChange} className="mt-1.5 inline-flex items-center gap-1 font-meta-sm text-meta-sm text-primary hover:underline disabled:opacity-50"><StitchIcon name="refresh" size={15} />更换模板</button>
      </div>
      <button type="button" aria-label="移除模板" title="移除模板关联, 保留当前提示词" disabled={disabled} onClick={onRemove} className="shrink-0 self-start p-1 rounded-md text-outline hover:text-on-surface hover:bg-surface-container disabled:opacity-50"><StitchIcon name="close" size={16} /></button>
    </div>
  </div>;
}
