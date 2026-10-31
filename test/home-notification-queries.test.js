// Run with node --experimental-test-module-mocks --test. No Firebase network.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createShortReadCache } from '../src/utils/shortReadCache.ts';

const calls = [];
let counts, queryReplies, pointReplies;
const fakeDb = {};
const doc = (db, ...parts) => ({ firestore: db, path: parts.join('/') });
const snapshot = (path, data) => ({
  id: path.split('/').at(-1), ref: doc(fakeDb, path),
  data: () => data, exists: () => data !== undefined,
});
const reply = (rows) => ({ docs: rows.map(([path, data]) => snapshot(path, data)), size: rows.length });
const invoke = async (queue, request) => {
  calls.push(request);
  assert.ok(queue.length, `Unexpected ${request.kind}`);
  const value = queue.shift();
  if (value instanceof Error) throw value;
  return value;
};
mock.module('firebase/firestore', { exports: {
  collection: (db, ...parts) => ({ firestore: db, path: parts.join('/'), constraints: [] }),
  doc, documentId: () => '__name__',
  where: (field, operator, value) => ({ field, operator, value }),
  limit: (value) => ({ limit: value }),
  query: (source, ...constraints) => ({ ...source, constraints: [...source.constraints, ...constraints] }),
  getCountFromServer: async (request) => {
    const count = await invoke(counts, { kind: 'count', ...request });
    return { data: () => ({ count }) };
  },
  getDocsFromServer: (request) => invoke(queryReplies, { kind: 'query', ...request }),
  getDocFromServer: (request) => invoke(pointReplies, { kind: 'point', ...request }),
  runTransaction: () => { throw new Error('Unexpected migration in query fixture'); },
  serverTimestamp: () => 'test-server-timestamp',
} });
const { loadHomeTrackedBills } = await import('../src/services/homeTrackedBills.ts');
const bill = (id, count = 2) => [`publicBills/${id}`, { id, sightingsCount: count, updatedAt: '2026-10-31T00:00:00Z' }];
const track = (id, seen = 1) => [`users/owner/trackedBills/${id}`, { publicBillId: id, serialNumber: 'AA123456BB', firstRegisteredByMe: true, lastSeenSightingsCount: seen }];
function setup(c = [], q = [], p = []) { calls.length = 0; counts = [...c]; queryReplies = [...q]; pointReplies = [...p]; }

test('global plan reads candidates and only their private records, with bounded aggregation', async () => {
  setup([350, 2], [reply([bill('a'), bill('b', 3)]), reply([])], [snapshot(...track('a')), snapshot(...track('b'))]);
  const rows = await loadHomeTrackedBills(fakeDb, 'owner');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.bill.id === 'b').unseenSightingsCount, 2);
  assert.equal(calls.filter((call) => call.kind === 'point').length, 2);
  assert.equal(calls.some((call) => call.kind === 'query' && call.path.startsWith('users/')), false);
  assert.deepEqual(calls[1].constraints.at(-1), { limit: 351 });
});

test('zero owned records skips the public feed and zero rediscoveries still checks the feed', async () => {
  setup([0]);
  assert.deepEqual(await loadHomeTrackedBills(fakeDb, 'owner'), []);
  assert.equal(calls.length, 1);
  setup([350, 0], [reply([])]);
  assert.deepEqual(await loadHomeTrackedBills(fakeDb, 'owner'), []);
  assert.equal(calls.filter((call) => call.kind === 'query').length, 1);
});

test('a large global count automatically uses the complete owned scan', async () => {
  setup([2, 3], [reply([track('a'), track('b')]), reply([bill('a'), bill('b', 1)]), reply([])]);
  assert.equal((await loadHomeTrackedBills(fakeDb, 'owner')).length, 1);
  assert.equal(calls.filter((call) => call.kind === 'point').length, 0);
  assert.equal(calls.find((call) => call.kind === 'query').path, 'users/owner/trackedBills');
});

test('growth after aggregation fills the bound and triggers a full fallback, never a partial answer', async () => {
  setup([2, 1], [reply([bill('a'), bill('b'), bill('c')]), reply([track('c'), track('d')]), reply([bill('d', 1)]), reply([])]);
  const rows = await loadHomeTrackedBills(fakeDb, 'owner');
  assert.deepEqual(rows.map((row) => row.bill.id), ['c']);
  assert.equal(calls.filter((call) => call.kind === 'point').length, 0);
  assert.ok(calls.some((call) => call.path === 'users/owner/trackedBills'));
  assert.deepEqual(calls.filter((call) => call.kind === 'query' && call.path === 'publicBills').at(-1).constraints[0].value, ['d']);
});

test('explicit owned rollback skips both aggregation queries', async () => {
  setup([], [reply([track('a')]), reply([bill('a')]), reply([])]);
  assert.equal((await loadHomeTrackedBills(fakeDb, 'owner', { strategy: 'owned' })).length, 1);
  assert.equal(calls.some((call) => call.kind === 'count'), false);
});

test('a failure after an earlier private batch never returns or caches a partial result', async () => {
  const ids = Array.from({ length: 31 }, (_, index) => `bill-${index}`);
  const denied = Object.assign(new Error('denied fixture'), { code: 'permission-denied' });
  setup([350, 31], [reply(ids.map((id) => bill(id)))], [...ids.slice(0, 30).map((id) => snapshot(...track(id))), denied]);
  const cache = createShortReadCache(30_000);
  await assert.rejects(cache.get('owner', () => loadHomeTrackedBills(fakeDb, 'owner')), { code: 'permission-denied' });
  setup([350, 0], [reply([])]);
  assert.deepEqual(await cache.get('owner', () => loadHomeTrackedBills(fakeDb, 'owner')), []);
  assert.equal(calls.length, 3, 'the failed result was not cached');
});

test('public feed, aggregate, owned scan, and route failures all propagate', async () => {
  const denied = new Error('read failed');
  setup([denied]);
  await assert.rejects(loadHomeTrackedBills(fakeDb, 'owner'), /read failed/);
  setup([350, denied]);
  await assert.rejects(loadHomeTrackedBills(fakeDb, 'owner'), /read failed/);
  setup([350, 1], [denied]);
  await assert.rejects(loadHomeTrackedBills(fakeDb, 'owner'), /read failed/);
  setup([], [denied]);
  await assert.rejects(loadHomeTrackedBills(fakeDb, 'owner', { strategy: 'owned' }), /read failed/);
  setup([350, 1], [reply([bill('a')]), denied], [snapshot(...track('a'))]);
  await assert.rejects(loadHomeTrackedBills(fakeDb, 'owner'), /read failed/);
  // A malformed count cannot be treated as successful empty data either.
  setup([350, 1], [reply([bill('a', 'invalid')])]);
  await assert.rejects(loadHomeTrackedBills(fakeDb, 'owner'), /Invalid public sighting count/);
  const [path, legacy] = track('a');
  delete legacy.lastSeenSightingsCount;
  setup([350, 1], [reply([bill('a')])], [snapshot(path, legacy)]);
  await assert.rejects(loadHomeTrackedBills(fakeDb, 'owner'), /Unexpected migration/);
});
