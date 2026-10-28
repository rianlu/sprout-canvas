import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { ImageViewport } from '../gallery/ImageViewport';
import { StitchIcon } from '../ui/StitchIcon';

interface Props {
  label: string;
  title: string;
  subtitle?: string;
  /** Resets zoom and pan when the image changes. */
  imageKey: string;
  src?: string;
  alt: string;
  error?: string;
  position?: { index: number; count: number };
  onPrevious?: () => void;
  onNext?: () => void;
  previousLabel?: string;
  nextLabel?: string;
  closeLabel: string;
  onClose: () => void;
  onCopy?: () => void;
  onDownload?: () => void;
  /** Fills the whole window instead of the 90% framed preview. */
  fullWindow?: boolean;
}

/** Page-level image preview shared by reference slots and the work viewer; zoom and pan come from ImageViewport. */
export function ImagePreviewDialog({ label, title, subtitle, imageKey, src, alt, error, position, onPrevious, onNext, previousLabel = '上一张', nextLabel = '下一张', closeLabel, onClose, onCopy, onDownload, fullWindow = false }: Props) {
  const dialog = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Capture keys first so the page or the viewer underneath never reacts while the preview is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault(); event.stopPropagation();
        (event.key === 'ArrowLeft' ? onPrevious : onNext)?.();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, onNext, onPrevious]);

  return createPortal(<div
    className={`stitch-viewer fixed inset-0 z-[70] flex items-center justify-center bg-inverse-surface/50 backdrop-blur-sm ${fullWindow ? '' : 'sm:p-4'}`}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    onPaste={(event) => event.stopPropagation()}
    onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}
  >
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={label} className={`stitch-viewer-dialog flex h-full w-full flex-col overflow-hidden bg-surface shadow-xl ${fullWindow ? '' : 'max-w-6xl sm:h-[90dvh] sm:rounded-2xl'}`}>
      <header className="flex shrink-0 items-center gap-3 border-b border-outline-variant/30 bg-surface-container-lowest px-3 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-headline-sm text-headline-sm font-semibold text-on-surface" title={title}>{title}</h2>
          {subtitle && <p className="truncate font-meta-sm text-meta-sm text-on-surface-variant" title={subtitle}>{subtitle}</p>}
        </div>
        {position && position.count > 1 && <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="viewer-tool-button" aria-label={previousLabel} disabled={!onPrevious} onClick={onPrevious}><StitchIcon name="chevron_left" size={20} /></button>
          <span className="font-meta-sm text-meta-sm text-on-surface-variant tabular-nums">{position.index + 1} / {position.count}</span>
          <button type="button" className="viewer-tool-button" aria-label={nextLabel} disabled={!onNext} onClick={onNext}><StitchIcon name="chevron_right" size={20} /></button>
        </div>}
        <button type="button" className="viewer-tool-button" aria-label={closeLabel} onClick={onClose}><StitchIcon name="close" size={22} /></button>
      </header>
      <ImageViewport key={imageKey} src={src} alt={alt} error={error} onCopy={onCopy} onDownload={onDownload} />
    </div>
  </div>, document.body);
}
