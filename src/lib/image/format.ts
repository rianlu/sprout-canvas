import type { ImageOutputFormat } from '../../types/generation';

export function formatBytes(bytes: number) {
  const kb = bytes / 1024;
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
}

export function normalizeImageOutputFormat(format?: string): ImageOutputFormat {
  const value = String(format || '').toLowerCase();
  if (value === 'jpg' || value === 'jpeg') return 'jpeg';
  if (value === 'webp') return 'webp';
  if (value === 'png') return 'png';
  return 'auto';
}

function mimeFromFormat(format?: string) {
  const normalized = normalizeImageOutputFormat(format);
  if (normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'webp') return 'image/webp';
  return 'image/png';
}

export function dataUrlFormat(dataUrl: string): ImageOutputFormat | '' {
  const mime = dataUrl.match(/^data:([^;,]+)/)?.[1]?.toLowerCase() || '';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpeg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/png') return 'png';
  return '';
}

export function imageFileExtension(dataUrl: string, preferredFormat?: string) {
  const format = dataUrlFormat(dataUrl) || normalizeImageOutputFormat(preferredFormat) || 'png';
  if (format === 'jpeg') return 'jpg';
  if (format === 'webp') return 'webp';
  return 'png';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('图片结果转换失败'));
    reader.readAsDataURL(blob);
  });
}

async function imageUrlToDataUrl(url: string, preferredFormat?: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片 URL 下载失败: HTTP ${response.status}`);
  const blob = await response.blob();
  if (blob.type) return blobToDataUrl(blob);
  return blobToDataUrl(new Blob([blob], { type: mimeFromFormat(preferredFormat) }));
}

export async function resultDataUrl(result: { data?: Array<{ b64_json?: string; url?: string }> }, preferredFormat?: string) {
  const item = result.data?.[0];
  if (item?.b64_json) return `data:${mimeFromFormat(preferredFormat)};base64,${item.b64_json}`;
  if (!item?.url) return '';
  if (item.url.startsWith('data:image/')) return item.url;
  try {
    return await imageUrlToDataUrl(item.url, preferredFormat);
  } catch {
    return item.url;
  }
}
