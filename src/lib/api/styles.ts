import { apiFetch } from './client';
import { saveFile } from '../download';
import type { StyleCatalog, StyleImportPreview, StyleInput, StyleRecord } from '../../../shared/style-contract.mjs';

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const getStyles = (admin = false) => apiFetch<StyleCatalog>(`/api/${admin ? 'admin/' : ''}styles`);
export const adminStatus = () => apiFetch<{ configured: boolean; authenticated: boolean }>('/api/admin/auth/status');
export const adminLogin = (password: string) => apiFetch('/api/admin/auth/login', json('POST', { password }));
export const adminLogout = () => apiFetch('/api/admin/auth/logout', { method: 'POST' });
export const saveStyle = (input: StyleInput, id?: string) => apiFetch<{ style: StyleRecord }>(`/api/admin/styles${id ? `/${id}` : ''}`, json(id ? 'PUT' : 'POST', input));
export const deleteStyle = (style: StyleRecord) => apiFetch(`/api/admin/styles/${style.id}`, json('DELETE', { version: style.version }));
export const previewStylesImport = (archive: unknown) => apiFetch<StyleImportPreview>('/api/admin/styles/import?preview=1', json('POST', { archive }));
export const importStyles = (archive: unknown, revision: number) => apiFetch<StyleImportPreview>('/api/admin/styles/import', json('POST', { archive, revision }));
export async function exportStyles() {
  const archive = await apiFetch<unknown>('/api/admin/styles/export');
  saveFile(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }), `sprout-styles-${new Date().toISOString().slice(0, 10)}.json`);
}
