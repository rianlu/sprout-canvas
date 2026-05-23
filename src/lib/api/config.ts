import type { ServerConfig } from '../../types/provider';
import { apiFetch } from './client';

export function getServerConfig() {
  return apiFetch<ServerConfig>('/api/config');
}
