import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { RefImage, ResultRecord } from '../../types/generation';
import { prepareImageFile } from '../../lib/image/compress';
import { formatBytes } from '../../lib/image/format';
import { randomId } from '../../lib/random/id';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Button } from '../ui/Button';

const DEFAULT_MAX_REFS = 6;

function gallerySourceName(record: ResultRecord, index: number) {
  const serial = String(index + 1).padStart(2, '0');
  const date = Number.isFinite(record.createdAt) && record.createdAt > 0
    ? new Date(record.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : '历史作品';
  return `展馆作品 ${serial} · ${date}`;
}

function galleryRecordToRef(record: ResultRecord, index: number): RefImage {
  return { id: `gallery-${record.id}-${Date.now()}`, name: `${gallerySourceName(record, index)}.png`, dataUrl: record.dataUrl, size: record.dataUrl.length };
}

export function ReferenceUploader({ images, onChange, galleryRecords = [], title = '选择参考图', localHint = '支持多张参考图, 自动压缩', galleryHint, maxImages = DEFAULT_MAX_REFS }: { images: RefImage[]; onChange: (images: RefImage[]) => void; galleryRecords?: ResultRecord[]; title?: string; localHint?: string; galleryHint?: string; maxImages?: number }) {
  const [warning, setWarning] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const galleryDialogRef = useFocusTrap<HTMLDivElement>(galleryOpen);
  const limit = Math.max(1, Math.min(DEFAULT_MAX_REFS, Math.round(maxImages) || DEFAULT_MAX_REFS));
  const remaining = Math.max(0, limit - images.length);
  const atLimit = remaining === 0;
  const galleryItems = useMemo(() => galleryRecords.slice(0, 80), [galleryRecords]);

  useEffect(() => {
    if (!warning) return undefined;
    const timer = window.setTimeout(() => setWarning(null), 2500);
    return () => window.clearTimeout(timer);
  }, [warning]);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (atLimit) {
      setWarning(`最多 ${limit} 张参考图, 请先删除部分图`);
      return;
    }
    const limited = Array.from(files).slice(0, remaining);
    const dropped = files.length - limited.length;
    if (dropped > 0) setWarning(`已达上限, 仅保留前 ${limited.length} 张, 跳过 ${dropped} 张`);
    const next = [...images];
    for (const file of limited) {
      try {
        const prepared = await prepareImageFile(file);
        next.push({ id: randomId('ref'), ...prepared });
      } catch (error) {
        setWarning(error instanceof Error ? error.message : '参考图处理失败');
      }
    }
    onChange(next);
  }

  function addGallery(record: ResultRecord, index: number) {
    if (atLimit) {
      setWarning(`最多 ${limit} 张参考图, 请先删除部分图`);
      setGalleryOpen(false);
      return;
    }
    onChange(limit === 1 ? [galleryRecordToRef(record, index)] : [...images, galleryRecordToRef(record, index)]);
    setGalleryOpen(false);
  }

  return (
    <section className="upload-panel source-picker-panel">
      <div className="split-source-choice">
        <label className="source-choice-card" aria-disabled={atLimit}>
          <strong>上传本地图片</strong>
          <span>{atLimit ? `已达上限 ${limit} 张` : `${localHint}, 当前 ${images.length}/${limit}`}</span>
          <input type="file" accept="image/*" multiple disabled={atLimit} onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ''; }} />
        </label>
        <button className="source-choice-card" onClick={() => setGalleryOpen(true)} disabled={galleryItems.length === 0 || atLimit}>
          <strong>从展馆选择</strong>
          <span>{atLimit ? '已达参考图上限' : galleryItems.length > 0 ? (galleryHint || `${galleryItems.length} 张可选作品`) : '展馆暂无图片'}</span>
        </button>
      </div>
      <div className="split-source-status">
        {images.length > 0 ? <><strong>{title}</strong><span>已选择 {images.length}/{limit} 张</span></> : <span>还没有选择参考图</span>}
      </div>
      {warning && <p className="error-text" role="status" aria-live="polite">{warning}</p>}
      {images.length > 0 && (
        <div className="thumb-grid">
          {images.map((image) => (
            <article key={image.id} className="thumb-card">
              <img src={image.dataUrl} alt={image.name} />
              <div><strong>{image.name}</strong><span>{formatBytes(image.size)}</span></div>
              <Button variant="ghost" onClick={() => onChange(images.filter((item) => item.id !== image.id))}><X size={14} /></Button>
            </article>
          ))}
        </div>
      )}

      {galleryOpen && (
        <div className="split-gallery-modal" role="dialog" aria-modal="true" aria-label="从展馆选择图片">
          <button className="split-gallery-backdrop" onClick={() => setGalleryOpen(false)} aria-label="关闭展馆选择" />
          <div ref={galleryDialogRef} className="split-gallery-dialog">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Gallery Source</span>
                <h2>从展馆选择</h2>
              </div>
              <button className="viewer-close inline-close" onClick={() => setGalleryOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            {galleryItems.length === 0 ? (
              <div className="empty-state large">展馆暂无图片.</div>
            ) : (
              <div className="split-gallery-modal-grid">
                {galleryItems.map((record, index) => (
                  <button key={record.id} className="gallery-source modal-gallery-source" onClick={() => addGallery(record, index)} title={record.prompt || '展馆作品'}>
                    <img src={record.dataUrl} alt="展馆作品" />
                    <span>{gallerySourceName(record, index)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
