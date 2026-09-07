import type { QueueResult } from '../../types/queue';
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

function imageMimeFromBase64(base64: string) {
  const bytes = atob(base64.slice(0, 48));
  if (bytes.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (bytes.startsWith('\xff\xd8\xff')) return 'image/jpeg';
  if (bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP') return 'image/webp';
  throw new Error('返回内容不是可识别的图片');
}

export async function resultDataUrls(result: QueueResult): Promise<string[]> {
  if (!result.data?.length) throw new Error('任务未返回图片文件');
  const output: string[] = [];
  for (const item of result.data) {
    if (item.b64_json) output.push(`data:${imageMimeFromBase64(item.b64_json)};base64,${item.b64_json}`);
    else if (item.url) {
      const dataUrl = item.url.startsWith('data:image/') ? item.url : await imageUrlToDataUrl(item.url);
      const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
      output.push(`data:${imageMimeFromBase64(payload)};base64,${payload}`);
    } else throw new Error('任务未返回可保存的图片文件');
  }
  return output;
}

export async function resultDataUrl(result: QueueResult) { return (await resultDataUrls(result))[0]; }
