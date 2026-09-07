import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, value) {
  const content = Buffer.concat([Buffer.from(type), value]);
  const header = Buffer.alloc(4), checksum = Buffer.alloc(4);
  header.writeUInt32BE(value.length); checksum.writeUInt32BE(crc32(content));
  return Buffer.concat([header, content, checksum]);
}
export function png(width = 2, height = 2, color = [85, 120, 70, 255]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) color.forEach((value, channel) => { pixels[y * (width * 4 + 1) + 1 + x * 4 + channel] = value; });
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export const PNG = png();
export const PNG_BASE64 = PNG.toString('base64');
export const PNG_URL = `data:image/png;base64,${PNG_BASE64}`;
export const MASK_URL = `data:image/png;base64,${png(2, 2, [0, 0, 0, 0]).toString('base64')}`;
export function submission(requestId, changes = {}) {
  return { requestId, request: { prompt: '画一片叶子', size: '1024x1024', quality: 'medium', outputFormat: 'png', background: 'auto', outputCompression: 90, references: [], ...changes }, clientContext: { kind: 'single', placeholderId: `art-${requestId}`, prompt: '画一片叶子', mode: 'text' } };
}
