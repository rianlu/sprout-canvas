import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockedV4.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  blockedV6.addSubnet(address, prefix, 'ipv6');
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  // Native global unicast only: also rejects mapped IPv4, local and translation ranges.
  return family === 6 && globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
}

function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
}

export function createImageDownloader({ lookup = dnsLookup, requestHttp = httpRequest, requestHttps = httpsRequest } = {}) {
  return async function download(input, { maxBytes = 64 * 1024 * 1024, timeoutMs = 60000, maxRedirects = 3 } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('图片下载超时')), timeoutMs);
    timeout.unref?.();
    const signal = controller.signal;
    try {
      let url = new URL(input);
      for (let hop = 0; hop <= maxRedirects; hop++) {
        signal.throwIfAborted();
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('上游图片链接必须是普通 HTTP(S) 地址');
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const family = isIP(hostname);
        const addresses = family ? [{ address: hostname, family }] : await withAbort(lookup(hostname, { all: true, verbatim: true }), signal);
        if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error('上游图片链接不是公开资源');
        // Pin the checked DNS answers to the actual connection, including every redirect.
        const options = {
          agent: false,
          signal,
          headers: { Accept: 'image/png,image/jpeg,image/webp', 'Accept-Encoding': 'identity' },
          lookup(_hostname, lookupOptions, callback) {
            if (lookupOptions?.all) callback(null, addresses);
            else {
              const selected = addresses.find((item) => item.family === lookupOptions?.family) || addresses[0];
              callback(null, selected.address, selected.family);
            }
          },
        };
        const response = await new Promise((resolve, reject) => {
          const request = (url.protocol === 'https:' ? requestHttps : requestHttp)(url, options, resolve);
          request.once('error', reject);
          request.end();
        });
        try {
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            if (hop === maxRedirects || !response.headers.location) throw new Error('图片下载重定向无效或次数过多');
            url = new URL(response.headers.location, url);
            continue;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`图片下载失败: HTTP ${response.statusCode}`);
          if (Number(response.headers['content-length']) > maxBytes) throw new Error('上游返回的图片过大');
          let bytes = 0;
          const chunks = [];
          for await (const chunk of response) {
            signal.throwIfAborted();
            const buffer = Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > maxBytes) throw new Error('上游返回的图片过大');
            chunks.push(buffer);
          }
          return Buffer.concat(chunks);
        } finally {
          response.destroy();
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  };
}

export const downloadImage = createImageDownloader();
