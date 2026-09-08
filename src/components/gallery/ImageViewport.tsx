import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { StitchIcon } from '../ui/StitchIcon';

interface ImageViewportProps {
  src?: string;
  alt: string;
  error?: string;
  fullscreen: boolean;
  onFullscreen: () => void;
  onDownload: () => void;
}

type Point = { x: number; y: number };
type View = Point & { scale: number | null };
type Size = { width: number; height: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keep viewport controls outside the image transform; percentages refer to original pixels. */
export function ImageViewport({ src, alt, error, fullscreen, onFullscreen, onDownload }: ImageViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [imageError, setImageError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<View>({ scale: null, x: 0, y: 0 });
  const viewRef = useRef(view);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ center: Point; distance: number; scale: number; pan: Point } | null>(null);
  const fitScale = natural.width && natural.height && viewport.width && viewport.height
    ? Math.min(Math.max(1, viewport.width - 24) / natural.width, Math.max(1, viewport.height - 24) / natural.height)
    : 1;
  const geometry = useRef({ viewport, natural, fitScale });
  geometry.current = { viewport, natural, fitScale };
  const scale = view.scale ?? fitScale;
  const minScale = Math.min(0.1, fitScale);
  const maxScale = Math.max(8, fitScale);
  const canPan = natural.width * scale > viewport.width || natural.height * scale > viewport.height;

  const updateView = useCallback((next: View) => {
    const { viewport, natural, fitScale } = geometry.current;
    const scale = next.scale === null ? fitScale : clamp(next.scale, Math.min(0.1, fitScale), Math.max(8, fitScale));
    const limitX = Math.max(0, (natural.width * scale - viewport.width) / 2);
    const limitY = Math.max(0, (natural.height * scale - viewport.height) / 2);
    const value = { scale: next.scale === null ? null : scale, x: clamp(next.x, -limitX, limitX), y: clamp(next.y, -limitY, limitY) };
    viewRef.current = value;
    setView(value);
  }, []);

  const zoomAt = useCallback((nextScale: number, anchor: Point = { x: 0, y: 0 }) => {
    const current = viewRef.current;
    const fit = geometry.current.fitScale;
    const scale = clamp(nextScale, Math.min(0.1, fit), Math.max(8, fit));
    const ratio = scale / (current.scale ?? fit);
    updateView({ scale, x: anchor.x - (anchor.x - current.x) * ratio, y: anchor.y - (anchor.y - current.y) * ratio });
  }, [updateView]);

  const resetView = () => updateView({ scale: null, x: 0, y: 0 });

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => { updateView(viewRef.current); }, [viewport, natural, updateView]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || !ready) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      const current = viewRef.current.scale ?? geometry.current.fitScale;
      zoomAt(current * Math.exp(-clamp(delta, -500, 500) * 0.002), { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 });
    };
    // Keep native touch panning from consuming the first toolbar tap after a custom drag.
    const touchMove = (event: TouchEvent) => event.preventDefault();
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('touchmove', touchMove, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('touchmove', touchMove);
    };
  }, [ready, zoomAt]);

  const eventPoint = (event: PointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
  };
  const pointerGeometry = () => {
    const [first, second] = [...pointers.current.values()];
    return first ? {
      center: second ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } : first,
      distance: second ? Math.hypot(second.x - first.x, second.y - first.y) : 0,
    } : null;
  };
  const beginGesture = () => {
    const points = pointerGeometry();
    gesture.current = points ? { ...points, scale: viewRef.current.scale ?? geometry.current.fitScale, pan: { x: viewRef.current.x, y: viewRef.current.y } } : null;
  };
  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    beginGesture();
    if (!pointers.current.size) setDragging(false);
  };

  return (
    <section className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div role="toolbar" aria-label="图片查看工具" className="viewer-image-toolbar flex items-center gap-1 px-2 sm:px-3 py-2 shrink-0 bg-surface-container-lowest border-b border-outline-variant/30 font-body-sm text-body-sm">
        <button type="button" className="viewer-tool-button" aria-label="缩小图片" title="缩小图片 (-)" disabled={!ready || scale <= minScale + 0.0001} onClick={() => zoomAt(scale / 1.25)}><StitchIcon name="zoom_out" size={20} /></button>
        <output aria-label="缩放比例" aria-live="off" className="w-12 text-center font-meta-sm text-meta-sm tabular-nums text-on-surface-variant">{ready ? `${Math.round(scale * 100)}%` : '--'}</output>
        <button type="button" className="viewer-tool-button" aria-label="放大图片" title="放大图片 (+)" disabled={!ready || scale >= maxScale - 0.0001} onClick={() => zoomAt(scale * 1.25)}><StitchIcon name="zoom_in" size={20} /></button>
        <button type="button" className="viewer-tool-button px-2 gap-1" aria-label="适应窗口" title="适应窗口 (0)" aria-pressed={view.scale === null} disabled={!ready} onClick={resetView}><StitchIcon name="fit_screen" size={18} /><span className="hidden sm:inline">适应窗口</span></button>
        <button type="button" className="viewer-tool-button px-2" aria-label="原始大小" title="原始大小 (100%)" aria-pressed={view.scale === 1} disabled={!ready} onClick={() => updateView({ scale: 1, x: 0, y: 0 })}>100%</button>
        <span className="flex-1" />
        <button type="button" className="viewer-tool-button" aria-label="下载当前图片" title="下载当前图片" onClick={onDownload}><StitchIcon name="download" size={20} /></button>
        <button type="button" className="viewer-tool-button" aria-label={fullscreen ? '退出全屏' : '进入全屏'} title={fullscreen ? '退出全屏' : '进入全屏'} onClick={onFullscreen}><StitchIcon name={fullscreen ? 'fullscreen_exit' : 'fullscreen'} size={20} /></button>
      </div>
      <div
        ref={viewportRef}
        role="region"
        aria-label="图片查看区"
        aria-description="滚轮或双指缩放, 拖动查看细节. 双击切换放大与适应窗口; 加减键缩放, 0 适应窗口, Shift 加方向键移动图片."
        tabIndex={0}
        className="gallery-image-viewport flex-1 min-h-0 relative overflow-hidden bg-surface-container-low outline-offset-[-3px]"
        style={{ touchAction: 'none', cursor: !ready ? 'default' : dragging && canPan ? 'grabbing' : canPan ? 'grab' : 'zoom-in' }}
        onPointerDown={(event) => {
          if (!ready || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, eventPoint(event));
          beginGesture();
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, eventPoint(event));
          const current = pointerGeometry();
          const start = gesture.current;
          if (!current || !start) return;
          if (pointers.current.size > 1 && start.distance > 0) {
            const nextScale = clamp(start.scale * current.distance / start.distance, minScale, maxScale);
            const ratio = nextScale / start.scale;
            updateView({ scale: nextScale, x: current.center.x - (start.center.x - start.pan.x) * ratio, y: current.center.y - (start.center.y - start.pan.y) * ratio });
          } else {
            updateView({ scale: viewRef.current.scale, x: start.pan.x + current.center.x - start.center.x, y: start.pan.y + current.center.y - start.center.y });
          }
        }}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onLostPointerCapture={endPointer}
        onDoubleClick={() => {
          if (!ready) return;
          if (view.scale === null) zoomAt(Math.max(1, fitScale * 2));
          else resetView();
        }}
        onKeyDown={(event) => {
          if (!ready) return;
          if (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '0') {
            event.preventDefault(); event.stopPropagation();
            if (event.key === '0') resetView();
            else zoomAt(scale * (event.key === '-' ? 0.8 : 1.25));
          } else if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            updateView({ ...view, x: view.x + (event.key === 'ArrowLeft' ? 48 : event.key === 'ArrowRight' ? -48 : 0), y: view.y + (event.key === 'ArrowUp' ? 48 : event.key === 'ArrowDown' ? -48 : 0) });
          }
        }}
      >
        {src && !error && !imageError && <img
          src={src}
          alt={alt}
          draggable={false}
          className="gallery-viewer-image absolute left-1/2 top-1/2 select-none pointer-events-none"
          style={{ width: natural.width, height: natural.height, maxWidth: 'none', maxHeight: 'none', visibility: ready ? 'visible' : 'hidden', transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${scale})`, willChange: dragging ? 'transform' : undefined }}
          onLoad={(event) => { setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setReady(true); }}
          onError={() => { setImageError('图片加载失败, 请重新打开查看'); setReady(false); }}
        />}
        {(error || imageError) ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-error"><StitchIcon name="broken_image" size={32} /><p role="alert" className="font-body-md text-body-md">{error || imageError}</p></div> : !ready && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-on-surface-variant"><StitchIcon name="image" size={32} /><p role="status" className="font-body-sm text-body-sm">正在加载原图...</p></div>}
      </div>
    </section>
  );
}
