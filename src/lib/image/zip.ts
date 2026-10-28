import { zipSync, type Zippable } from 'fflate';
import { saveFile } from '../download';

/** ZIP archives on fflate. Images are already compressed, so entries are stored (level 0) for speed. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Entries keep their order; a repeated name gets a numbered suffix instead of replacing the earlier file. */
export function buildZip(entries: ZipEntry[]): Blob {
  const files: Zippable = {};
  for (const entry of entries) {
    let name = entry.name;
    for (let copy = 2; name in files; copy++) name = entry.name.replace(/(\.[^.]*)?$/, (ext) => ` (${copy})${ext}`);
    files[name] = [entry.data, { level: 0, mtime: new Date() }];
  }
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** 把一组 dataUrl 图片打包下载 */
export async function downloadZip(items: { name: string; dataUrl: string }[], zipName: string): Promise<void> {
  saveFile(buildZip(items.map((item) => ({ name: item.name, data: dataUrlToBytes(item.dataUrl) }))), zipName);
}
