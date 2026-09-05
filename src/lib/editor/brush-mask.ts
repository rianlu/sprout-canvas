import { imageFromDataUrl } from '../image/data-url';

/**
 * 画笔蒙版 — 与矩形蒙版 (mask.ts) 保持同一输出语义:
 * 黑色不透明 = 保留区, 透明 = 重绘区.
 * 笔画以归一化坐标记录, 支持撤销栈与重放导出.
 */

export interface BrushStroke {
  /** 归一化坐标点列 (0-1) */
  points: Array<{ x: number; y: number }>;
  /** 归一化直径 (相对画布短边) */
  size: number;
  mode: 'brush' | 'eraser';
}

export interface BrushMaskData {
  width: number;
  height: number;
  strokes: BrushStroke[];
}

export function brushStrokeCount(mask: BrushMaskData | null): number {
  return mask ? mask.strokes.filter((stroke) => stroke.mode === 'brush').length : 0;
}

/** 把笔画重放到蒙版画布上 (预览与导出共用) */
function paintStrokes(context: CanvasRenderingContext2D, strokes: BrushStroke[], width: number, height: number) {
  const base = Math.min(width, height);
  for (const stroke of strokes) {
    const radius = (stroke.size * base) / 2;
    context.lineWidth = radius * 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.globalCompositeOperation = stroke.mode === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = '#000';
    context.beginPath();
    if (stroke.points.length === 0) continue;
    let started = false;
    for (const point of stroke.points) {
      const px = point.x * width;
      const py = point.y * height;
      if (!started) {
        context.moveTo(px, py);
        context.lineTo(px + 0.01, py);
        started = true;
      } else {
        context.lineTo(px, py);
      }
    }
    context.stroke();
  }
  context.globalCompositeOperation = 'source-over';
}

/** 判断蒙版是否包含有效重绘区 (透明像素) */
export async function hasEditableRegion(mask: BrushMaskData, imageDataUrl: string): Promise<boolean> {
  const image = await imageFromDataUrl(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  paintStrokes(context, mask.strokes, canvas.width, canvas.height);
  try {
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true; // 存在透明像素 (重绘区)
    }
  } catch { /* tainted canvas 时保守返回 true */ return true; }
  return false;
}

/** 导出蒙版 dataUrl (黑底 + 笔画透明区) */
export async function brushMaskToDataUrl(mask: BrushMaskData, imageDataUrl: string): Promise<string> {
  const image = await imageFromDataUrl(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建蒙版');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  paintStrokes(context, mask.strokes, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
