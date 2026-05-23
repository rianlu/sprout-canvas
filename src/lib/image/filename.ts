export function buildDownloadName(prompt: string, createdAt: number, ext: string = 'png'): string {
  const cleanPrompt = (prompt || '')
    .replace(/\s+/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 20);
  const stamp = Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
  const base = cleanPrompt ? `${cleanPrompt}_${date}` : date;
  return `${base}.${ext}`;
}
