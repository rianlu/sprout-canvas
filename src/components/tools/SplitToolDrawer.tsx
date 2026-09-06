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
    /* 切图工具 (Stitch 抽屉形态: 遮罩 + 面板 + 左参数右预览, 类名对齐 inpaint modal) */
    <div className="fixed inset-0 z-50 bg-inverse-surface/60 backdrop-blur-md flex items-center justify-center p-space-md" role="dialog" aria-modal="true" aria-label="切图工具" onClick={onClose}>
      <div ref={dialogRef} className="w-full max-w-5xl max-h-[92vh] bg-surface-bright rounded-2xl shadow-[0_24px_64px_rgba(85,95,75,0.20)] overflow-hidden flex flex-col" onClick={(event) => event.stopPropagation()}>
        {/* 头条 */}
        <div className="px-space-lg py-space-md bg-surface-container-low flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Scissors size={20} aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-headline-sm text-headline-sm text-on-surface">切图工具 (Grid Splitter)</h3>
              <p className="font-meta-sm text-meta-sm text-on-surface-variant">行列切分原图, 切片可下载或送到创作台</p>
            </div>
          </div>
          <button type="button" className="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface flex items-center justify-center transition-colors" onClick={onClose} aria-label="关闭">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* 主体: 左参数右预览 */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
          <aside className="w-full md:w-72 shrink-0 bg-surface-container-lowest p-space-md overflow-y-auto flex flex-col gap-space-md">
            {/* 上传区 */}
            <div
              className="w-full flex flex-col items-center justify-center gap-1 py-space-md rounded-xl border-2 border-dashed border-outline-variant/50 hover:border-primary/50 hover:bg-surface-container-low/50 transition-colors text-on-surface-variant cursor-pointer"
              onClick={() => document.getElementById('split-file-input')?.click()}
              role="button" tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter') document.getElementById('split-file-input')?.click(); }}
              aria-label="上传要切分的图片"
            >
              <strong className="font-body-sm text-body-sm">上传或拖入要切分的图</strong>
              <span className="font-meta-sm text-[10px] text-outline">支持 PNG / JPEG / WebP</span>
              <input type="file" accept="image/*" id="split-file-input" className="hidden"
                onChange={(event) => { if (event.target.files?.[0]) void loadFile(event.target.files[0]); event.currentTarget.value = ''; }} />
            </div>

            {/* 展馆选图 */}
            {galleryRecords.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {galleryRecords.slice(0, 12).map((record, index) => (
                  <button key={record.id} type="button" className="w-14 h-14 rounded-lg overflow-hidden bg-surface-container hover:ring-2 hover:ring-primary transition-all" onClick={() => { void loadGallery(record, index); }} title={record.prompt || '展馆作品'}>
                    <img className="w-full h-full object-cover" src={record.dataUrl} alt={record.prompt || '展馆作品'} loading="lazy" />
                  </button>
                ))}
              </div>
            )}

            {source && (
              <>
                <div className="flex flex-col gap-1.5">
                  <div className="rounded-xl overflow-hidden border border-outline-variant/30 bg-surface-container">
                    <img className="w-full h-28 object-cover" src={source.dataUrl} alt={source.name} />
                  </div>
                  <span className="font-meta-sm text-meta-sm text-on-surface-variant truncate">{source.image.naturalWidth}×{source.image.naturalHeight} · {source.name}</span>
                </div>

                {/* 行 × 列 */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-meta-sm text-meta-sm text-on-surface font-medium">行 × 列</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="flex flex-col gap-1">
                      <span className="font-meta-sm text-[10px] text-on-surface-variant">行</span>
                      <input className="w-full bg-surface-container-low rounded-lg px-2 py-1.5 font-body-sm text-body-sm text-on-surface border border-outline-variant/30 focus:border-primary outline-none" type="number" min={1} max={20} value={rows}
                        onChange={(event) => setRows(clampInt(Number(event.target.value), 1, 20, 3))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-meta-sm text-[10px] text-on-surface-variant">列</span>
                      <input className="w-full bg-surface-container-low rounded-lg px-2 py-1.5 font-body-sm text-body-sm text-on-surface border border-outline-variant/30 focus:border-primary outline-none" type="number" min={1} max={20} value={cols}
                        onChange={(event) => setCols(clampInt(Number(event.target.value), 1, 20, 3))} />
                    </label>
                  </div>
                </div>

                {/* 格式 */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-meta-sm text-meta-sm text-on-surface font-medium">输出格式</span>
                  <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded-lg">
                    {(['png', 'jpeg', 'webp'] as const).map((item) => (
                      <button key={item} type="button" className={format === item
                        ? 'flex-1 px-2 py-1 rounded-md bg-surface-container-lowest font-meta-sm text-[11px] text-primary font-medium shadow-sm'
                        : 'flex-1 px-2 py-1 rounded-md font-meta-sm text-[11px] text-on-surface-variant hover:text-on-surface transition-colors'} onClick={() => setFormat(item)}>
                        {item.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                {format !== 'png' && (
                  <div className="flex items-center gap-2">
                    <input className="flex-1 accent-primary cursor-pointer" type="range" min={10} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value))} aria-label="质量" />
                    <span className="font-meta-sm text-meta-sm text-on-surface">Q{quality}</span>
                  </div>
                )}

                <button type="button" className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-medium shadow-[0_2px_10px_rgba(65,91,47,0.25)] transition-all flex items-center justify-center gap-1.5 disabled:opacity-60" onClick={() => { void split(); }} disabled={busy}>
                  <Grid2X2 size={16} aria-hidden="true" />{busy ? '切分中...' : `切分为 ${rows}×${cols}`}
                </button>
              </>
            )}

            {error && <p className="font-meta-sm text-meta-sm text-error" role="alert">{error}</p>}
          </aside>

          {/* 右: 切片预览 */}
          <div className="flex-1 bg-surface-container-low p-space-lg overflow-y-auto min-w-0">
            {slices.length === 0 ? (
              <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-2 text-center">
                <Grid2X2 size={28} className="text-outline" aria-hidden="true" />
                <strong className="font-body-sm text-body-sm text-on-surface">{source ? '设置行列后点击切分' : '先选择一张原图'}</strong>
                <span className="font-meta-sm text-meta-sm text-outline">切分结果会显示在这里</span>
              </div>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {slices.map((slice) => (
                  <figure key={slice.id} className="rounded-xl overflow-hidden bg-surface-container-lowest border border-outline-variant/30 flex flex-col group">
                    <img className="w-full object-cover" src={slice.dataUrl} alt={slice.filename} />
                    <figcaption className="p-1.5 flex items-center justify-between gap-1">
                      <span className="font-meta-sm text-[9px] text-outline truncate">{slice.filename.split('_').pop()}</span>
                      <span className="flex gap-1.5 shrink-0">
                        <button type="button" className="font-meta-sm text-meta-sm text-primary hover:underline" onClick={() => { void useAsReference(slice); }}>送创作</button>
                        <button type="button" className="font-meta-sm text-meta-sm text-primary hover:underline" onClick={() => download(slice.dataUrl, slice.filename)}>下载</button>
                      </span>
                    </figcaption>
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
