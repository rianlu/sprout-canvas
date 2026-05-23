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
  } catch {
    // ignore quota / privacy mode errors
  }
}
