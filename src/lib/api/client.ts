import { syncCreditResponse } from '../credits';
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code = '') { super(message); this.name = 'ApiError'; }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text();
  syncCreditResponse(data);
  if (init.method && init.method !== 'GET' && !path.startsWith('/api/auth/') && !path.startsWith('/api/admin/')) window.dispatchEvent(new Event('sprout:credits-refresh'));
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data ? String((data as { error: unknown }).error) : `HTTP ${response.status}`;
    if (response.status === 401 && path.startsWith('/api/admin/') && !path.startsWith('/api/admin/auth/')) window.dispatchEvent(new Event('sprout:admin-expired'));
    else if (response.status === 401 && !path.startsWith('/api/auth/') && !path.startsWith('/api/admin/')) window.dispatchEvent(new Event('sprout:auth-expired'));
    throw new ApiError(message, response.status, data?.code || '');
  }
  return data as T;
}
