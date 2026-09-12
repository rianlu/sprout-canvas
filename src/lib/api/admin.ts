import { apiFetch } from './client';
import type { CreditPrices } from '../../../shared/credits-contract.mjs';

export interface AdminUsage { images: number; texts: number; imagePoints: number; textPoints: number; points: number; deducted: number }
export interface AdminActivityDay { date: string; images: number; texts: number; points: number }

export interface AdminOverview {
  updatedAt: number;
  styles: { total: number; published: number; hidden: number; recent: { id: string; name: string; author: string; image: string; published: boolean; updatedAt: number }[] };
  accessCodes: { total: number; enabled: number; disabled: number; unlimited: number };
  usage: AdminUsage;
  usagePeriods: { today: AdminUsage; month: AdminUsage };
  activity: { timeZone: string; startDate: string; endDate: string; days: AdminActivityDay[] };
  pendingReview: { total: number; codeCount: number; reserved: number; codes: { id: string; note: string; tail: string; count: number; reserved: number; oldestAt: number }[] };
  prices: CreditPrices;
}

export function getAdminOverview() { return apiFetch<AdminOverview>('/api/admin/overview'); }
