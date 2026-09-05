import { Brush, Images, ImagePlus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { RefImage, ResultRecord } from '../../types/generation';
import { prepareImageDataUrl, prepareImageFile } from '../../lib/image/compress';
import { formatBytes } from '../../lib/image/format';
import { randomId } from '../../lib/random/id';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const DEFAULT_MAX_REFS = 6;

function gallerySourceName(record: ResultRecord, index: number) {
  const serial = String(index + 1).padStart(2, '0');
  const date = Number.isFinite(record.createdAt) && record.createdAt > 0
    ? new Date(record.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : '历史作品';
  return `展馆作品 ${serial} · ${date}`;
}

interface ReferencePanelProps {
  images: RefImage[];
  onChange: (images: RefImage[]) => void;
  galleryRecords?: ResultRecord[];
  maxImages?: number;
  maskSummary?: string | null;
  onOpenMaskEditor?: () => void;
  singleMode?: boolean;
}

export function ReferencePanel({ images, onChange, galleryRecords = [], maxImages = DEFAULT_MAX_REFS, maskSummary, onOpenMaskEditor, singleMode }: ReferencePanelProps) {
  const [warning, setWarning] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const galleryDialogRef = useFocusTrap<HTMLDivElement>(galleryOpen);
  const [dragOver, setDragOver] = useState(false);
  const limit = Math.max(1, Math.min(DEFAULT_MAX_REFS, Math.round(maxImages) || DEFAULT_MAX_REFS));
  const remaining = Math.max(0, limit - images.length);
  const atLimit = remaining === 0;
  const galleryItems = useMemo(() => galleryRecords.slice(0, 80), [galleryRecords]);

  useEffect(() => {
    if (!warning) return undefined;
    const timer = window.setTimeout(() => setWarning(''), 2500);
    return () => window.clearTimeout(timer);
  }, [warning]);

  async function addFiles(files: FileList | File[] | null) {
    if (!files || (files as FileList).length === 0) return;
    if (atLimit) { setWarning(`最多 ${limit} 张, 请先删除部分图片`); return; }
    const list = Array.from(files);
    if (!singleMode && list.length > remaining) setWarning(`已达上限, 仅保留前 ${remaining} 张`);
    const accepted = singleMode ? list.slice(0, 1) : list.slice(0, remaining);
    const next = singleMode ? [] : [...images];
    for (const file of accepted) {
      try {
        next.push({ id: randomId('ref'), ...await prepareImageFile(file) });
      } catch (error) {
        setWarning(error instanceof Error ? error.message : '图片处理失败');
      }
    }
    onChange(next);
  }

  async function addGallery(record: ResultRecord, index: number) {
    if (atLimit && !singleMode) { setWarning(`最多 ${limit} 张`); return; }
    try {
      setWarning('正在处理展馆图片...');
      const name = `${gallerySourceName(record, index)}.png`;
      const prepared = await prepareImageDataUrl(name, record.dataUrl);
      onChange(singleMode ? [{ id: `gallery-${record.id}-${Date.now()}`, ...prepared }] : [...images, { id: `gallery-${record.id}-${Date.now()}`, ...prepared }]);
      setGalleryOpen(false);
      setWarning('');
    } catch (error) {
      setWarning(error instanceof Error ? error.message : '展馆图片处理失败');
    }
  }

  return (
    <div className="rail-section">
      <div className="rail-section-head">
        <span className="rail-title"><ImagePlus size={16} aria-hidden="true" />参考图</span>
        {images.length > 0 && <span className="chip chip-accent">{images.length} 张已载入</span>}
      </div>

      <div
        className={`dropzone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => { event.preventDefault(); setDragOver(false); void addFiles(event.dataTransfer.files); }}
        onClick={() => document.getElementById('ref-file-input')?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Enter') document.getElementById('ref-file-input')?.click(); }}
        aria-label="上传参考图, 或拖拽图片到此区域"
      >
        <strong>{singleMode ? '上传或拖入一张原图' : '上传或拖入参考图'}</strong>
        <span>{atLimit ? `已达上限 ${limit} 张` : `可粘贴, 最多 ${limit} 张 · 自动压缩`}</span>
        <input type="file" accept="image/*" multiple={!singleMode} id="ref-file-input"
          onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ''; }} />
      </div>

      <div className="rail-section" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm" onClick={() => setGalleryOpen(true)} disabled={galleryItems.length === 0}>
          <Images size={14} aria-hidden="true" />从展馆选择
        </button>
        {warning && <p className="error-text t-meta-sm" role="status" aria-live="polite">{warning}</p>}
      </div>

      {images.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {images.map((image) => (
            <article key={image.id} className="thumb-row">
              <img src={image.dataUrl} alt={image.name} />
              <div className="thumb-row-info">
                <strong title={image.name}>{image.name}</strong>
                <span>{formatBytes(image.size)}</span>
              </div>
              <div className="thumb-row-actions">
                <button type="button" className="icon-btn" onClick={() => onChange(images.filter((item) => item.id !== image.id))} aria-label={`删除参考图 ${image.name}`}>
                  <X size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {maskSummary && onOpenMaskEditor && (
        <div className="mask-status-bar">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Brush size={13} aria-hidden="true" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{maskSummary}</span>
          </span>
          <button type="button" className="link-btn" onClick={onOpenMaskEditor}>进入工作区</button>
        </div>
      )}

      {galleryOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="从展馆选择图片">
          <button type="button" className="backdrop" onClick={() => setGalleryOpen(false)} aria-label="关闭展馆选择" />
          <div ref={galleryDialogRef} className="modal-panel">
            <div className="modal-head">
              <h2>从展馆选择</h2>
              <button type="button" className="icon-btn" onClick={() => setGalleryOpen(false)} aria-label="关闭"><X size={16} /></button>
            </div>
            <div className="split-gallery-grid">
              {galleryItems.map((record, index) => (
                <button key={record.id} type="button" onClick={() => { void addGallery(record, index); }} title={record.prompt || '展馆作品'}>
                  <img src={record.dataUrl} alt={record.prompt || '展馆作品'} />
                  <span className="t-meta-sm" style={{ color: 'var(--muted)', display: 'block', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gallerySourceName(record, index)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
