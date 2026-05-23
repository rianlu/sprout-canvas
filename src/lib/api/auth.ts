import { apiFetch } from './client';

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
  userId: string;
}

export function authStatus() {
  return apiFetch<AuthStatus>('/api/auth/status');
}

export function login(password: string, userId: string) {
  return apiFetch<{ ok: boolean; required: boolean; userId: string }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, userId }),
  });
}
