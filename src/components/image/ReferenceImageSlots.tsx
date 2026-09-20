import { useEffect, useState } from 'react';
import type { RefImage } from '../../types/generation';
import { Plus, RefreshCw, X } from '../ui/icons';
import { ReferenceImagePreview } from './ReferenceImagePreview';

interface Props {
  references: RefImage[];
  maxReferences: number;
  label?: string;
  disabled: boolean;
  busy: boolean;
  onAdd: () => void;
  onUpload: (files: File[]) => void;
  onReplace: (id: string) => void;
  onRemove: (id: string) => void;
}

function imageFiles(transfer: DataTransfer): File[] {
  return Array.from(transfer.files).filter((file) => file.type.startsWith('image/'));
}

export function ReferenceImageSlots({ references, maxReferences, label = '参考图', disabled, busy, onAdd, onUpload, onReplace, onRemove }: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const slots = Array.from({ length: Math.max(maxReferences, references.length) }, (_, index) => references[index]);
  const previewOpen = references.some((reference) => reference.id === previewId);
  const inputDisabled = disabled || busy;

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData || previewOpen || (event.target instanceof Element && event.target.closest('[role="dialog"], [aria-modal="true"]'))) return;
      const files = imageFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      if (!inputDisabled) onUpload(files);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [inputDisabled, onUpload, previewOpen]);

  return <>
    <div className={`reference-image-input flex flex-col gap-2 rounded-lg ${dragging && !inputDisabled ? 'outline outline-2 outline-offset-4 outline-primary' : ''}`} onDragOver={(event) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = inputDisabled ? 'none' : 'copy';
      if (!inputDisabled) setDragging(true);
    }} onDragLeave={(event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false);
    }} onDrop={(event) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation(); setDragging(false);
      const files = imageFiles(event.dataTransfer);
      if (files.length && !inputDisabled) onUpload(files);
    }}>
    <div className="reference-image-slots" aria-label={`已载入${label}`} style={{ gridAutoColumns: `minmax(0, calc((100% - ${(maxReferences - 1) * 8}px) / ${maxReferences}))` }}>
      {slots.map((reference, index) => <div key={reference?.id || `empty-${index}`} className="reference-image-slot min-w-0 flex flex-col gap-1">
        {reference ? <>
          <div className="relative aspect-square w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest">
            <button type="button" aria-label={`查看${label} ${index + 1}`} title={`${reference.name} · 点击查看大图`} onClick={() => setPreviewId(reference.id)} className="absolute inset-0 overflow-hidden rounded-lg transition-colors hover:bg-surface-container">
              <img src={reference.dataUrl} alt={`${label} ${index + 1}`} draggable={false} className="h-full w-full object-contain" />
            </button>
            <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-surface-bright/95 px-1.5 py-0.5 font-meta-sm text-[10px] text-on-surface">图 {index + 1}</span>
          </div>
          <div className="reference-image-actions flex h-7 items-center justify-center gap-1">
            <button type="button" aria-label={`更换${label} ${index + 1}`} title="更换图片" disabled={disabled} onClick={() => onReplace(reference.id)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-primary transition-colors hover:bg-surface-container disabled:opacity-50"><RefreshCw size={14} /></button>
            <button type="button" aria-label={`移除${label} ${index + 1}`} title="移除图片" disabled={disabled} onClick={() => onRemove(reference.id)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-outline transition-colors hover:bg-surface-container hover:text-error disabled:opacity-50"><X size={14} /></button>
          </div>
        </> : <>
          <button type="button" aria-label={`添加${label} ${index + 1}`} disabled={disabled} onClick={onAdd} className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-outline-variant/60 bg-surface-container-lowest/40 font-meta-sm text-[11px] text-on-surface-variant transition-colors hover:border-primary hover:bg-surface-container-lowest hover:text-primary disabled:opacity-50">
            <Plus size={18} aria-hidden />
            <span>{busy ? '载入中' : '添加'}</span>
          </button>
          <span aria-hidden className="reference-image-actions h-7" />
        </>}
      </div>)}
    </div>
    <p className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 font-meta-sm text-[11px] text-outline">
      <span>{busy ? '正在载入图片...' : references.length >= maxReferences ? '点击图片查看大图' : '支持多选上传, 粘贴或拖拽添加'}</span>
      <span>单张最多 12 MiB</span>
    </p>
    </div>
    {previewId && previewOpen && <ReferenceImagePreview references={references} selectedId={previewId} onSelect={setPreviewId} onClose={() => setPreviewId(null)} />}
  </>;
}
