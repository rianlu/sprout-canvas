import { createHash } from 'node:crypto';
import { MAX_REFERENCE_BYTES, requestError } from '../shared/generation-contract.mjs';
import { imageInfo } from './image-result.mjs';

export function imageHash(dataUrl) {
  return createHash('sha256').update(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')).digest('hex');
}

export function validateSubmissionImages(input) {
  function inspect(dataUrl, label) {
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    if (bytes.length > MAX_REFERENCE_BYTES) throw requestError(`${label} 超过 12MB`);
    let info;
    try { info = imageInfo(bytes); } catch { throw requestError(`${label} 文件损坏或格式无效`); }
    if (!dataUrl.startsWith(`data:${info.mime_type};`)) throw requestError(`${label} 的文件格式与内容不一致`);
    if (!info.width || !info.height || info.width * info.height > 64 * 1024 * 1024) throw requestError(`${label} 的像素尺寸无效或过大`);
    return { ...info, bytes };
  }
  const references = input.request.references.map((ref, index) => inspect(ref.dataUrl, `参考图 ${index + 1}`));
  if (input.referenceImage) inspect(input.referenceImage.dataUrl, '首镜参考图片');
  if (input.request.mask) {
    const mask = inspect(input.request.mask, '蒙版');
    if (mask.mime_type !== 'image/png' || ![4, 6].includes(mask.bytes[25]) && !mask.bytes.includes(Buffer.from('tRNS'))) throw requestError('蒙版需要带透明通道的 PNG');
    if (mask.width !== references[0].width || mask.height !== references[0].height) throw requestError('蒙版尺寸必须与第一张参考图完全一致');
  }
}
