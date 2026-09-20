import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { RefImage } from '../../types/generation';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { ImageViewport } from '../gallery/ImageViewport';
import { StitchIcon } from '../ui/StitchIcon';

interface Props {
  references: RefImage[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function ReferenceImagePreview({ references, selectedId, onSelect, onClose }: Props) {
  const dialog = useFocusTrap<HTMLDivElement>(true);
  const index = references.findIndex((reference) => reference.id === selectedId);
  const reference = references[index];

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault(); event.stopPropagation();
        const next = references[index + (event.key === 'ArrowLeft' ? -1 : 1)];
        if (next) onSelect(next.id);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [index, onClose, onSelect, references]);

  function change(delta: number) {
    const next = references[index + delta];
    if (next) onSelect(next.id);
  }
  if (!reference) return null;

  return createPortal(<div
    className="stitch-viewer fixed inset-0 z-[70] flex items-center justify-center bg-inverse-surface/50 backdrop-blur-sm sm:p-4"
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    onPaste={(event) => event.stopPropagation()}
    onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}
  >
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="参考图预览" className="stitch-viewer-dialog flex h-full w-full max-w-6xl flex-col overflow-hidden bg-surface shadow-xl sm:h-[90dvh] sm:rounded-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-outline-variant/30 bg-surface-container-lowest px-3 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">参考图 {index + 1}</h2>
          <p className="truncate font-meta-sm text-meta-sm text-on-surface-variant" title={reference.name}>{reference.name}</p>
        </div>
        {references.length > 1 && <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="viewer-tool-button" aria-label="上一张参考图" disabled={index === 0} onClick={() => change(-1)}><StitchIcon name="chevron_left" size={20} /></button>
          <span className="font-meta-sm text-meta-sm text-on-surface-variant tabular-nums">{index + 1} / {references.length}</span>
          <button type="button" className="viewer-tool-button" aria-label="下一张参考图" disabled={index === references.length - 1} onClick={() => change(1)}><StitchIcon name="chevron_right" size={20} /></button>
        </div>}
        <button type="button" className="viewer-tool-button" aria-label="关闭参考图预览" onClick={onClose}><StitchIcon name="close" size={22} /></button>
      </header>
      <ImageViewport key={reference.id} src={reference.dataUrl} alt={`参考图 ${index + 1} 原图`} />
    </div>
  </div>, document.body);
}
