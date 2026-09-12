import { apiFetch } from './client';
import type { AccessCodeRecord, CreditLedgerEntry, CreditOperation, CreditPrices } from '../../../shared/credits-contract.mjs';

const body = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
export function listAccessCodes(search = '', status = 'all', cursor = 0) { return apiFetch<{ codes: AccessCodeRecord[]; total: number; nextCursor: number | null }>(`/api/admin/access-codes?${new URLSearchParams({ search, status, cursor: String(cursor) })}`); }
export function getAccessCode(id: string) { return apiFetch<{ accessCode: AccessCodeRecord }>(`/api/admin/access-codes/${id}`); }
export function createAccessCodes(input: { requestId: string; note: string; initialPoints: number; count: number; unlimited?: boolean }) { return apiFetch<{ codes: (AccessCodeRecord & { code?: string })[]; replayed?: boolean }>('/api/admin/access-codes', { method: 'POST', ...body(input) }); }
export function updateAccessCode(id: string, input: { requestId: string; version: number; note?: string; enabled?: boolean; unlimited?: boolean; delta?: number; reason?: string }) { return apiFetch<{ accessCode: AccessCodeRecord }>(`/api/admin/access-codes/${id}`, { method: 'PATCH', ...body(input) }); }
export function deleteAccessCode(id: string, input: { requestId: string; version: number; reason?: string }) { return apiFetch<{ id: string; deleted: boolean }>(`/api/admin/access-codes/${id}`, { method: 'DELETE', ...body(input) }); }
export function adjustAccessCode(id: string, input: { requestId: string; version: number; delta: number; reason: string }) { return apiFetch<{ accessCode: AccessCodeRecord }>(`/api/admin/access-codes/${id}/points`, { method: 'POST', ...body(input) }); }
export function resetAccessCode(id: string, input: { requestId: string; version: number; reason?: string }) { return apiFetch<{ accessCode: AccessCodeRecord; code?: string; replayed?: boolean }>(`/api/admin/access-codes/${id}/reset`, { method: 'POST', ...body(input) }); }
export function accessCodeLedger(id: string, cursor?: number) { return apiFetch<{ entries: CreditLedgerEntry[]; nextCursor: number | null }>(`/api/admin/access-codes/${id}/ledger${cursor ? `?cursor=${cursor}` : ''}`); }
export function unresolvedCredits(id: string, cursor?: number) { return apiFetch<{ operations: CreditOperation[]; nextCursor: number | null }>(`/api/admin/access-codes/${id}/unresolved${cursor ? `?cursor=${cursor}` : ''}`); }
export function resolveCredits(id: string, input: { requestId: string; decision: 'charge' | 'refund'; reason: string }) { return apiFetch(`/api/admin/credit-operations/${id}/resolve`, { method: 'POST', ...body(input) }); }
export function getCreditPrices() { return apiFetch<{ prices: CreditPrices }>('/api/admin/credit-prices'); }
export function saveCreditPrices(input: CreditPrices & { requestId: string }) { return apiFetch<{ prices: CreditPrices }>('/api/admin/credit-prices', { method: 'PUT', ...body(input) }); }
