const ASKED_KEY = 'sprout_canvas_persist_asked_at';
const ASK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Works live only in this browser, so ask it not to evict them under storage pressure.
 * Call from a user action that saves work: Chromium and Safari decide silently, Firefox shows
 * its own prompt, so a declined or dismissed request waits a week before asking again.
 */
export function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return;
    const asked = Number(localStorage.getItem(ASKED_KEY) || 0);
    if (Date.now() - asked < ASK_INTERVAL_MS) return;
    localStorage.setItem(ASKED_KEY, String(Date.now()));
    void navigator.storage.persist().catch(() => {});
  } catch { /* Storage access can be blocked; generation goes on without persistence. */ }
}
