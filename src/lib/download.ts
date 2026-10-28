/**
 * Saves a Blob or data URL under a file name through a temporary link. Blob URLs are released after the browser
 * has taken over the download.
 */
export function saveFile(file: Blob | string, filename: string) {
  const url = typeof file === 'string' ? file : URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  if (typeof file !== 'string') window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
