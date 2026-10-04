import test from 'node:test';
import assert from 'node:assert/strict';
import { getPageWindow, projectPublicBill } from '../src/utils/publicBillPagination.js';

test('public bill pagination keeps page size and returns the last visible cursor', () => {
  const documents = Array.from({ length: 21 }, (_, index) => ({ id: `bill-${index}` }));
  const page = getPageWindow(documents, 20);

  assert.equal(page.items.length, 20);
  assert.equal(page.items[0].id, 'bill-0');
  assert.equal(page.cursor.id, 'bill-19');
  assert.equal(page.hasMore, true);
});

test('public bill pagination marks the final page and handles an empty collection', () => {
  assert.deepEqual(getPageWindow([{ id: 'only' }], 20), {
    items: [{ id: 'only' }],
    hasMore: false,
    cursor: { id: 'only' },
  });
  assert.deepEqual(getPageWindow([], 20), { items: [], hasMore: false, cursor: null });
});

test('public bill projection never exposes a serial number or unknown fields', () => {
  const bill = projectPublicBill('opaque-id', {
    denomination: 1000,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    sightingsCount: 2,
    totalDistanceKm: 34,
    firstSightedAt: '2026-01-01T00:00:00.000Z',
    lastSightedAt: '2026-01-02T00:00:00.000Z',
    lastMunicipality: '千代田区',
    serialNumber: 'AB123456C',
    privateData: 'must not escape',
  });

  assert.equal(bill.id, 'opaque-id');
  assert.equal(bill.lastMunicipality, '千代田区');
  assert.equal('serialNumber' in bill, false);
  assert.equal('privateData' in bill, false);
});
