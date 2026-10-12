import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection, createServer } from 'node:net';
import {
  collection, deleteDoc, doc, getAggregateFromServer,
  getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, sum, count, updateDoc, where,
} from 'firebase/firestore';
import { GoogleAuthProvider, linkWithCredential, signInWithCredential } from 'firebase/auth';
import { BANKNOTE_VARIANTS } from '../src/data/banknoteVariants.ts';
import { registerBillIdentityV2InEmulator } from '../src/services/billIdentityRegistry.ts';
import { projectPublicBill } from '../src/utils/publicBillPagination.js';
import {
  client, adminSet, adminGet, adminDelete, ageBill, resetRate, plan, commit, opaque,
  rawKey, serial, projectId, closeClients, firestoreHost, clearDemoProject,
} from './helpers/identity-emulator.js';

const denied = (promise) => assert.rejects(promise, (error) => error.code === 'permission-denied');
const input = (overrides = {}) => ({
  denomination: 1000, series: 'E', serialColor: 'black', serialNumber: serial(),
  prefecture: '東京都', municipality: '千代田区', ...overrides,
});
const register = (c, data = input()) => registerBillIdentityV2InEmulator(c.db, c.auth, data);
const mutate = (operation, role, fields) => operation.entries.map((e) => e.role === role ? { ...e, data: { ...e.data, ...fields } } : e);

