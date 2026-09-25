import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUnseenSightingsCount,
  resolveLastSeenBaseline,
  sortTrackedBillRows,
} from '../src/utils/trackedBillState.js';

test('tracked bill has no new sighting when count is unchanged', () => {
  assert.equal(getUnseenSightingsCount(4, 4), 0);
});

test('tracked bill reports one new sighting after a +1 increase', () => {
  assert.equal(getUnseenSightingsCount(5, 4), 1);
});

test('tracked bill reports the full +3 increase', () => {
  assert.equal(getUnseenSightingsCount(7, 4), 3);
});

test('missing legacy baseline is initialized quietly on first list load', () => {
  assert.deepEqual(resolveLastSeenBaseline(6, undefined), {
    lastSeenSightingsCount: 6,
    shouldPersistBaseline: true,
    unseenSightingsCount: 0,
  });
});

test('opening a list with a baseline does not acknowledge new sightings', () => {
  assert.deepEqual(resolveLastSeenBaseline(8, 5), {
    lastSeenSightingsCount: 5,
    shouldPersistBaseline: false,
    unseenSightingsCount: 3,
  });
});

test('newly discovered bills sort first, then by updatedAt', () => {
  const rows = [
    { id: 'old-new', bill: { updatedAt: '2025-01-01T00:00:00Z' }, unseenSightingsCount: 1 },
    { id: 'seen-recent', bill: { updatedAt: '2026-01-01T00:00:00Z' }, unseenSightingsCount: 0 },
    { id: 'new-recent', bill: { updatedAt: '2026-02-01T00:00:00Z' }, unseenSightingsCount: 3 },
  ];
  assert.deepEqual(sortTrackedBillRows(rows).map((row) => row.id), ['new-recent', 'old-new', 'seen-recent']);
});
