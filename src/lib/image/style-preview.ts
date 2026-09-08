import { STYLE_LIMITS } from '../../../shared/style-contract.mjs';

/** Normalize library examples only. Generation references and original artworks never use this path. */
export async function prepareStylePreview(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG, JPEG 或 WebP 图片');
  if (!file.size || file.size > STYLE_LIMITS.imageBytes) throw new Error('示例图不能超过 12 MB');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw new Error('图片内容无法读取, 请重新选择 PNG, JPEG 或 WebP 图片'); }
    if (image.naturalWidth * image.naturalHeight > 40000000) throw new Error('示例图尺寸过大, 请先缩小图片');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理示例图');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.88);
  } finally { URL.revokeObjectURL(url); }
}
