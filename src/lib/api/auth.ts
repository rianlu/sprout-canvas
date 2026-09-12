import { apiFetch } from './client';
import type { CreditSession } from '../credits';

export interface AuthStatus extends CreditSession {
  required: boolean;
  authenticated: boolean;
  userId: string;
}

export function authStatus() {
  return apiFetch<AuthStatus>('/api/auth/status');
}

export function login(code: string) {
  return apiFetch<AuthStatus>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export function logout() { return apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }); }
