const PREFIX = 'sprout_canvas_draft_';

export function readDraft(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) || '';
  } catch {
    return '';
  }
}

export function writeDraft(key: string, value: string) {
  try {
    if (value && value.trim()) localStorage.setItem(PREFIX + key, value);
    else localStorage.removeItem(PREFIX + key);
    return true;
  } catch {
    window.dispatchEvent(new CustomEvent('sprout:storage-error', { detail: '草稿未能保存, 请检查浏览器可用空间' }));
    return false;
  }
}
