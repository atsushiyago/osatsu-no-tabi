export function getUnseenSightingsCount(currentSightingsCount: number, lastSeenSightingsCount: number): number;
export function resolveLastSeenBaseline(currentSightingsCount: number, storedSightingsCount?: number): {
  lastSeenSightingsCount: number;
  shouldPersistBaseline: boolean;
  unseenSightingsCount: number;
};
export function sortTrackedBillRows<T extends { bill: { updatedAt: string }; unseenSightingsCount: number }>(rows: T[]): T[];
