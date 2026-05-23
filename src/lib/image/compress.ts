import { fileToDataUrl, imageFromDataUrl } from './data-url';

const MAX_SOURCE_SIZE = 50 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024;
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.86;

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))), mime, quality);
  });
}

export async function prepareImageFile(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > MAX_SOURCE_SIZE) throw new Error(`${file.name} 超过 50MB`);
  const sourceDataUrl = await fileToDataUrl(file);
  const image = await imageFromDataUrl(sourceDataUrl);
  const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = largestSide > MAX_DIMENSION ? MAX_DIMENSION / largestSide : 1;
  const shouldCompress = file.size > MAX_UPLOAD_SIZE || scale < 1 || file.type !== 'image/jpeg';
  if (!shouldCompress) return { name: file.name, dataUrl: sourceDataUrl, size: file.size };

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图片画布');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  const dataUrl = await fileToDataUrl(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
  if (blob.size > MAX_UPLOAD_SIZE) throw new Error(`${file.name} 压缩后仍超过 2MB`);
  return { name: file.name.replace(/\.[^.]+$/, '.jpg'), dataUrl, size: blob.size };
}
