import { dataUrlToBlob, fileToDataUrl, imageFromDataUrl, imageMime } from './data-url';

const MAX_SOURCE_SIZE = 50 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024;
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.86;

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))), mime, quality);
  });
}

function jpegName(name: string) {
  return name.replace(/\.[^.]+$/, '') + '.jpg';
}

async function blobToDataUrl(blob: Blob, name: string) {
  return fileToDataUrl(new File([blob], name, { type: blob.type || 'image/jpeg' }));
}

async function compressImageDataUrl(name: string, sourceDataUrl: string) {
  const image = await imageFromDataUrl(sourceDataUrl);
  const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
  let targetSide = Math.min(largestSide, MAX_DIMENSION);
  let quality = JPEG_QUALITY;
  let lastBlob: Blob | null = null;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const scale = targetSide / largestSide;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建图片画布');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    lastBlob = blob;
    if (blob.size <= MAX_UPLOAD_SIZE) {
      const nextName = jpegName(name);
      return { name: nextName, dataUrl: await blobToDataUrl(blob, nextName), size: blob.size };
    }
    targetSide = Math.max(900, Math.round(targetSide * 0.82));
    quality = Math.max(0.68, quality - 0.05);
  }

  throw new Error(`${name} 压缩后仍超过 ${Math.ceil(MAX_UPLOAD_SIZE / 1024 / 1024)}MB${lastBlob ? ` (${Math.ceil(lastBlob.size / 1024)}KB)` : ''}`);
}

export async function prepareImageDataUrl(name: string, sourceDataUrl: string, sourceSize?: number) {
  if (!sourceDataUrl.startsWith('data:image/')) return { name, dataUrl: sourceDataUrl, size: sourceSize ?? sourceDataUrl.length };
  const sourceBlob = dataUrlToBlob(sourceDataUrl);
  if (sourceBlob.size > MAX_SOURCE_SIZE) throw new Error(`${name} 超过 50MB`);
  const image = await imageFromDataUrl(sourceDataUrl);
  const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const shouldCompress = sourceBlob.size > MAX_UPLOAD_SIZE || largestSide > MAX_DIMENSION || imageMime(sourceDataUrl) !== 'image/jpeg';
  if (!shouldCompress) return { name, dataUrl: sourceDataUrl, size: sourceBlob.size };
  return compressImageDataUrl(name, sourceDataUrl);
}

export async function prepareImageFile(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > MAX_SOURCE_SIZE) throw new Error(`${file.name} 超过 50MB`);
  const sourceDataUrl = await fileToDataUrl(file);
  return prepareImageDataUrl(file.name, sourceDataUrl, file.size);
}
