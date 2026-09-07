const MAX_RESULT_BYTES = 64 * 1024 * 1024;

export async function readLimitedBody(response, limit = MAX_RESULT_BYTES) {
  const size = Number(response.headers.get('content-length'));
  if (size > limit) throw new Error('上游返回的图片超过 64MB');
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error('上游返回的图片超过 64MB');
    return bytes;
  }
  let sizeSoFar = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    sizeSoFar += bytes.length;
    if (sizeSoFar > limit) throw new Error('上游返回的图片超过 64MB');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export function imageInfo(bytes) {
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') {
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width && height) return { mime_type: 'image/png', width, height };
  }
  if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = bytes.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { mime_type: 'image/jpeg', width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) {
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X' && bytes.length >= 30) return { mime_type: 'image/webp', width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    if (type === 'VP8 ' && bytes.length >= 30) return { mime_type: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (type === 'VP8L' && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      return { mime_type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  throw new Error('上游没有返回有效的 PNG, JPEG 或 WebP 图片');
}

export async function normalizeImageResult(result) {
  if (!result.ok) return { ...result, contentType: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify({ error: result.error || '上游请求失败' })) };
  try {
    const value = JSON.parse(result.body.toString('utf8'));
    if (!Array.isArray(value.data) || !value.data.length) throw new Error('上游没有返回图片');
    if (value.data.length > 4) throw new Error('上游返回的图片数量超出本次请求');
    const data = [];
    let totalBytes = 0;
    for (const item of value.data) {
      let bytes;
      if (item.b64_json) {
        if (!/^[A-Za-z0-9+/\s]+={0,2}$/.test(item.b64_json)) throw new Error('上游图片编码无效');
        bytes = Buffer.from(item.b64_json, 'base64');
      } else if (typeof item.url === 'string') {
        const url = new URL(item.url);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('上游图片链接协议无效');
        if (/^(localhost|127\.|0\.|\[?::1\]?|169\.254\.)/i.test(url.hostname)) throw new Error('上游图片链接不是公开资源');
        const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`图片下载失败: HTTP ${response.status}`);
        bytes = await readLimitedBody(response);
      } else throw new Error('上游没有返回图片文件');
      totalBytes += bytes.length;
      if (totalBytes > MAX_RESULT_BYTES * 0.74) throw new Error('上游图片文件总量过大');
      data.push({ b64_json: bytes.toString('base64'), ...imageInfo(bytes), bytes: bytes.length, revised_prompt: typeof item.revised_prompt === 'string' ? item.revised_prompt.slice(0, 32000) : '' });
    }
    return { ...result, status: 200, contentType: 'application/json; charset=utf-8', cacheControl: 'no-store', body: Buffer.from(JSON.stringify({ data, created: value.created || Math.floor(Date.now() / 1000) })) };
  } catch (error) {
    const message = `生成接口已响应, 但图片读取失败: ${error.message}. 未自动重复生成.`;
    return { status: 502, ok: false, outcomeUnknown: true, contentType: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify({ error: message })), error: message };
  }
}
