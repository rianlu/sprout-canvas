import { apiFetch, ApiError } from './client';
import { getCreditQuote } from '../credits';
import { randomId } from '../random/id';
import { readWorkspaceDraft, writeWorkspaceDraft } from '../storage/gallery-db';

interface PendingText { requestId: string; signature: string; sceneCount?: number }
interface TextResult { text: string; providerName?: string; attempts?: unknown[] }
// The server has settled these requests. Clear them so the next click creates a new request instead of replaying.
const SETTLED = ['TEXT_FAILED', 'OUTCOME_UNKNOWN', 'TEXT_RESULT_EXPIRED'];
// The server composes the instructions for each kind, so a pending request matches on the user's content and scene count only.
export async function requestTextGeneration(content: string, kind: 'prompt' | 'series' = 'prompt', sceneCount?: number, onResult?: (result: TextResult) => Promise<void>) {
  const creditQuote = getCreditQuote();
  const key = `text-request-${kind}-${creditQuote.userId}`;
  const signature = JSON.stringify({ content });
  const previous = await readWorkspaceDraft<PendingText>(key);
  let pending: PendingText | undefined;
  if (previous) {
    try {
      // Older pages also stored their instructions in the signature; those requests are still the same intent.
      const original = JSON.parse(previous.signature) as { system?: unknown; content?: unknown };
      const previousCount = previous.sceneCount ?? (typeof original.system === 'string' ? Number(original.system.match(/恰好 (\d+) 项/)?.[1]) : undefined);
      if (original.content === content && (kind === 'prompt' || previousCount === sceneCount)) pending = previous;
    } catch { /* A malformed local entry cannot describe a recoverable request. */ }
  }
  const clearPending = async (requestId: string) => {
    if ((await readWorkspaceDraft<PendingText>(key))?.requestId === requestId) await writeWorkspaceDraft(key, undefined);
  };
  if (pending) {
    try {
      const result = await apiFetch<TextResult>(`/api/text/${pending.requestId}`);
      if (!result.text) throw new Error('文字任务仍在处理, 请稍后再次查看');
      await onResult?.(result);
      await clearPending(pending.requestId);
      return result;
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 404)) {
        if (cause instanceof ApiError && SETTLED.includes(cause.code)) await clearPending(pending.requestId);
        throw cause;
      }
    }
  }
  const request = pending || { requestId: randomId(), signature, ...(kind === 'series' ? { sceneCount } : {}) };
  await writeWorkspaceDraft(key, request);
  try {
    const result = await apiFetch<TextResult>('/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: request.requestId, kind, creditQuote, content, ...(kind === 'series' ? { sceneCount } : {}) }),
    });
    if (!result.text) throw new Error('文字任务仍在处理, 请稍后再次查看');
    await onResult?.(result);
    await clearPending(request.requestId);
    return result;
  } catch (cause) {
    if (cause instanceof ApiError && SETTLED.includes(cause.code)) await clearPending(request.requestId);
    throw cause;
  }
}
