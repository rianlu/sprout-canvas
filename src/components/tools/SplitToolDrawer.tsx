import { useEffect, useRef, useState } from 'react';
import { Grid2X2, Scissors, X } from 'lucide-react';
import { fileToDataUrl, imageFromDataUrl } from '../../lib/image/data-url';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { ResultRecord } from '../../types/generation';
import type { RefImage } from '../../types/generation';
import { prepareImageDataUrl } from '../../lib/image/compress';
import { randomId } from '../../lib/random/id';

interface SlicePreview { id: string; dataUrl: string; filename: string; width: number; height: number }
interface SplitSource { name: string; dataUrl: string; image: HTMLImageElement }
type SplitFormat = 'png' | 'jpeg' | 'webp';

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function canvasToDataUrl(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('图片编码失败'));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    }, mime, quality);
  });
}

function splitMime(format: SplitFormat) {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

function splitExt(format: SplitFormat) {
  return format === 'jpeg' ? 'jpg' : format;
}

function download(dataUrl: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

async function downloadSequentially(items: SlicePreview[]) {
  for (let i = 0; i < items.length; i += 1) {
    download(items[i].dataUrl, items[i].filename);
    if (i < items.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
}

function gallerySourceName(record: ResultRecord, index: number) {
  const serial = String(index + 1).padStart(2, '0');
  const date = Number.isFinite(record.createdAt) && record.createdAt > 0
    ? new Date(record.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : '历史作品';
  return `展馆作品 ${serial} · ${date}`;
}

interface SplitToolDrawerProps {
  open: boolean;
  onClose: () => void;
  galleryRecords: ResultRecord[];
  /** 切片「作为参考图送到创作台」 */
  onUseAsReference: (ref: RefImage) => void;
}

export function SplitToolDrawer({ open, onClose, galleryRecords, onUseAsReference }: SplitToolDrawerProps) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [format, setFormat] = useState<SplitFormat>('png');
  const [quality, setQuality] = useState(92);
  const [source, setSource] = useState<SplitSource | null>(null);
  const [slices, setSlices] = useState<SlicePreview[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const renderIdRef = useRef(0);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function loadFile(file: File) {
    const dataUrl = await fileToDataUrl(file);
    const image = await imageFromDataUrl(dataUrl);
    setSource({ name: file.name, dataUrl, image });
    setSlices([]);
    setError('');
  }

  async function loadGallery(record: ResultRecord, index: number) {
    const image = await imageFromDataUrl(record.dataUrl);
    setSource({ name: gallerySourceName(record, index), dataUrl: record.dataUrl, image });
    setSlices([]);
    setError('');
  }

  async function split() {
    if (!source || busy) return;
    setError('');
    const safeRows = Math.max(1, Math.min(20, rows));
    const safeCols = Math.max(1, Math.min(20, cols));
    const usableWidth = source.image.naturalWidth;
    const usableHeight = source.image.naturalHeight;
    const cellWidth = usableWidth / safeCols;
    const cellHeight = usableHeight / safeRows;
    const myRenderId = ++renderIdRef.current;
    setBusy(true);
    const next: SlicePreview[] = [];
    try {
      for (let row = 0; row < safeRows; row += 1) {
        for (let col = 0; col < safeCols; col += 1) {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(cellWidth));
          canvas.height = Math.max(1, Math.round(cellHeight));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('无法创建画布');
          context.drawImage(source.image, col * cellWidth, row * cellHeight, cellWidth, cellHeight, 0, 0, canvas.width, canvas.height);
          const dataUrl = await canvasToDataUrl(canvas, splitMime(format), format === 'png' ? undefined : quality / 100);
          next.push({
            id: `${row}-${col}`,
            dataUrl,
            filename: `${source.name.replace(/\.[^.]+$/, '')}_r${row + 1}c${col + 1}.${splitExt(format)}`,
            width: canvas.width,
            height: canvas.height,
          });
        }
      }
      if (myRenderId !== renderIdRef.current) return;
      setSlices(next);
    } catch (splitError) {
      if (myRenderId === renderIdRef.current) setError(splitError instanceof Error ? splitError.message : '切图失败');
    } finally {
      if (myRenderId === renderIdRef.current) setBusy(false);
    }
  }

  async function useAsReference(slice: SlicePreview) {
    const prepared = await prepareImageDataUrl(slice.filename, slice.dataUrl);
    onUseAsReference({ id: randomId('ref'), ...prepared });
    onClose();
  }

  if (!open) return null;

  return (
    <div className="split-tool-overlay" role="dialog" aria-modal="true" aria-label="切图工具">
      <button type="button" className="backdrop" onClick={onClose} aria-label="关闭切图工具" />
      <div ref={dialogRef} className="split-tool-panel">
        <div className="split-tool-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="head-icon" style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', background: 'var(--accent-tint)', color: 'var(--accent)' }}>
              <Scissors size={16} aria-hidden="true" />
            </span>
            <div>
              <h2>切图工具</h2>
              <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-body-sm)' }}>行列切分原图, 切片可下载或送到创作台</p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="split-tool-body">
          <aside className="split-tool-side">
            <div
              className="dropzone"
              onClick={() => document.getElementById('split-file-input')?.click()}
              role="button" tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter') document.getElementById('split-file-input')?.click(); }}
              aria-label="上传要切分的图片"
            >
              <strong>上传或拖入要切分的图</strong>
              <span>支持 PNG / JPEG / WebP</span>
              <input type="file" accept="image/*" id="split-file-input" style={{ display: 'none' }}
                onChange={(event) => { if (event.target.files?.[0]) void loadFile(event.target.files[0]); event.currentTarget.value = ''; }} />
            </div>

            {galleryRecords.length > 0 && (
              <div className="split-gallery-grid">
                {galleryRecords.slice(0, 12).map((record, index) => (
                  <button key={record.id} type="button" onClick={() => { void loadGallery(record, index); }} title={record.prompt || '展馆作品'}>
                    <img src={record.dataUrl} alt={record.prompt || '展馆作品'} loading="lazy" />
                  </button>
                ))}
              </div>
            )}

            {source && (
              <>
                <div className="split-source-preview" style={{ display: 'grid', gap: 8 }}>
                  <img src={source.dataUrl} alt={source.name} />
                  <span className="t-meta-sm" style={{ color: 'var(--muted)' }}>{source.image.naturalWidth}×{source.image.naturalHeight} · {source.name}</span>
                </div>

                <div className="field-label"><span>行 × 列</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label className="field">
                    <span className="t-body-sm" style={{ color: 'var(--muted)' }}>行</span>
                    <input type="number" min={1} max={20} value={rows}
                      onChange={(event) => setRows(clampInt(Number(event.target.value), 1, 20, 3))} />
                  </label>
                  <label className="field">
                    <span className="t-body-sm" style={{ color: 'var(--muted)' }}>列</span>
                    <input type="number" min={1} max={20} value={cols}
                      onChange={(event) => setCols(clampInt(Number(event.target.value), 1, 20, 3))} />
                  </label>
                </div>

                <div className="field-label"><span>输出格式</span></div>
                <div className="seg-control">
                  {(['png', 'jpeg', 'webp'] as const).map((item) => (
                    <button key={item} type="button" className={format === item ? 'active' : ''} onClick={() => setFormat(item)}>
                      {item.toUpperCase()}
                    </button>
                  ))}
                </div>

                {format !== 'png' && (
                  <div className="brush-size-row">
                    <input type="range" min={10} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value))} aria-label="质量" />
                    <span className="size-value">Q{quality}</span>
                  </div>
                )}

                <button type="button" className="btn btn-primary" onClick={() => { void split(); }} disabled={busy}>
                  <Grid2X2 size={15} aria-hidden="true" />{busy ? '切分中...' : `切分为 ${rows}×${cols}`}
                </button>
              </>
            )}

            {error && <p className="error-text t-meta-sm" role="alert">{error}</p>}
          </aside>

          <div className="split-tool-main">
            {slices.length === 0 ? (
              <div className="empty-state" style={{ minHeight: 240 }}>
                <Grid2X2 className="empty-icon" size={28} aria-hidden="true" />
                <strong>{source ? '设置行列后点击切分' : '先选择一张原图'}</strong>
                <span>切分结果会显示在这里</span>
              </div>
            ) : (
              <div className="split-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {slices.map((slice) => (
                  <figure className="split-cell" key={slice.id}>
                    <img src={slice.dataUrl} alt={slice.filename} />
                    <div className="cell-actions">
                      <span className="cell-id">{slice.filename.split('_').pop()}</span>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="link-btn" onClick={() => { void useAsReference(slice); }}>送创作</button>
                        <button type="button" className="link-btn" onClick={() => download(slice.dataUrl, slice.filename)}>下载</button>
                      </span>
                    </div>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
