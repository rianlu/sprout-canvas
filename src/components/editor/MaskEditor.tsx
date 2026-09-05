import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Eraser, Minus, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { RefImage } from '../../types/generation';
import { brushStrokeCount, type BrushMaskData, type BrushStroke } from '../../lib/editor/brush-mask';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface MaskEditorProps {
  image: RefImage;
  open: boolean;
  onClose: () => void;
  onApply: (mask: BrushMaskData | null) => void;
  initialMask?: BrushMaskData | null;
  /** 底部区域提示词 (可选, 应用时随蒙版生效) */
  regionPrompt?: string;
}

const MIN_BRUSH = 5;
const MAX_BRUSH = 80;
const DEFAULT_BRUSH = 32;

export function MaskEditor({ image, open, onClose, onApply, initialMask, regionPrompt }: MaskEditorProps) {
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH);
  const [strokes, setStrokes] = useState<BrushStroke[]>(() => (initialMask ? [...initialMask.strokes] : []));
  const [drawing, setDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  const strokeCount = brushStrokeCount({ strokes } as BrushMaskData);

  // 重置 (打开新图时)
  useEffect(() => {
    if (open) setStrokes(initialMask ? [...initialMask.strokes] : []);
  }, [open, initialMask]);

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
        if (!started) { context.moveTo(px, py); context.lineTo(px + 0.01, py); started = true; }
        else context.lineTo(px, py);
      }
      context.stroke();
    }
    context.globalCompositeOperation = 'source-over';
  }, [strokes]);

  useEffect(() => {
    if (open) repaint();
  }, [open, repaint]);

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
    const stroke: BrushStroke = { points: [point], size: brushSize / 100, mode: tool };
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

  function onPointerUp() { setDrawing(false); }

  function undo() { setStrokes((current) => current.slice(0, -1)); }
  function clearMask() { setStrokes([]); }

  function apply() {
    if (strokes.length === 0) { onApply(null); return; }
    onApply({ strokes, width: 0, height: 0 });
  }

  // ESC 关闭
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mask-editor-overlay" role="dialog" aria-modal="true" aria-label="局部重绘工作区">
      <button type="button" className="backdrop" onClick={onClose} aria-label="关闭蒙版编辑器" />
      <div ref={dialogRef} className="mask-editor-panel">
        <div className="mask-editor-head">
          <div className="head-copy">
            <span className="head-icon"><Brush size={18} aria-hidden="true" /></span>
            <div>
              <h2>局部重绘</h2>
              <p>涂抹要修改的区域; 蒙版外区域尽量保持不变</p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="mask-editor-main">
          <div className="mask-editor-tools">
            <div className="tool-group">
              <span className="tool-label">工具</span>
              <button type="button" className={`tool-btn ${tool === 'brush' ? 'active' : ''}`} onClick={() => setTool('brush')}>
                <Brush size={15} aria-hidden="true" />涂抹蒙版
              </button>
              <button type="button" className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')}>
                <Eraser size={15} aria-hidden="true" />橡皮擦
              </button>
            </div>

            <div className="tool-group">
              <span className="tool-label">画笔尺寸</span>
              <div className="brush-size-row">
                <button type="button" className="icon-btn" onClick={() => setBrushSize((s) => Math.max(MIN_BRUSH, s - 5))} aria-label="缩小画笔"><Minus size={13} /></button>
                <input type="range" min={MIN_BRUSH} max={MAX_BRUSH} value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))} aria-label="画笔尺寸" />
                <button type="button" className="icon-btn" onClick={() => setBrushSize((s) => Math.min(MAX_BRUSH, s + 5))} aria-label="放大画笔"><Plus size={13} /></button>
                <span className="size-value">{brushSize}px</span>
              </div>
            </div>

            <div className="tool-group">
              <span className="tool-label">操作</span>
              <button type="button" className="tool-btn" onClick={undo} disabled={strokes.length === 0}>
                <RotateCcw size={15} aria-hidden="true" />撤销
              </button>
              <button type="button" className="tool-btn danger" onClick={clearMask} disabled={strokes.length === 0}>
                <Trash2 size={15} aria-hidden="true" />清空蒙版
              </button>
            </div>
          </div>

          <div className="mask-editor-canvas-area">
            <div className="mask-canvas-frame" ref={frameRef}>
              <img src={image.dataUrl} alt={image.name} draggable={false} />
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                style={{ cursor: 'crosshair' }}
                aria-label="蒙版画布, 按住拖动涂抹"
              />
            </div>
          </div>
        </div>

        <div className="mask-editor-foot">
          <span className="t-meta" style={{ color: 'var(--muted)' }}>
            {strokeCount > 0 ? `已涂抹 ${strokeCount} 处` : '还没有涂抹区域'}
            {regionPrompt ? ' · 已有区域提示词' : ''}
          </span>
          <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="button" className="btn btn-primary" onClick={apply} disabled={strokes.length === 0}>
              保存并应用蒙版
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
