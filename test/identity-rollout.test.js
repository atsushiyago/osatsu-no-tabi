import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { doc, getDoc, getDocs, query, where, collection, writeBatch, serverTimestamp, updateDoc, getAggregateFromServer, count, sum } from 'firebase/firestore';
import { GoogleAuthProvider, linkWithCredential, signInWithCredential } from 'firebase/auth';
import { registerBillIdentityV2, registerBillIdentityV2InEmulator } from '../src/services/billIdentityRegistry.ts';
import { pausedIdentityRules } from '../scripts/identity-paused-rules.mjs';
import { client, adminSet, adminGet, opaque, plan, commit, ageBill, loadRules, clearDemoProject, closeClients, rawKey } from './helpers/identity-emulator.js';
const project = 'demo-osatsu-identity-rollout';
const candidate = await readFile(new URL('../firestore.strict.rules', import.meta.url), 'utf8');
const frozen = pausedIdentityRules(candidate);
assert.equal(await readFile(new URL('../firestore.identity-paused.rules', import.meta.url), 'utf8'), frozen, 'pause artifact must match the tested generator');
const v1Rules = execFileSync('git', ['show', 'f2e5f26:firestore.strict.rules'], { encoding: 'utf8' });
const denied = (promise) => assert.rejects(promise, (error) => error.code === 'permission-denied');
const data = (overrides = {}) => ({ denomination: 1000, series: 'E', serialColor: 'black', serialNumber: 'RB234567B', prefecture: '東京都', municipality: '千代田区', ...overrides });

async function oldRegistration(c, publicId = opaque(), serial = 'RB234568B', prior = null) {
  const batch = writeBatch(c.db);
  const id = opaque(); const now = new Date().toISOString();
  const priorRate = (await getDoc(doc(c.db, 'rateLimits', c.uid))).data();
  const shortActive = priorRate && Date.now() - priorRate.shortWindowStartedAt.toMillis() < 600000;
  const dailyActive = priorRate && Date.now() - priorRate.dailyWindowStartedAt.toMillis() < 86400000;
  const rate = { shortWindowStartedAt: shortActive ? priorRate.shortWindowStartedAt : serverTimestamp(), dailyWindowStartedAt: dailyActive ? priorRate.dailyWindowStartedAt : serverTimestamp(), shortCount: shortActive ? priorRate.shortCount + 1 : 1, dailyCount: dailyActive ? priorRate.dailyCount + 1 : 1,
    updatedAt: serverTimestamp(), lastOperationPublicBillId: publicId, lastOperationSightingId: id };
  if (!prior) batch.set(doc(c.db, 'serialIndex', serial), { publicBillId: publicId, createdAt: serverTimestamp() });
  const bill = { id: publicId, denomination: 1000, createdAt: now, updatedAt: now, firstSightedAt: now, lastSightedAt: now,
    lastSightedAtServer: serverTimestamp(), sightingsCount: prior ? prior.sightingsCount + 1 : 1, totalDistanceKm: 0,
    lastSightingId: id, lastMunicipality: '千代田区' };
  if (prior) batch.update(doc(c.db, 'publicBills', publicId), {
    updatedAt: now, lastSightedAt: now, lastSightedAtServer: serverTimestamp(), sightingsCount: bill.sightingsCount,
    totalDistanceKm: 0, lastSightingId: id, lastMunicipality: '千代田区',
  });
  else batch.set(doc(c.db, 'publicBills', publicId), bill);
  batch.set(doc(c.db, 'sightings', id), { id, publicBillId: publicId, step: bill.sightingsCount, createdAt: now,
    prefecture: '東京都', municipality: '千代田区', distanceFromPrevKm: 0, daysFromPrev: 0 });
  if (prior) batch.update(doc(c.db, 'users', c.uid, 'trackedBills', publicId), { lastSeenSightingsCount: bill.sightingsCount, lastSeenAt: serverTimestamp(), lastSeenMunicipality: '千代田区' });
  else batch.set(doc(c.db, 'users', c.uid, 'trackedBills', publicId), { publicBillId: publicId, serialNumber: serial, denomination: 1000,
    firstRegisteredByMe: !prior, createdAt: serverTimestamp(), notifyOnRediscovery: false, lastSeenSightingsCount: bill.sightingsCount,
    lastSeenAt: serverTimestamp(), lastSeenMunicipality: '千代田区' }, { merge: Boolean(prior) });
  batch.set(doc(c.db, 'rateLimits', c.uid), rate);
  return batch.commit();
}

