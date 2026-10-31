import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GoogleAuthProvider, linkWithCredential, signInWithCredential } from 'firebase/auth';
import { collection, doc, getCountFromServer, getDocFromServer, limit, query, updateDoc, serverTimestamp, where } from 'firebase/firestore';
import { loadHomeTrackedBills } from '../src/services/homeTrackedBills.ts';
import { ensureOwnedNotificationBaseline, markTrackedBillSeenInFirestore } from '../src/services/trackedBillBaseline.ts';
import { createShortReadCache } from '../src/utils/shortReadCache.ts';
import { adminSet, adminGet, client, closeClients, clearDemoProject, loadRules, opaque } from './helpers/identity-emulator.js';

const project = 'demo-osatsu-home-notifications';
test('optimized Home checks every owned bill under unchanged production Rules', async (t) => {
  t.after(closeClients);
  await clearDemoProject(project);
  await loadRules(await readFile(new URL('../firestore.strict.rules', import.meta.url), 'utf8'), project);
  const owner = await client('home-owner', true, project);
  const other = await client('home-other', true, project);
  const uid = owner.uid;
  const ids = Array.from({ length: 350 }, opaque);
  const trackedPath = (id) => `users/${uid}/trackedBills/${id}`;

  await t.test('empty anonymous account returns no notices', async () => {
    assert.deepEqual(await loadHomeTrackedBills(owner.db, uid), []);
  });
  await t.test('350 records across all batches include a late +3 rediscovery without acknowledging it', async () => {
    for (let offset = 0; offset < ids.length; offset += 25) {
      await Promise.all(ids.slice(offset, offset + 25).map(async (id, position) => {
        const index = offset + position;
        await adminSet(`publicBills/${id}`, {
          id, denomination: 1000, updatedAt: index === 349 ? '2026-10-31T12:00:00Z' : '2026-10-01T00:00:00Z',
          sightingsCount: index === 349 ? 4 : 1, lastMunicipality: '藤沢市',
        }, project);
        await adminSet(trackedPath(id), {
          publicBillId: id, serialNumber: 'AA123456BB', firstRegisteredByMe: true,
          lastSeenSightingsCount: 1, notifyOnRediscovery: false,
        }, project);
      }));
    }
    await adminSet('sightings/home-step-3', { publicBillId: ids[349], step: 3, municipality: '横浜市' }, project);
    await adminSet('sightings/home-step-4', { publicBillId: ids[349], step: 4, municipality: '藤沢市' }, project);
    const rows = await loadHomeTrackedBills(owner.db, uid);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].bill.id, ids[349]);
    assert.equal(rows[0].unseenSightingsCount, 3);
    assert.deepEqual(rows[0].routeSightings.map((s) => s.municipality), ['横浜市', '藤沢市']);
    assert.equal((await adminGet(trackedPath(ids[349]), project)).lastSeenSightingsCount, 1);
  });
  await t.test('every unseen bill counts, but only the leading bill loads its history', async () => {
    await adminSet(`publicBills/${ids[0]}`, { sightingsCount: 2 }, project, true);
    // No history for this non-leading fixture: it must not be fetched/needed to count it.
    const rows = await loadHomeTrackedBills(owner.db, uid);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.bill.id === ids[0]).unseenSightingsCount, 1);
    assert.deepEqual(rows.find((row) => row.bill.id === ids[0]).routeSightings, []);
  });
  await t.test('seen metadata update removes the notice while preserving notification preferences', async () => {
    await updateDoc(doc(owner.db, trackedPath(ids[349])), {
      lastSeenSightingsCount: 4, lastSeenAt: serverTimestamp(), lastSeenMunicipality: '藤沢市',
    });
    const rows = await loadHomeTrackedBills(owner.db, uid);
    assert.equal(rows.some((row) => row.bill.id === ids[349]), false);
    assert.equal((await adminGet(trackedPath(ids[349]), project)).notifyOnRediscovery, false);
  });
  await t.test('legacy baseline preserves all rediscoveries, followed records stay excluded', async () => {
    const legacy = opaque();
    await adminSet(`publicBills/${legacy}`, { id: legacy, sightingsCount: 6, updatedAt: '2026-10-31T13:00:00Z' }, project);
    await adminSet(trackedPath(legacy), { publicBillId: legacy, serialNumber: 'AA123456BB', firstRegisteredByMe: true }, project);
    await adminSet(trackedPath(ids[1]), { firstRegisteredByMe: false }, project, true);
    await adminSet(`publicBills/${ids[1]}`, { sightingsCount: 10 }, project, true);
    let rows = await loadHomeTrackedBills(owner.db, uid);
    assert.equal(rows.some((row) => row.bill.id === ids[1]), false);
    assert.equal(rows.find((row) => row.bill.id === legacy).unseenSightingsCount, 5);
    assert.equal((await adminGet(trackedPath(legacy), project)).lastSeenSightingsCount, 1);
    await adminSet(`publicBills/${legacy}`, { sightingsCount: 7 }, project, true);
    rows = await loadHomeTrackedBills(owner.db, uid);
    assert.equal(rows.find((row) => row.bill.id === legacy).unseenSightingsCount, 6);
    await markTrackedBillSeenInFirestore(owner.db, doc(owner.db, trackedPath(legacy)), 7, '藤沢市');
  });
  await t.test('a legacy bill omitted at count 1 still notifies its first rediscovery later', async () => {
    const id = opaque();
    await adminSet(`publicBills/${id}`, { id, sightingsCount: 1, updatedAt: '2026-10-31T13:00:00Z' }, project);
    await adminSet(trackedPath(id), { publicBillId: id, serialNumber: 'AA123456BB', firstRegisteredByMe: true }, project);
    assert.equal((await loadHomeTrackedBills(owner.db, uid)).some((row) => row.bill.id === id), false);
    assert.equal((await adminGet(trackedPath(id), project)).lastSeenSightingsCount, undefined);
    await adminSet(`publicBills/${id}`, { sightingsCount: 2 }, project, true);
    assert.equal((await loadHomeTrackedBills(owner.db, uid)).find((row) => row.bill.id === id).unseenSightingsCount, 1);
    assert.equal((await adminGet(trackedPath(id), project)).lastSeenSightingsCount, 1);
    await markTrackedBillSeenInFirestore(owner.db, doc(owner.db, trackedPath(id)), 2, '藤沢市');
  });
  await t.test('another device acknowledgement is never overwritten by a stale migration or detail', async () => {
    const id = opaque();
    await adminSet(`publicBills/${id}`, { id, sightingsCount: 4, updatedAt: '2026-10-31T13:00:00Z' }, project);
    await adminSet(trackedPath(id), { publicBillId: id, serialNumber: 'AA123456BB', firstRegisteredByMe: true, lastSeenSightingsCount: 4 }, project);
    const baseline = await ensureOwnedNotificationBaseline(owner.db, doc(owner.db, trackedPath(id)), id, 3, undefined);
    assert.equal(baseline.lastSeenSightingsCount, 4);
    assert.equal(baseline.unseenSightingsCount, 0);
    await markTrackedBillSeenInFirestore(owner.db, doc(owner.db, trackedPath(id)), 2, '古い表示');
    assert.equal((await adminGet(trackedPath(id), project)).lastSeenSightingsCount, 4);
    await adminSet(`publicBills/${id}`, { sightingsCount: 5 }, project, true);
    assert.equal((await loadHomeTrackedBills(owner.db, uid)).find((row) => row.bill.id === id).unseenSightingsCount, 1);
    await markTrackedBillSeenInFirestore(owner.db, doc(owner.db, trackedPath(id)), 5, '藤沢市');
  });
  await t.test('simultaneous baseline migration and acknowledgement preserve the newer seen position', async () => {
    const id = opaque();
    await adminSet(`publicBills/${id}`, { id, sightingsCount: 5, updatedAt: '2026-10-31T13:00:00Z' }, project);
    await adminSet(trackedPath(id), { publicBillId: id, serialNumber: 'AA123456BB', firstRegisteredByMe: true }, project);
    await Promise.all([
      ensureOwnedNotificationBaseline(owner.db, doc(owner.db, trackedPath(id)), id, 5, undefined),
      markTrackedBillSeenInFirestore(owner.db, doc(owner.db, trackedPath(id)), 4, '藤沢市'),
    ]);
    assert.equal((await adminGet(trackedPath(id), project)).lastSeenSightingsCount, 4);
    assert.equal((await loadHomeTrackedBills(owner.db, uid)).find((row) => row.bill.id === id).unseenSightingsCount, 1);
    await markTrackedBillSeenInFirestore(owner.db, doc(owner.db, trackedPath(id)), 5, '藤沢市');
  });
  await t.test('manual owned fallback and automatic global plan return identical notices', async () => {
    assert.deepEqual(await loadHomeTrackedBills(owner.db, uid), await loadHomeTrackedBills(owner.db, uid, { strategy: 'owned' }));
    const small = await client('home-small', true, project);
    await adminSet(`users/${small.uid}/trackedBills/${ids[0]}`, {
      publicBillId: ids[0], serialNumber: 'AA123456BB', firstRegisteredByMe: true, lastSeenSightingsCount: 1,
    }, project);
    assert.deepEqual(await loadHomeTrackedBills(small.db, small.uid), await loadHomeTrackedBills(small.db, small.uid, { strategy: 'owned' }));
    assert.equal((await loadHomeTrackedBills(small.db, small.uid)).length, 1);
    const global = query(collection(owner.db, 'publicBills'), where('sightingsCount', '>', 1));
    assert.ok((await getCountFromServer(global)).data().count > 2);
    assert.equal((await getCountFromServer(query(global, limit(2)))).data().count, 2);
  });
  await t.test('30-second cache is UID-scoped; other-device changes appear after expiry or invalidation', async () => {
    let now = 0;
    const cache = createShortReadCache(30_000, () => now);
    const read = () => loadHomeTrackedBills(owner.db, uid);
    const before = await cache.get(uid, read);
    await adminSet(`publicBills/${ids[2]}`, { sightingsCount: 4 }, project, true);
    assert.deepEqual(await cache.get(uid, read), before);
    now = 30_000;
    assert.equal((await cache.get(uid, read)).find((row) => row.bill.id === ids[2]).unseenSightingsCount, 3);
    await markTrackedBillSeenInFirestore(owner.db, doc(owner.db, trackedPath(ids[2])), 4, '藤沢市');
    cache.clear();
    assert.equal((await cache.get(uid, read)).some((row) => row.bill.id === ids[2]), false);
    assert.deepEqual(await cache.get(other.uid, () => loadHomeTrackedBills(other.db, other.uid)), []);
  });
  await t.test('unrelated rediscoveries do not expose or modify another user tracking data', async () => {
    const id = opaque();
    await adminSet(`publicBills/${id}`, { id, sightingsCount: 3, updatedAt: '2026-10-31T13:00:00Z' }, project);
    await adminSet(`users/${other.uid}/trackedBills/${id}`, { publicBillId: id, serialNumber: 'AA123456BB', firstRegisteredByMe: true, lastSeenSightingsCount: 1 }, project);
    assert.equal((await loadHomeTrackedBills(owner.db, uid)).some((row) => row.bill.id === id), false);
    await assert.rejects(getDocFromServer(doc(owner.db, 'users', other.uid, 'trackedBills', id)), { code: 'permission-denied' });
  });
  await t.test('Google linking retains UID and notices; another anonymous UID cannot read the owner', async () => {
    const beforeLink = await loadHomeTrackedBills(owner.db, uid);
    const b64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: `home-${uid}`, email: `${uid}@example.invalid`, email_verified: true, aud: project, iss: 'https://accounts.google.com' })}.`;
    await linkWithCredential(owner.auth.currentUser, GoogleAuthProvider.credential(token));
    assert.equal(owner.auth.currentUser.uid, uid);
    assert.deepEqual(await loadHomeTrackedBills(owner.db, uid), beforeLink);
    const secondDevice = await client('home-second-google-device', false, project);
    await signInWithCredential(secondDevice.auth, GoogleAuthProvider.credential(token));
    assert.equal(secondDevice.auth.currentUser.uid, uid);
    assert.deepEqual(await loadHomeTrackedBills(secondDevice.db, uid), beforeLink);
    await markTrackedBillSeenInFirestore(secondDevice.db, doc(secondDevice.db, trackedPath(ids[0])), 2, '藤沢市');
    assert.equal((await loadHomeTrackedBills(owner.db, uid)).some((row) => row.bill.id === ids[0]), false);
    await assert.rejects(loadHomeTrackedBills(other.db, uid), (error) => error.code === 'permission-denied');
  });
});