test('v2 identity integrity on isolated Firestore/Auth emulators', async (t) => {
  t.after(closeClients);
  await clearDemoProject(projectId);
  const owner = await client('v2-owner');
  const other = await client('v2-other');
  const unauth = await client('v2-public', false);
  await adminSet('appConfig/billRegistration', { mode: 'v2', identityVersion: 2 });

  await t.test('actual registry creates six documents with reciprocal indexes and private serial', async () => {
    const identity = input();
    const result = await register(owner, identity);
    assert.equal(result.status, 'registered');
    const key = rawKey(identity);
    const forward = await adminGet(`billIdentityIndex/${key}`);
    const reverse = await adminGet(`billIdentities/${result.publicBillId}`);
    const bill = await adminGet(`publicBills/${result.publicBillId}`);
    const sighting = await adminGet(`sightings/${bill.lastSightingId}`);
    const tracked = await adminGet(`users/${owner.uid}/trackedBills/${result.publicBillId}`);
    const rate = await adminGet(`rateLimits/${owner.uid}`);
    assert.equal(forward.publicBillId, result.publicBillId);
    assert.equal(reverse.identityKey, key);
    assert.equal(tracked.serialNumber, identity.serialNumber);
    assert.equal(tracked.firstRegisteredByMe, true);
    assert.equal(sighting.publicBillId, result.publicBillId);
    assert.equal(rate.lastOperationSightingId, sighting.id);
    assert.equal('serialNumber' in bill || 'identityKey' in bill || 'serialNumber' in sighting, false);
    assert.equal(await adminGet(`serialIndex/${identity.serialNumber}`), null);
  });

  for (const variant of BANKNOTE_VARIANTS) {
    await t.test(`Rules accept ${variant.denomination}/${variant.series}/${variant.serialColor}`, async () => {
      await resetRate(owner);
      const number = serial();
      const data = { ...variant, serialNumber: variant.series === 'F' ? `${number}B` : number };
      const operation = await plan(owner, data);
      await commit(owner, operation);
      assert.equal((await adminGet(`billIdentities/${operation.id}`)).identityKey, operation.key);
    });
  }

  await t.test('same serial, different denomination/series/color have distinct UUIDs', async () => {
    await resetRate(owner);
    const base = input();
    const results = [];
    for (const data of [base, { ...base, denomination: 5000 }, { ...base, series: 'D' }, { ...base, serialColor: 'brown' }]) {
      results.push(await register(owner, data));
    }
    assert.equal(new Set(results.map((result) => result.publicBillId)).size, 4);
  });

  const baseIdentity = input();
  await resetRate(owner);
  const base = await register(owner, baseIdentity);
  await t.test('concurrent same-key registrations converge without false rediscovery', async () => {
    const left = await client('v2-race-left');
    const right = await client('v2-race-right');
    const data = input();
    const results = await Promise.all([register(left, data), register(right, data)]);
    assert.equal(new Set(results.map((r) => r.publicBillId)).size, 1);
    assert.deepEqual(results.map((r) => r.status).sort(), ['recently-recorded', 'registered']);
    const bill = await adminGet(`publicBills/${results[0].publicBillId}`);
    assert.equal(bill.sightingsCount, 1);
    assert.equal((await getDocs(query(collection(owner.db, 'sightings'), where('publicBillId', '==', bill.id)))).size, 1);
  });
  await t.test('forced same-key conflict rejects alias writes and resolves to the winner', async () => {
    const left = await client('v2-forced-left');
    const right = await client('v2-forced-right');
    const identity = input();
    const operations = await Promise.all([plan(left, identity), plan(right, identity)]);
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    let arrivals = 0;
    const attempts = [0, 0];
    const results = await Promise.all([left, right].map(async (c, i) => {
      try { return await runTransaction(c.db, async (tx) => {
      attempts[i] += 1;
      const existing = await tx.get(doc(c.db, 'billIdentityIndex', operations[i].key));
      if (existing.exists()) return existing.data().publicBillId;
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
      for (const entry of operations[i].entries) tx.set(doc(c.db, entry.path), entry.data);
      return operations[i].id;
      }); } catch (error) {
        assert.equal(error.code, 'permission-denied');
        return (await register(c, identity)).publicBillId;
      }
    }));
    assert.equal(new Set(results).size, 1);
    assert.ok(attempts[0] + attempts[1] >= 2);
    assert.equal((await adminGet(`publicBills/${results[0]}`)).sightingsCount, 1);
  });
  await t.test('SDK retries a forced version conflict on allowed private metadata', async () => {
    const ref = doc(owner.db, 'users', owner.uid, 'trackedBills', base.publicBillId);
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    let arrivals = 0;
    const attempts = [0, 0];
    await Promise.all([0, 1].map((i) => runTransaction(owner.db, async (tx) => {
      attempts[i] += 1;
      const snapshot = await tx.get(ref);
      if (attempts[i] === 1) { arrivals += 1; if (arrivals === 2) release(); await barrier; }
      tx.update(ref, { notifyOnRediscovery: !snapshot.data().notifyOnRediscovery });
    })));
    assert.ok(attempts[0] + attempts[1] >= 3, 'Expected a real SDK transaction retry');
  });

  await t.test('rediscovery keeps UUID and creates other owner proof with firstRegisteredByMe=false', async () => {
    await ageBill(base.publicBillId);
    const result = await register(other, baseIdentity);
    assert.equal(result.status, 'rediscovered');
    assert.equal(result.publicBillId, base.publicBillId);
    assert.equal(result.sightingsCount, 2);
    assert.equal((await adminGet(`users/${other.uid}/trackedBills/${base.publicBillId}`)).firstRegisteredByMe, false);
    await ageBill(base.publicBillId);
    const again = await register(owner, { ...baseIdentity, municipality: '渋谷区' });
    assert.equal(again.status, 'rediscovered');
    assert.equal(again.sightingsCount, 3);
    assert.equal((await adminGet(`users/${owner.uid}/trackedBills/${base.publicBillId}`)).firstRegisteredByMe, true);
  });

  // Enumerate all 62 nonempty proper subsets, not just six single omissions.
  const incomplete = await plan(owner);
  for (let mask = 1; mask < 63; mask += 1) {
    const entries = incomplete.entries.filter((_, position) => mask & (1 << position));
    await t.test(`partial initial write ${entries.map((e) => e.role).join('+')} denied atomically`, async () => {
      await denied(commit(owner, incomplete, entries));
      assert.equal(await adminGet(`publicBills/${incomplete.id}`), null);
      assert.equal(await adminGet(`billIdentityIndex/${incomplete.key}`), null);
      assert.equal(await adminGet(`billIdentities/${incomplete.id}`), null);
      assert.equal(await adminGet(`sightings/${incomplete.sightingId}`), null);
      assert.equal(await adminGet(`users/${owner.uid}/trackedBills/${incomplete.id}`), null);
    });
  }

  await t.test('alias index alone cannot target an existing UUID', async () => {
    const alias = await plan(owner, { ...baseIdentity, serialNumber: serial() }, { id: base.publicBillId, forceIndexes: true });
    await denied(commit(owner, alias, alias.entries.filter((e) => e.role === 'index')));
    assert.equal(await adminGet(`billIdentityIndex/${alias.key}`), null);
  });
  await t.test('alias plus rewritten reverse cannot target an existing UUID', async () => {
    await ageBill(base.publicBillId);
    const alias = await plan(owner, { ...baseIdentity, serialColor: 'brown' }, { id: base.publicBillId, forceIndexes: true });
    await denied(commit(owner, alias));
  });
  await t.test('two distinct keys to one fresh UUID in one batch denied', async () => {
    const op = await plan(owner);
    const firstIndex = op.entries.find((e) => e.role === 'index');
    const aliasIdentity = { ...op.identity, serialNumber: serial() };
    const alias = { ...firstIndex, path: `billIdentityIndex/${rawKey(aliasIdentity)}`, data: { ...firstIndex.data, serialNumber: aliasIdentity.serialNumber } };
    await denied(commit(owner, op, [...op.entries, alias]));
    assert.equal(await adminGet(`publicBills/${op.id}`), null);
  });
  for (const role of ['index', 'reverse']) {
    await t.test(`${role} remains immutable even for unchanged set`, async () => {
      const path = role === 'index' ? `billIdentityIndex/${rawKey(baseIdentity)}` : `billIdentities/${base.publicBillId}`;
      const data = await adminGet(path);
      await denied(setDoc(doc(owner.db, path), data));
      await denied(updateDoc(doc(owner.db, path), { publicBillId: opaque() }));
      await denied(deleteDoc(doc(owner.db, path)));
    });
  }
  for (const [role, fields] of [
    ['index', { publicBillId: opaque() }], ['reverse', { identityKey: 'different-key' }],
    ['reverse', { serialNumber: serial() }], ['tracked', { serialNumber: serial() }],
    ['tracked', { firstRegisteredByMe: false }], ['bill', { serialNumber: 'AA123456B' }],
    ['sighting', { publicBillId: opaque() }], ['sighting', { userNote: 'AA123456B' }],
    ['rate', { lastOperationPublicBillId: opaque() }], ['rate', { lastOperationSightingId: 'missing' }],
  ]) {
    await t.test(`inconsistent ${role} fields rejected`, async () => {
      const op = await plan(owner);
      await denied(commit(owner, op, mutate(op, role, fields)));
    });
  }
  for (const invalid of [
    { denomination: 2000, series: 'E', serialColor: 'black' },
    { denomination: 2000, series: 'F', serialColor: 'black' },
    { denomination: 5000, series: 'E', serialColor: 'navy' },
    { denomination: 1000, series: 'D', serialColor: 'navy' },
    { denomination: 1000, series: 'F', serialColor: 'brown' },
    { denomination: 1000, series: 'unknown', serialColor: 'black' },
    { denomination: 1000, series: 'E', serialColor: 'unknown' },
    { denomination: 3000, series: 'D', serialColor: 'black' },
  ]) {
    await t.test(`invalid variant ${JSON.stringify(invalid)} rejected by Rules`, async () => {
      const op = await plan(owner, { ...invalid, serialNumber: serial() });
      await denied(commit(owner, op));
    });
  }
  for (const badSerial of ['AA000000B', 'AA900001B', 'AI123456B', 'AA123456O', 'aa123456b', 'AA123456B/extra']) {
    await t.test(`invalid serial ${badSerial} cannot be stored`, async () => {
      // A slash is rejected by the SDK's path arity, not by the Rules evaluator.
      if (badSerial.includes('/')) {
        await assert.rejects(register(owner, input({ serialNumber: badSerial })), (e) => e.code === 'invalid-serial');
      } else {
        const op = await plan(owner, { denomination: 1000, series: 'E', serialColor: 'black', serialNumber: badSerial });
        await denied(commit(owner, op));
      }
    });
  }

  await t.test('existing rate cannot be replayed or reused while paused', async () => {
    await resetRate(owner);
    const existingRate = await adminGet(`rateLimits/${owner.uid}`);
    await adminSet('appConfig/billRegistration', { mode: 'paused', identityVersion: 2 });
    const op = await plan(owner);
    await denied(commit(owner, op));
    await denied(commit(owner, op, mutate(op, 'rate', existingRate)));
    await denied(commit(owner, op, op.entries.filter((e) => e.role !== 'rate')));
    await denied(setDoc(doc(owner.db, 'rateLimits', owner.uid), existingRate));
    assert.equal(await adminGet(`publicBills/${op.id}`), null);
    await adminSet('appConfig/billRegistration', { mode: 'v2', identityVersion: 2 });
  });
  for (const mode of ['missing', 'unknown', 'wrong-version']) {
    await t.test(`registration gate ${mode} fails closed`, async () => {
      if (mode === 'missing') await adminDelete('appConfig/billRegistration');
      else await adminSet('appConfig/billRegistration', { mode: mode === 'unknown' ? 'other' : 'v2', identityVersion: mode === 'wrong-version' ? 1 : 2 });
      const op = await plan(owner);
      await denied(commit(owner, op));
      await assert.rejects(register(owner), (e) => e.code === 'registration-paused');
      await adminSet('appConfig/billRegistration', { mode: 'v2', identityVersion: 2 });
    });
  }
  await t.test('rate-only advancement using an existing sighting denied', async () => {
    const rate = await adminGet(`rateLimits/${owner.uid}`);
    await denied(updateDoc(doc(owner.db, 'rateLimits', owner.uid), {
      shortCount: rate.shortCount + 1, dailyCount: rate.dailyCount + 1, updatedAt: serverTimestamp(),
    }));
  });
  await t.test('public bill only, fresh sighting only, or rate plus index cannot bypass the graph', async () => {
    await ageBill(base.publicBillId);
    const rediscovery = await plan(owner, baseIdentity);
    for (const role of ['bill', 'sighting']) {
      await denied(commit(owner, rediscovery, rediscovery.entries.filter((e) => e.role === role)));
    }
    const op = await plan(owner);
    await denied(commit(owner, op, op.entries.filter((e) => ['index', 'rate'].includes(e.role))));
  });
  await t.test('existing public/reverse state cannot replace required writes', async () => {
    await ageBill(base.publicBillId);
    const op = await plan(owner, baseIdentity);
    for (const role of ['bill', 'sighting', 'tracked', 'rate']) {
      await denied(commit(owner, op, op.entries.filter((e) => e.role !== role)));
    }
  });

  await t.test('private reverse, other-owner serials and rate state are inaccessible', async () => {
    for (const c of [owner, other, unauth]) {
      await denied(getDoc(doc(c.db, 'billIdentities', base.publicBillId)));
      await denied(getDocs(collection(c.db, 'billIdentities')));
    }
    await denied(getDoc(doc(other.db, 'users', owner.uid, 'trackedBills', base.publicBillId)));
    await denied(getDoc(doc(other.db, 'rateLimits', owner.uid)));
    await denied(getDocs(collection(owner.db, 'billIdentityIndex')));
    await denied(getDocs(query(collection(owner.db, 'billIdentityIndex'), where('publicBillId', '==', base.publicBillId))));
    await denied(getDoc(doc(unauth.db, 'billIdentityIndex', rawKey(baseIdentity))));
    assert.equal((await getDoc(doc(other.db, 'billIdentityIndex', rawKey(baseIdentity)))).data().publicBillId, base.publicBillId);
  });
  for (const role of ['tracked', 'rate']) {
    await t.test(`using another UID for ${role} rejected`, async () => {
      const op = await plan(owner);
      const entries = op.entries.map((e) => e.role === role ? { ...e, path: e.path.replace(owner.uid, other.uid) } : e);
      await denied(commit(owner, op, entries));
    });
  }
  await t.test('clients cannot modify the gate', async () => {
    await denied(updateDoc(doc(owner.db, 'appConfig', 'billRegistration'), { mode: 'v2' }));
  });

  const legacyId = opaque();
  const legacyIdentity = input();
  const oldDate = new Date('2000-01-01T00:00:00Z');
  const legacyTrackedPath = `users/${owner.uid}/trackedBills/${legacyId}`;
  await adminSet(`publicBills/${legacyId}`, {
    id: legacyId, denomination: 1000, createdAt: oldDate.toISOString(), updatedAt: oldDate.toISOString(),
    firstSightedAt: oldDate.toISOString(), lastSightedAt: oldDate.toISOString(),
    lastSightedAtServer: oldDate, sightingsCount: 2, totalDistanceKm: 10,
    lastSightingId: 'legacy-v2-fixture', lastMunicipality: '千代田区',
  });
  await adminSet(`sightings/legacy-v2-fixture`, {
    id: 'legacy-v2-fixture', publicBillId: legacyId, step: 2, prefecture: '東京都', municipality: '千代田区',
    createdAt: oldDate.toISOString(), distanceFromPrevKm: 10, daysFromPrev: 1,
  });
  await adminSet(`serialIndex/${legacyIdentity.serialNumber}`, { publicBillId: legacyId, createdAt: oldDate });
  await adminSet(legacyTrackedPath, {
    publicBillId: legacyId, serialNumber: legacyIdentity.serialNumber, denomination: 1000,
    createdAt: oldDate, firstRegisteredByMe: true, notifyOnRediscovery: false,
  });
  const legacyBillBefore = await adminGet(`publicBills/${legacyId}`);
  const legacyHistoryBefore = await adminGet('sightings/legacy-v2-fixture');
  await t.test('legacy ambiguity has no writes; acknowledgement creates independent history', async () => {
    await resetRate(owner);
    assert.deepEqual(await register(owner, legacyIdentity), { status: 'legacy-ambiguous', legacyPublicBillId: legacyId });
    assert.equal(await adminGet(`billIdentityIndex/${rawKey(legacyIdentity)}`), null);
    const registered = await register(owner, { ...legacyIdentity, legacyAcknowledgedBillId: legacyId });
    assert.equal(registered.status, 'registered');
    assert.notEqual(registered.publicBillId, legacyId);
    assert.deepEqual(await adminGet(`publicBills/${legacyId}`), legacyBillBefore);
    assert.deepEqual(await adminGet('sightings/legacy-v2-fixture'), legacyHistoryBefore);
    assert.equal((await adminGet(`serialIndex/${legacyIdentity.serialNumber}`)).publicBillId, legacyId);
  });
  await t.test('legacy records stay readable and personal fields initialize without identity changes', async () => {
    assert.equal((await getDoc(doc(unauth.db, 'publicBills', legacyId))).exists(), true);
    assert.equal((await getDoc(doc(owner.db, legacyTrackedPath))).exists(), true);
    await updateDoc(doc(owner.db, legacyTrackedPath), {
      lastSeenSightingsCount: 2, lastSeenAt: serverTimestamp(), lastSeenMunicipality: '千代田区', notifyOnRediscovery: true,
    });
    const data = await adminGet(legacyTrackedPath);
    assert.equal(data.serialNumber, legacyIdentity.serialNumber);
    assert.equal(data.notifyOnRediscovery, true);
    assert.equal('identityVersion' in data, false);
    await adminSet('appConfig/billRegistration', { mode: 'paused', identityVersion: 2 });
    await updateDoc(doc(owner.db, legacyTrackedPath), { notifyOnRediscovery: false });
    await adminSet('appConfig/billRegistration', { mode: 'v2', identityVersion: 2 });
  });
  for (const [field, value] of [
    ['serialNumber', serial()], ['publicBillId', opaque()], ['denomination', 2000],
    ['identityVersion', 2], ['series', 'D'], ['serialColor', 'black'], ['owner', other.uid],
    ['firstRegisteredByMe', false], ['createdAt', serverTimestamp()], ['lastSeenSightingsCount', 3],
    ['lastSeenAt', oldDate], ['notifyOnRediscovery', 'yes'], ['legacyAcknowledgedBillId', legacyId],
  ]) {
    await t.test(`legacy tracked ${field} unauthorized modification denied`, async () => {
      await denied(updateDoc(doc(owner.db, legacyTrackedPath), { [field]: value }));
    });
  }
  await t.test('legacy tracked other-owner modification and delete denied', async () => {
    await denied(updateDoc(doc(other.db, legacyTrackedPath), { notifyOnRediscovery: true }));
    await denied(deleteDoc(doc(owner.db, legacyTrackedPath)));
  });
  await t.test('legacy writes and forged acknowledgement cannot append or assign reverse identity', async () => {
    await denied(setDoc(doc(owner.db, 'serialIndex', serial()), { publicBillId: opaque(), createdAt: serverTimestamp() }));
    await denied(updateDoc(doc(owner.db, 'publicBills', legacyId), { sightingsCount: 3 }));
    await denied(updateDoc(doc(owner.db, 'publicBills', legacyId), { identityVersion: 2, series: 'E', serialColor: 'black' }));
    await denied(setDoc(doc(owner.db, 'bills', legacyIdentity.serialNumber), { denomination: 1000 }));
    const op = await plan(owner, { ...legacyIdentity, serialNumber: serial() }, { id: legacyId, forceIndexes: true });
    await denied(commit(owner, op, mutate(op, 'tracked', { legacyAcknowledgedBillId: legacyId })));
  });
  await t.test('legacy first-registration metadata cannot be created or relabeled', async () => {
    const oldTracked = await adminGet(legacyTrackedPath);
    await denied(setDoc(doc(other.db, 'users', other.uid, 'trackedBills', legacyId), oldTracked));
    await denied(setDoc(doc(owner.db, 'users', owner.uid, 'trackedBills', opaque()), oldTracked));
  });
  for (const mode of ['v2', 'paused']) {
    await t.test(`complete old five-document registration is denied in ${mode} mode`, async () => {
      await adminSet('appConfig/billRegistration', { mode, identityVersion: 2 });
      const op = await plan(owner);
      const entries = op.entries.filter((e) => e.role !== 'reverse').map((e) => {
        if (e.role === 'index') return {
          ...e, path: `serialIndex/${op.identity.serialNumber}`,
          data: { publicBillId: op.id, createdAt: serverTimestamp() },
        };
        const { identityVersion: _version, series: _series, serialColor: _color, ...legacyData } = e.data;
        return { ...e, data: legacyData };
      });
      await denied(commit(owner, op, entries));
      assert.equal(await adminGet(`publicBills/${op.id}`), null);
      assert.equal(await adminGet(`serialIndex/${op.identity.serialNumber}`), null);
      await adminSet('appConfig/billRegistration', { mode: 'v2', identityVersion: 2 });
    });
  }

  await t.test('anonymous Google linking and cross-client sign-in retain existing UID and records', async () => {
    const base64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${base64({ alg: 'none', typ: 'JWT' })}.${base64({
      iss: 'https://accounts.google.com', aud: projectId, sub: `emulator-google-${owner.uid}`,
      email: `${owner.uid}@example.invalid`, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;
    const credential = GoogleAuthProvider.credential(token);
    const linked = await linkWithCredential(owner.auth.currentUser, credential);
    assert.equal(linked.user.uid, owner.uid);
    const browser = await client('v2-google-browser');
    const signedIn = await signInWithCredential(browser.auth, credential);
    assert.equal(signedIn.user.uid, owner.uid);
    assert.equal((await getDoc(doc(browser.db, legacyTrackedPath))).exists(), true);
    assert.equal((await getDoc(doc(browser.db, 'users', owner.uid, 'trackedBills', base.publicBillId))).exists(), true);
    await resetRate(browser);
    const result = await register(browser);
    assert.equal(result.status, 'registered');
    assert.equal((await getDoc(doc(owner.db, 'users', owner.uid, 'trackedBills', result.publicBillId))).exists(), true);
  });
  await t.test('public aggregates and selected history preserve privacy and UUID routes', async () => {
    const aggregate = await getAggregateFromServer(collection(unauth.db, 'publicBills'), { total: count(), sightings: sum('sightingsCount') });
    assert.ok(aggregate.data().total >= 19);
    assert.ok(aggregate.data().sightings >= aggregate.data().total);
    const bill = (await getDoc(doc(unauth.db, 'publicBills', base.publicBillId))).data();
    assert.equal('serialNumber' in projectPublicBill(base.publicBillId, bill), false);
    const history = await getDocs(query(collection(unauth.db, 'sightings'), where('publicBillId', '==', base.publicBillId)));
    assert.equal(history.size, 3);
    assert.ok(history.docs.every((snapshot) => !('serialNumber' in snapshot.data())));
  });
  await t.test('TCP connection failure has no writes; retry after reconnect creates once', async (subtest) => {
    // Node SDK transactions can still contact the server after disableNetwork().
    // A loopback TCP proxy exercises actual transport failure instead.
    let connected = false;
    const sockets = new Set();
    const proxy = createServer((socket) => {
      if (!connected) { socket.destroy(); return; }
      const upstream = createConnection(Number(firestoreHost.split(':')[1]), '127.0.0.1');
      sockets.add(socket); sockets.add(upstream);
      socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
      socket.on('close', () => { sockets.delete(socket); upstream.destroy(); });
      upstream.on('close', () => { sockets.delete(upstream); socket.destroy(); });
      socket.pipe(upstream); upstream.pipe(socket);
    });
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
    subtest.after(() => { for (const socket of sockets) socket.destroy(); proxy.close(); });
    const c = await client('v2-offline', true, projectId, proxy.address().port);
    const data = input();
    await assert.rejects(register(c, data), (e) => e.code === 'unavailable');
    assert.equal(await adminGet(`billIdentityIndex/${rawKey(data)}`), null);
    connected = true;
    const result = await register(c, data);
    const retry = await register(c, data);
    assert.equal(retry.status, 'recently-recorded');
    assert.equal(retry.publicBillId, result.publicBillId);
    assert.equal((await adminGet(`publicBills/${result.publicBillId}`)).sightingsCount, 1);
  });
  await t.test('stage-2 registry refuses a production project before any Firestore operation', async () => {
    await assert.rejects(registerBillIdentityV2InEmulator(
      { app: { options: { projectId: 'production-project' } } }, owner.auth, input(),
    ), (e) => e.code === 'emulator-only');
  });
});
