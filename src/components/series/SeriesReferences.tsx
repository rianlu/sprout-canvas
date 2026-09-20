import { useRef } from 'react';
import type { RefImage } from '../../types/generation';
import { X } from '../ui/icons';
import { StitchIcon } from '../ui/StitchIcon';
import { ReferenceImageSlots } from '../image/ReferenceImageSlots';

interface Props {
  references: RefImage[];
  maxReferences: number;
  disabled: boolean;
  busy: boolean;
  onUpload: (files: File[], replaceId?: string) => Promise<void>;
  onRemove: (id?: string) => void;
}

export function SeriesReferences({ references, maxReferences, disabled, busy, onUpload, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const replacing = useRef<string | undefined>(undefined);
  function chooseFiles(id?: string) {
    if (!input.current || disabled) return;
    replacing.current = id;
    input.current.multiple = !id;
    input.current.click();
  }
  return <div role="group" aria-label="系列参考图" className="flex flex-col gap-2" onDragOver={(event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  }} onDrop={(event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (files.length && !disabled) void onUpload(files);
  }}>
    <div className="flex items-center justify-between gap-2">
      <span className="font-body-sm text-body-sm font-medium text-on-surface flex items-center gap-1.5 whitespace-nowrap"><StitchIcon name="add_photo_alternate" size={16} className="text-primary" />参考图</span>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary-fixed px-2 py-0.5 text-on-primary-fixed font-meta-sm text-meta-sm whitespace-nowrap">{references.length} / {maxReferences} 张</span>
        {references.length > 0 && <button type="button" aria-label="清空系列参考图" disabled={disabled} onClick={() => onRemove()} className="text-outline hover:text-error disabled:opacity-50"><X size={15} /></button>}
      </div>
    </div>
    <ReferenceImageSlots references={references} maxReferences={maxReferences} label="系列参考图" disabled={disabled} busy={busy} onAdd={() => chooseFiles()} onUpload={(files) => { void onUpload(files); }} onReplace={chooseFiles} onRemove={onRemove} />
    <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="上传系列参考图" disabled={disabled} className="hidden" onChange={(event) => {
      const files = Array.from(event.target.files || []), id = replacing.current;
      replacing.current = undefined;
      event.target.value = '';
      event.target.multiple = true;
      void onUpload(files, id);
    }} />
  </div>;
}
