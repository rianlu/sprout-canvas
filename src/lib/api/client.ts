export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiError'; }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data ? String((data as { error: unknown }).error) : `HTTP ${response.status}`;
    if (response.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('sprout:auth-expired'));
    throw new ApiError(message, response.status);
  }
  return data as T;
}
