import type { RectSelection } from '../../types/generation';
import { imageFromDataUrl } from '../image/data-url';

export async function createRectMaskDataUrl(imageDataUrl: string, rect: RectSelection): Promise<string> {
  const image = await imageFromDataUrl(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建蒙版');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.clearRect(rect.x * canvas.width, rect.y * canvas.height, rect.width * canvas.width, rect.height * canvas.height);
  return canvas.toDataURL('image/png');
}
