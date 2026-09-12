export interface CreditPrices { image: number; text: number; version: number }
export interface CreditQuote { accessCodeId: string; userId: string; version: number; unlimited?: boolean }
export interface CreditBalance { accessCodeId: string; tail: string; available: number; reserved: number; spent: number; enabled: boolean; unlimited: boolean }
export type CreditState = 'reserved' | 'running' | 'charged' | 'refunded' | 'unknown';
export interface CreditCharge { id: string; points: number; state: CreditState; kind: 'image' | 'prompt' | 'series'; priceVersion: number; unlimited: boolean }
export interface AccessCodeRecord extends CreditBalance { id: string; note: string; version: number; createdAt: number; updatedAt: number; lastUsedAt: number }
export interface CreditLedgerEntry { id: number; operationId: string; operationPoints?: number; operationUnlimited?: boolean; kind: string; event: string; points: number; available: number; reserved: number; unlimited: boolean; reason: string; createdAt: number }
export interface CreditOperation extends CreditCharge { requestId: string; createdAt: number; updatedAt: number }
export const CREDIT_LIMITS: Readonly<{ points: number; price: number; batch: number; note: number; reason: number }>;
export const CREDIT_DEFAULTS: Readonly<{ image: number; text: number }>;
export const ACCESS_CODE_PATTERN: RegExp;
export function validateCreditQuote(value: unknown): CreditQuote;
export function creditError(message: string, code: string, statusCode?: number, details?: Record<string, unknown>): Error & { code: string; statusCode: number; details: Record<string, unknown> };
export function creditInteger(value: unknown, name: string, min?: number, max?: number): number;
export function creditRequestId(value: unknown): string;
export function creditText(value: unknown, name: string, max: number, required?: boolean): string;
