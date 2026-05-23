import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { fileToDataUrl, imageFromDataUrl } from '../lib/image/data-url';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import type { ResultRecord } from '../types/generation';

interface SlicePreview { id: string; dataUrl: string; filename: string; width: number; height: number }
interface SplitSource { name: string; dataUrl: string; image: HTMLImageElement }
type SplitFormat = 'png' | 'jpeg' | 'webp';

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

function gallerySourceName(record: ResultRecord, index: number) {
  const serial = String(index + 1).padStart(2, '0');
  const date = Number.isFinite(record.createdAt) && record.createdAt > 0
    ? new Date(record.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : '历史作品';
  return `展馆作品 ${serial} · ${date}`;
}

export function SplitTool({ galleryRecords }: { galleryRecords: ResultRecord[] }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [marginX, setMarginX] = useState(0);
  const [marginY, setMarginY] = useState(0);
  const [gapX, setGapX] = useState(0);
  const [gapY, setGapY] = useState(0);
  const [format, setFormat] = useState<SplitFormat>('png');
  const [quality, setQuality] = useState(92);
  const [source, setSource] = useState<SplitSource | null>(null);
  const [slices, setSlices] = useState<SlicePreview[]>([]);
  const [error, setError] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [sourceFloatOpen, setSourceFloatOpen] = useState(false);

  async function loadFile(file: File) {
    const dataUrl = await fileToDataUrl(file);
    const image = await imageFromDataUrl(dataUrl);
    const next = { name: file.name, dataUrl, image };
    setSource(next);
    setSourceFloatOpen(true);
  }

  async function loadGallery(record: ResultRecord, index: number) {
    const image = await imageFromDataUrl(record.dataUrl);
    const next = { name: gallerySourceName(record, index), dataUrl: record.dataUrl, image };
    setSource(next);
    setSourceFloatOpen(true);
    setGalleryOpen(false);
  }

  function split(target = source) {
    if (!target) return;
    setError('');
    const safeRows = Math.max(1, Math.min(20, Math.round(rows)));
    const safeCols = Math.max(1, Math.min(20, Math.round(cols)));
    const usableWidth = target.image.naturalWidth - marginX * 2 - gapX * (safeCols - 1);
    const usableHeight = target.image.naturalHeight - marginY * 2 - gapY * (safeRows - 1);
    if (usableWidth <= 0 || usableHeight <= 0) {
      setSlices([]);
      setError('边距或间距过大, 已超过原图尺寸.');
      return;
    }
    const cellWidth = usableWidth / safeCols;
    const cellHeight = usableHeight / safeRows;
    const next: SlicePreview[] = [];
    for (let row = 0; row < safeRows; row += 1) {
      for (let col = 0; col < safeCols; col += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(cellWidth));
        canvas.height = Math.max(1, Math.round(cellHeight));
        const context = canvas.getContext('2d');
        if (!context) continue;
        context.drawImage(target.image, marginX + col * (cellWidth + gapX), marginY + row * (cellHeight + gapY), cellWidth, cellHeight, 0, 0, canvas.width, canvas.height);
        const index = row * safeCols + col + 1;
        next.push({ id: `${row}-${col}`, dataUrl: canvas.toDataURL(splitMime(format), format === 'png' ? undefined : quality / 100), filename: `slice-${String(index).padStart(2, '0')}.${splitExt(format)}`, width: canvas.width, height: canvas.height });
      }
    }
    setSlices(next);
  }

  useEffect(() => {
    if (!source) return;
    split(source);
  }, [rows, cols, marginX, marginY, gapX, gapY, format, quality, source]);

  const previewCols = Math.max(1, Math.min(20, Math.round(cols)));

  return (
    <div className="page-stack split-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">Split</span>
          <h1>切图</h1>
        </div>
        <div className="split-summary">{source ? `${source.image.naturalWidth}×${source.image.naturalHeight} · ${slices.length} 张` : '选择图片后开始切图'}</div>
      </div>

      <div className="split-workbench">
        <Card className="split-settings-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Settings</span>
              <h2>切图参数</h2>
            </div>
          </div>
          <div className="split-control-group">
            <label className="field"><span>行数</span><input type="number" min={1} max={20} value={rows} onChange={(event) => setRows(Number(event.target.value) || 1)} /></label>
            <label className="field"><span>列数</span><input type="number" min={1} max={20} value={cols} onChange={(event) => setCols(Number(event.target.value) || 1)} /></label>
            <label className="field"><span>横向边距</span><input type="number" min={0} value={marginX} onChange={(event) => setMarginX(Number(event.target.value) || 0)} /></label>
            <label className="field"><span>纵向边距</span><input type="number" min={0} value={marginY} onChange={(event) => setMarginY(Number(event.target.value) || 0)} /></label>
            <label className="field"><span>横向间距</span><input type="number" min={0} value={gapX} onChange={(event) => setGapX(Number(event.target.value) || 0)} /></label>
            <label className="field"><span>纵向间距</span><input type="number" min={0} value={gapY} onChange={(event) => setGapY(Number(event.target.value) || 0)} /></label>
            <label className="field"><span>格式</span><select value={format} onChange={(event) => setFormat(event.target.value as SplitFormat)}><option>png</option><option>jpeg</option><option>webp</option></select></label>
            <label className="field"><span>质量</span><input type="number" min={0} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value) || 92)} /></label>
          </div>
          {error && <p className="error-text">{error}</p>}
        </Card>

        <Card className="split-source-card compact-source-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Source</span>
              <h2>选择原图</h2>
            </div>
          </div>
          <div className="split-source-choice">
            <label className="source-choice-card">
              <strong>上传本地图片</strong>
              <span>选择合集图后自动切图</span>
              <input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.currentTarget.value = ''; }} />
            </label>
            <button className="source-choice-card" onClick={() => setGalleryOpen(true)} disabled={galleryRecords.length === 0}>
              <strong>从展馆选择</strong>
              <span>{galleryRecords.length > 0 ? `${galleryRecords.length} 张可选作品` : '展馆暂无图片'}</span>
            </button>
          </div>
          <div className="split-source-status">
            {source ? <><strong>{source.name}</strong><span>{source.image.naturalWidth}×{source.image.naturalHeight}</span></> : <span>还没有选择原图</span>}
            {source && <Button variant="ghost" onClick={() => setSourceFloatOpen(true)}>显示原图浮窗</Button>}
          </div>
        </Card>
      </div>

      <section className="split-results-panel">
        <div className="preview-heading split-output-heading">
          <div>
            <span className="eyebrow">Output</span>
            <h2>切图结果</h2>
          </div>
          <div className="split-output-actions">
            <span>{slices.length} 张</span>
            <Button onClick={() => slices.forEach((slice) => download(slice.dataUrl, slice.filename))} disabled={slices.length === 0}>下载全部</Button>
          </div>
        </div>
        {slices.length === 0 ? (
          <div className="empty-state large">切图结果会显示在这里.</div>
        ) : (
          <div className="split-result-scroll">
            <div className="split-result-grid aligned" style={{ '--split-cols': previewCols } as React.CSSProperties}>
              {slices.map((slice) => (
                <article className="result-card split-result-card" key={slice.id}>
                  <img src={slice.dataUrl} alt={slice.filename} />
                  <div className="result-meta"><strong>{slice.filename}</strong><span>{slice.width}×{slice.height}</span></div>
                  <div className="result-actions"><Button variant="ghost" onClick={() => download(slice.dataUrl, slice.filename)}>下载</Button></div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>


      {source && sourceFloatOpen && (
        <aside className="split-source-float" aria-label="原图浮窗">
          <div className="split-source-float-head">
            <div>
              <span className="eyebrow">Source</span>
              <strong>原图对比</strong>
            </div>
            <button onClick={() => setSourceFloatOpen(false)} aria-label="隐藏原图浮窗"><X size={16} /></button>
          </div>
          <img src={source.dataUrl} alt={source.name} />
          <div className="split-source-float-meta"><strong>{source.name}</strong><span>{source.image.naturalWidth}×{source.image.naturalHeight}</span></div>
        </aside>
      )}

      {galleryOpen && (
        <div className="split-gallery-modal" role="dialog" aria-modal="true" aria-label="从展馆选择图片">
          <button className="split-gallery-backdrop" onClick={() => setGalleryOpen(false)} aria-label="关闭展馆选择" />
          <div className="split-gallery-dialog">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Gallery Source</span>
                <h2>从展馆选择</h2>
              </div>
              <button className="viewer-close inline-close" onClick={() => setGalleryOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            {galleryRecords.length === 0 ? (
              <div className="empty-state large">展馆暂无图片.</div>
            ) : (
              <div className="split-gallery-modal-grid">
                {galleryRecords.map((record, index) => (
                  <button key={record.id} className="gallery-source modal-gallery-source" onClick={() => { void loadGallery(record, index); }} title={record.prompt || '展馆作品'}>
                    <img src={record.dataUrl} alt="展馆作品" />
                    <span>{gallerySourceName(record, index)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
