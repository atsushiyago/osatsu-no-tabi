/** @param {number} currentSightingsCount @param {number} lastSeenSightingsCount */
export function getUnseenSightingsCount(currentSightingsCount, lastSeenSightingsCount) {
  if (!Number.isInteger(lastSeenSightingsCount)) return 0;
  return Math.max(0, currentSightingsCount - lastSeenSightingsCount);
}

/** @param {number} currentSightingsCount @param {number | undefined} storedSightingsCount */
export function resolveLastSeenBaseline(currentSightingsCount, storedSightingsCount) {
  if (!Number.isInteger(storedSightingsCount)) {
    return { lastSeenSightingsCount: currentSightingsCount, shouldPersistBaseline: true, unseenSightingsCount: 0 };
  }
  return {
    lastSeenSightingsCount: storedSightingsCount,
    shouldPersistBaseline: false,
    unseenSightingsCount: getUnseenSightingsCount(currentSightingsCount, storedSightingsCount),
  };
}

/** @template {{ unseenSightingsCount: number }} T @param {T[]} rows @returns {T[]} */
export function getUnseenTrackedBills(rows) {
  return rows.filter((row) => row.unseenSightingsCount > 0);
}

/** @param {Array<{ bill: { updatedAt: string }, unseenSightingsCount: number }>} rows */
export function sortTrackedBillRows(rows) {
  return [...rows].sort((a, b) => {
    const newFirst = Number(b.unseenSightingsCount > 0) - Number(a.unseenSightingsCount > 0);
    if (newFirst !== 0) return newFirst;
    return Date.parse(b.bill.updatedAt) - Date.parse(a.bill.updatedAt);
  });
}
