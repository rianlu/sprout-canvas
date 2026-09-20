import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Eraser, RotateCcw, Trash2, X } from '../ui/icons';
import { StitchIcon } from '../ui/StitchIcon';
import type { RefImage } from '../../types/generation';
import { brushMaskToDataUrl, brushStrokeCount, type BrushMaskData, type BrushStroke } from '../../lib/editor/brush-mask';
import { imageFromDataUrl } from '../../lib/image/data-url';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface MaskEditorProps {
  image: RefImage;
  open: boolean;
  onClose: () => void;
  onApply: (mask: BrushMaskData | null, prompt: string, maskDataUrl?: string) => Promise<void>;
  initialMask?: BrushMaskData | null;
  initialMaskDataUrl?: string;
  /** 底部区域提示词 (可选, 应用时随蒙版生效) */
  regionPrompt?: string;
}

const MIN_BRUSH = 5;
const MAX_BRUSH = 80;
const DEFAULT_BRUSH = 32;

export function MaskEditor({ image, open, onClose, onApply, initialMask, initialMaskDataUrl = '', regionPrompt }: MaskEditorProps) {
  const [prompt, setPrompt] = useState(regionPrompt || '');
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH);
  const [strokes, setStrokes] = useState<BrushStroke[]>(() => (initialMask ? [...initialMask.strokes] : []));
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [baseMaskDataUrl, setBaseMaskDataUrl] = useState(initialMaskDataUrl);
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  const strokeCount = brushStrokeCount({ strokes } as BrushMaskData);

  // 重置 (打开新图时)
  useEffect(() => {
    if (open) {
      setStrokes(initialMask ? [...initialMask.strokes] : []);
      setPrompt(regionPrompt || '');
      setBaseMaskDataUrl(initialMaskDataUrl);
      setError('');
    }
  }, [open, initialMask, initialMaskDataUrl, image.id, regionPrompt]);

  useEffect(() => {
    let active = true;
    setBaseImage(null);
    if (baseMaskDataUrl) void imageFromDataUrl(baseMaskDataUrl).then((value) => { if (active) setBaseImage(value); }).catch(() => { if (active) setError('原始蒙版读取失败'); });
    return () => { active = false; };
  }, [baseMaskDataUrl]);

  // 重放笔画到叠加画布 (黑色笔画 = 保留区遮罩; 视觉上用 accent 色渲染, 导出时换黑)
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const rect = frame.getBoundingClientRect();
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (baseImage) {
      const layer = document.createElement('canvas');
      layer.width = canvas.width; layer.height = canvas.height;
      const overlay = layer.getContext('2d');
      if (overlay) {
        overlay.drawImage(baseImage, 0, 0, layer.width, layer.height);
        const pixels = overlay.getImageData(0, 0, layer.width, layer.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          pixels.data[i] = 89; pixels.data[i + 1] = 116; pixels.data[i + 2] = 69;
          pixels.data[i + 3] = Math.round((255 - pixels.data[i + 3]) * 0.55);
        }
        overlay.putImageData(pixels, 0, 0); context.drawImage(layer, 0, 0);
      }
    }
    const base = Math.min(canvas.width, canvas.height);
    for (const stroke of strokes) {
      const radius = (stroke.size * base) / 2;
      context.lineWidth = radius * 2;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.globalCompositeOperation = stroke.mode === 'eraser' ? 'destination-out' : 'source-over';
      context.strokeStyle = 'rgba(89, 116, 69, 0.55)';
      context.beginPath();
      let started = false;
      for (const point of stroke.points) {
        const px = point.x * canvas.width;
        const py = point.y * canvas.height;
        if (!started) {
          context.moveTo(px, py);
          context.lineTo(px + 0.01, py);
          started = true;
        } else context.lineTo(px, py);
      }
      context.stroke();
    }
    context.globalCompositeOperation = 'source-over';
  }, [strokes, baseImage]);

  useEffect(() => {
    if (open) repaint();
  }, [open, repaint]);

  useEffect(() => {
    if (!open || !frameRef.current) return;
    const observer = new ResizeObserver(repaint);
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [open, repaint]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function toNormalized(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing(true);
    const point = toNormalized(event);
    const rect = event.currentTarget.getBoundingClientRect();
    const stroke: BrushStroke = { points: [point], size: brushSize / Math.min(rect.width, rect.height), mode: tool };
    setStrokes((current) => [...current, stroke]);
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const point = toNormalized(event);
    setStrokes((current) => {
      if (current.length === 0) return current;
      const last = current[current.length - 1];
      const lastPoint = last.points[last.points.length - 1];
      // 跳过过密的点
      const dx = point.x - lastPoint.x;
      const dy = point.y - lastPoint.y;
      if (Math.hypot(dx, dy) < 0.004) return current;
      const next = [...current];
      next[next.length - 1] = { ...last, points: [...last.points, point] };
      return next;
    });
  }

  function onPointerUp() {
    setDrawing(false);
  }

  function undo() {
    setStrokes((current) => current.slice(0, -1));
  }
  function clearMask() {
    setStrokes([]);
    setBaseMaskDataUrl('');
  }

  async function apply() {
    setSaving(true); setError('');
    try {
      const mask = { strokes, width: 0, height: 0 };
      if (baseMaskDataUrl) await onApply(null, prompt, await brushMaskToDataUrl(mask, image.dataUrl, baseMaskDataUrl));
      else await onApply(strokes.length ? mask : null, prompt);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '蒙版保存失败'); }
    finally { setSaving(false); }
  }

  // ESC 关闭
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, saving]);

  if (!open) return null;

  return (
    /* Inpaint modal (照搬 Stitch 单图稿 MASK INPAINTING MODAL, 类名原样) */
    <div
      className="fixed inset-0 z-50 bg-inverse-surface/60 backdrop-blur-md flex items-center justify-center p-space-md"
      role="dialog"
      aria-modal="true"
      aria-label="局部重绘工作区"
      onClick={saving ? undefined : onClose}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-4xl bg-surface-bright rounded-2xl shadow-[0_24px_64px_rgba(85,95,75,0.20)] overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Inpaint Header Bar */}
        <div className="px-space-lg py-space-md bg-surface-container-low flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Brush size={20} aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-headline-sm text-headline-sm text-on-surface">局部重绘修整 (Mask Inpainting)</h3>
              <p className="font-meta-sm text-meta-sm text-on-surface-variant">
                涂抹需要修改的区域, 沿用原图参数与画风. 保存后点击开始局部重绘
              </p>
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface flex items-center justify-center transition-colors"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Canvas Viewport & Tooling Toolbar */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col md:flex-row">
          {/* Left Sub-tools Bar */}
          <div className="p-space-md bg-surface-container-lowest flex flex-wrap md:flex-col gap-space-md items-center md:items-start shrink-0">
            <div className="space-y-1">
              <span className="font-meta-sm text-meta-sm text-on-surface-variant uppercase">画笔尺寸</span>
              <div className="flex items-center gap-2">
                <input
                  className="w-24 accent-primary cursor-pointer"
                  max={MAX_BRUSH}
                  min={MIN_BRUSH}
                  type="range"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                  aria-label="画笔尺寸"
                />
                <span className="font-meta-sm text-meta-sm text-on-surface">{brushSize}px</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:flex md:flex-col gap-1 w-full">
              <button
                type="button"
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-body-sm text-body-sm w-full transition-colors ${tool === 'brush' ? 'bg-secondary-container text-on-secondary-container' : 'hover:bg-surface-container text-on-surface'}`}
                onClick={() => setTool('brush')}
              >
                <Brush size={18} aria-hidden="true" />
                <span>涂抹蒙版</span>
              </button>
              <button
                type="button"
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-body-sm text-body-sm w-full transition-colors ${tool === 'eraser' ? 'bg-secondary-container text-on-secondary-container' : 'hover:bg-surface-container text-on-surface'}`}
                onClick={() => setTool('eraser')}
              >
                <Eraser size={18} aria-hidden="true" />
                <span>橡皮擦</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-surface-container text-on-surface font-body-sm text-body-sm w-full"
                onClick={undo}
                disabled={strokes.length === 0}
              >
                <RotateCcw size={18} aria-hidden="true" />
                <span>撤销</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-surface-container text-error font-body-sm text-body-sm w-full"
                onClick={clearMask}
                disabled={strokes.length === 0 && !baseMaskDataUrl}
              >
                <Trash2 size={18} aria-hidden="true" />
                <span>清空蒙版</span>
              </button>
            </div>
          </div>
          {/* Center Inpaint Interactive Preview Canvas */}
          <div className="flex-1 min-w-0 bg-surface-container-low p-space-lg flex items-center justify-center relative">
            <div className="relative w-fit max-w-full rounded-xl overflow-hidden shadow-lg select-none" ref={frameRef}>
              <img
                className="block w-auto max-w-full max-h-[54vh] object-contain"
                src={image.dataUrl}
                alt={image.name}
                draggable={false}
                onLoad={repaint}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{ cursor: 'crosshair', touchAction: 'none' }}
                aria-label="蒙版画布, 按住拖动涂抹"
              />
            </div>
          </div>
        </div>

        {/* Inpaint Bottom Prompt Input & Submit */}
        {error && <p role="alert" className="px-space-md py-2 text-error text-body-sm">{error}</p>}
        <div className="p-space-md bg-surface-container-lowest flex flex-col sm:flex-row items-center gap-space-md">
          <div className="relative flex-1 w-full bg-surface-container-low rounded-xl px-space-md py-2 flex items-center gap-2">
            <StitchIcon name="edit_note" size={20} className="text-primary" />
            <input
              className="w-full min-w-0 bg-transparent border-0 outline-none font-body-sm text-body-sm"
              aria-label="局部重绘提示词"
              placeholder="描述希望如何修改涂抹区域..."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <span className="font-meta-sm text-meta-sm text-outline shrink-0" aria-live="polite">
              {strokeCount} 处笔触
            </span>
          </div>
          <div className="flex items-center gap-space-sm w-full sm:w-auto justify-end">
            <button
              type="button"
              className="px-space-md py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-body-sm text-body-sm"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="px-space-lg py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              onClick={() => void apply()}
              disabled={saving || (strokes.length === 0 && !initialMask && !initialMaskDataUrl)}
            >
              <Brush size={16} aria-hidden="true" />
              <span>{saving ? '保存中...' : '保存并应用蒙版'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