test('staged migration, cached-client blocking, preservation and frozen rollback', async (t) => {
  t.after(closeClients);
  t.after(() => loadRules(candidate, project));
  await clearDemoProject(project); await loadRules(v1Rules, project);
  const owner = await client('rollout-owner', true, project);
  const legacyId = opaque();
  await t.test('v1 client creates a real five-document legacy graph before the stop barrier', async () => {
    await oldRegistration(owner, legacyId, data().serialNumber);
    assert.equal((await adminGet(`publicBills/${legacyId}`, project)).sightingsCount, 1);
  });
  const legacyTrackedPath = `users/${owner.uid}/trackedBills/${legacyId}`;
  const legacyBill = await adminGet(`publicBills/${legacyId}`, project);
  const snapshotPaths = [`publicBills/${legacyId}`, `sightings/${legacyBill.lastSightingId}`, legacyTrackedPath, `serialIndex/${data().serialNumber}`];
  const before = await Promise.all(snapshotPaths.map((path) => adminGet(path, project)));
  const base64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${base64({ alg: 'none', typ: 'JWT' })}.${base64({ iss: 'https://accounts.google.com', aud: project, sub: `rollout-${owner.uid}`,
    email: `${owner.uid}@example.invalid`, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
  const credential = GoogleAuthProvider.credential(token);
  await linkWithCredential(owner.auth.currentUser, credential);
  const second = await client('rollout-google-other-browser', true, project);
  await signInWithCredential(second.auth, credential);
  second.uid = second.auth.currentUser.uid;
  assert.equal(second.uid, owner.uid);

  await t.test('hard pause prevents v1 and v2 registration regardless of gate setting', async () => {
    await loadRules(frozen, project);
    for (const mode of ['v2', 'paused']) {
      await adminSet('appConfig/billRegistration', { mode, identityVersion: 2 }, project);
      await denied(oldRegistration(owner));
      await denied(oldRegistration(owner, legacyId, data().serialNumber, legacyBill));
      const operation = await plan(owner, data({ serialNumber: 'RB234569B' }));
      await denied(commit(owner, operation));
    }
    assert.deepEqual(await Promise.all(snapshotPaths.map((path) => adminGet(path, project))), before);
  });
  await t.test('invalid Rules update leaves the verified frozen Rules active', async () => {
    await assert.rejects(loadRules('invalid rules syntax', project));
    await denied(oldRegistration(owner));
    await denied(commit(owner, await plan(owner, data({ serialNumber: 'RB234570B' }))));
  });
  await t.test('v2 Rules with paused gate support legacy reads and synced private reads', async () => {
    await adminSet('appConfig/billRegistration', { mode: 'paused', identityVersion: 2 }, project);
    await loadRules(candidate, project);
    assert.equal((await getDoc(doc(second.db, legacyTrackedPath))).data().serialNumber, data().serialNumber);
    assert.equal((await getDoc(doc(owner.db, 'serialIndex', data().serialNumber))).data().publicBillId, legacyId);
    const history = await getDocs(query(collection(owner.db, 'sightings'), where('publicBillId', '==', legacyId)));
    assert.equal(history.size, 1); assert.equal(history.docs[0].data().municipality, '千代田区');
    const stats = await getAggregateFromServer(collection(owner.db, 'publicBills'), { count: count(), sightings: sum('sightingsCount') });
    assert.deepEqual(stats.data(), { count: 1, sightings: 1 });
    await assert.rejects(registerBillIdentityV2(owner.db, owner.auth, data()), { code: 'registration-paused' });
    await denied(oldRegistration(owner));
  });
  let registered;
  await t.test('enabling v2 does not infer legacy metadata; ambiguous match requires separate UUID', async () => {
    await adminSet('appConfig/billRegistration', { mode: 'v2', identityVersion: 2 }, project);
    const ambiguous = await registerBillIdentityV2(owner.db, owner.auth, data());
    assert.deepEqual(ambiguous, { status: 'legacy-ambiguous', legacyPublicBillId: legacyId });
    registered = await registerBillIdentityV2(owner.db, owner.auth, data({ legacyAcknowledgedBillId: legacyId }));
    assert.notEqual(registered.publicBillId, legacyId);
    assert.deepEqual(await Promise.all(snapshotPaths.map((path) => adminGet(path, project))), before);
    for (const record of before) assert.equal('series' in record || 'serialColor' in record || 'identityVersion' in record, false);
  });
  await t.test('rediscovery preserves v2 UUID and cached v1 rediscovery remains denied', async () => {
    await ageBill(registered.publicBillId, project);
    const next = await registerBillIdentityV2(second.db, second.auth, data());
    assert.equal(next.status, 'rediscovered'); assert.equal(next.publicBillId, registered.publicBillId);
    await denied(oldRegistration(owner, legacyId, data().serialNumber, legacyBill));
    await denied(oldRegistration(owner, registered.publicBillId, data().serialNumber, await adminGet(`publicBills/${registered.publicBillId}`, project)));
  });
  await t.test('different amounts, designs and colors with the same serial register concurrently without merging', async () => {
    const users = await Promise.all([0, 1, 2].map((i) => client(`rollout-racer-${i}`, true, project)));
    const variants = [data({ serialNumber: 'RB234571B', denomination: 5000 }), data({ serialNumber: 'RB234571B', series: 'D' }), data({ serialNumber: 'RB234571B', serialColor: 'brown' })];
    const results = await Promise.all(users.map((user, i) => registerBillIdentityV2(user.db, user.auth, variants[i])));
    assert.equal(new Set(results.map((result) => result.publicBillId)).size, 3);
    for (let i = 0; i < 3; i++) assert.equal((await adminGet(`billIdentityIndex/${rawKey(variants[i])}`, project)).publicBillId, results[i].publicBillId);
  });
  await t.test('serials in lowercase, full-width and spaced notes are rejected by service and raw Rules', async () => {
    for (const userNote of ['rb234567b', 'ＲＢ２３４５６７Ｂ', 'R B 2 3 4 5 6 7 B', 'memo\nrb234567b']) {
      await assert.rejects(registerBillIdentityV2(owner.db, owner.auth, data({ serialNumber: 'RB234572B', userNote })), { code: 'private-serial-note' });
      const operation = await plan(owner, data({ serialNumber: 'RB234572B' }));
      const entries = operation.entries.map((entry) => entry.role === 'sighting' ? { ...entry, data: { ...entry.data, userNote } } : entry);
      await denied(commit(owner, operation, entries));
    }
  });
  await t.test('re-pause rejects all nonempty registration subsets and permits only personal metadata', async () => {
    await adminSet('appConfig/billRegistration', { mode: 'paused', identityVersion: 2 }, project);
    const operation = await plan(owner, data({ serialNumber: 'RB234573B' }));
    for (let mask = 1; mask < 64; mask++) await denied(commit(owner, operation, operation.entries.filter((_, i) => mask & (1 << i))));
    await updateDoc(doc(second.db, legacyTrackedPath), { notifyOnRediscovery: true, lastSeenAt: serverTimestamp(), lastSeenSightingsCount: 1, lastSeenMunicipality: '千代田区' });
    const changed = await adminGet(legacyTrackedPath, project);
    assert.equal(changed.notifyOnRediscovery, true);
    for (const field of ['publicBillId', 'serialNumber', 'denomination', 'createdAt', 'firstRegisteredByMe']) assert.deepEqual(changed[field], before[2][field]);
    assert.deepEqual(await adminGet(snapshotPaths[0], project), before[0]); assert.deepEqual(await adminGet(snapshotPaths[1], project), before[1]);
  });
  await t.test('frozen rollback preserves public stats, histories, UUIDs and synced settings', async () => {
    const statsBefore = (await getAggregateFromServer(collection(owner.db, 'publicBills'), { count: count(), sightings: sum('sightingsCount') })).data();
    await loadRules(frozen, project);
    const statsAfter = (await getAggregateFromServer(collection(owner.db, 'publicBills'), { count: count(), sightings: sum('sightingsCount') })).data();
    assert.deepEqual(statsAfter, statsBefore);
    assert.equal((await getDoc(doc(second.db, legacyTrackedPath))).data().notifyOnRediscovery, true);
    const history = await getDocs(query(collection(owner.db, 'sightings'), where('publicBillId', '==', registered.publicBillId)));
    assert.equal(history.size, 2);
    await denied(oldRegistration(owner));
    await denied(commit(owner, await plan(owner, data({ serialNumber: 'RB234574B' }))));
    await updateDoc(doc(second.db, legacyTrackedPath), { notifyOnRediscovery: false });
    assert.equal((await adminGet(legacyTrackedPath, project)).notifyOnRediscovery, false);
    await assert.rejects(registerBillIdentityV2InEmulator({ app: { options: { projectId: 'production-project' } } }, owner.auth, data()), { code: 'emulator-only' });
  });
});
