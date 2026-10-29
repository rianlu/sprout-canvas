import { syncCreditResponse } from '../credits';
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code = '') { super(message); this.name = 'ApiError'; }
}

/** Shown when the server is unreachable or a gateway answers in its place, e.g. while the service restarts. */
export const CONNECTION_MESSAGE = '暂时连接不上工作台, 请稍后重试';

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  // A network failure stays a TypeError, so callers still tell "never answered" from a server rejection; only the browser's English text is replaced.
  try { response = await fetch(path, { credentials: 'include', ...init }); }
  catch (cause) { throw cause instanceof TypeError ? new TypeError(CONNECTION_MESSAGE) : cause; }
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text();
  syncCreditResponse(data);
  if (init.method && init.method !== 'GET' && !path.startsWith('/api/auth/') && !path.startsWith('/api/admin/')) window.dispatchEvent(new Event('sprout:credits-refresh'));
  if (!response.ok) {
    // Without our JSON body the answer came from a proxy or gateway page, so name the condition instead of a bare status code.
    const message = typeof data === 'object' && data && 'error' in data ? String((data as { error: unknown }).error) : response.status >= 500 ? CONNECTION_MESSAGE : `请求未完成 (HTTP ${response.status})`;
    if (response.status === 401 && path.startsWith('/api/admin/') && !path.startsWith('/api/admin/auth/')) window.dispatchEvent(new Event('sprout:admin-expired'));
    else if (response.status === 401 && !path.startsWith('/api/auth/') && !path.startsWith('/api/admin/')) window.dispatchEvent(new Event('sprout:auth-expired'));
    throw new ApiError(message, response.status, data?.code || '');
  }
  return data as T;
}
