import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GoogleAuthProvider, linkWithCredential } from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { loadHomeTrackedBills } from '../src/services/homeTrackedBills.ts';
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
  await t.test('legacy baseline remains quiet, then a later increase is notified; followed records stay excluded', async () => {
    const legacy = opaque();
    await adminSet(`publicBills/${legacy}`, { id: legacy, sightingsCount: 6, updatedAt: '2026-10-31T13:00:00Z' }, project);
    await adminSet(trackedPath(legacy), { publicBillId: legacy, serialNumber: 'AA123456BB', firstRegisteredByMe: true }, project);
    await adminSet(trackedPath(ids[1]), { firstRegisteredByMe: false }, project, true);
    await adminSet(`publicBills/${ids[1]}`, { sightingsCount: 10 }, project, true);
    let rows = await loadHomeTrackedBills(owner.db, uid);
    assert.equal(rows.some((row) => row.bill.id === legacy || row.bill.id === ids[1]), false);
    assert.equal((await adminGet(trackedPath(legacy), project)).lastSeenSightingsCount, 6);
    await adminSet(`publicBills/${legacy}`, { sightingsCount: 7 }, project, true);
    rows = await loadHomeTrackedBills(owner.db, uid);
    assert.equal(rows.find((row) => row.bill.id === legacy).unseenSightingsCount, 1);
  });
  await t.test('Google linking retains UID and notices; another anonymous UID cannot read the owner', async () => {
    const b64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'home-google', email: 'home@example.invalid', email_verified: true, aud: project, iss: 'https://accounts.google.com' })}.`;
    await linkWithCredential(owner.auth.currentUser, GoogleAuthProvider.credential(token));
    assert.equal(owner.auth.currentUser.uid, uid);
    assert.equal((await loadHomeTrackedBills(owner.db, uid)).length, 2);
    assert.deepEqual(await loadHomeTrackedBills(other.db, other.uid), []);
    await assert.rejects(loadHomeTrackedBills(other.db, uid), (error) => error.code === 'permission-denied');
  });
});
