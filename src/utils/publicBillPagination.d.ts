import type { Bill } from '../types';

export function getPageWindow<T>(documents: readonly T[], pageSize: number): {
  items: T[];
  hasMore: boolean;
  cursor: T | null;
};

export function projectPublicBill(id: string, data: Record<string, unknown>): Bill;
