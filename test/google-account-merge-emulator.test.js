import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator, GoogleAuthProvider, getAuth, linkWithCredential, signInWithCredential,
} from 'firebase/auth';
import {
  doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc,
} from 'firebase/firestore';
import { cleanupCompletedTrackedBillMerge, mergeTrackedBillsWithConsent, previewTrackedBillMerge, runTrackedBillMerge } from '../src/services/trackedBillMerge.ts';
import {
  adminGet, adminSet, clearDemoProject, client, closeClients, loadRules,
  opaque,
} from './helpers/identity-emulator.js';

const project = 'demo-osatsu-account-merge-poc';
const sourceBillId = 'b7a1d95c-9ad1-4f7d-8758-82fe4dc4f801';
const duplicateBillId = 'b7a1d95c-9ad1-4f7d-8758-82fe4dc4f802';
const concurrentBillId = 'b7a1d95c-9ad1-4f7d-8758-82fe4dc4f803';

function googleToken(subject) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: 'https://accounts.google.com', aud: project, sub: subject,
    email: `${subject}@example.invalid`, email_verified: true,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  })}.`;
}

function tracked(publicBillId, serialNumber, overrides = {}) {
  return {
    identityVersion: 2, series: 'F', serialColor: 'black', publicBillId,
    serialNumber, denomination: 1000,
    createdAt: Timestamp.fromDate(new Date('2026-01-02T03:04:05Z')),
    firstRegisteredByMe: true, notifyOnRediscovery: true,
    lastSeenSightingsCount: 2,
    lastSeenAt: Timestamp.fromDate(new Date('2026-02-03T04:05:06Z')),
    lastSeenMunicipality: '千代田区',
    ...overrides,
  };
}

test('local Auth + production-candidate Rules tracked-bill merge', async (t) => {
  t.after(closeClients);
  await clearDemoProject(project);
  const rules = await readFile(new URL('../firestore.strict.rules', import.meta.url), 'utf8');
  await loadRules(rules, project);

  const source = await client('merge-source-anon', true, project);
  const target = await client('merge-target-google', false, project);
  const attacker = await client('merge-third-party-anon', true, project);
  const credential = GoogleAuthProvider.credential(googleToken('merge-target'));
  const sourceUid = source.auth.currentUser.uid;
  let targetUser;
  let targetUid;

  await t.test('secondary Auth handles collision without replacing the anonymous session', async () => {
    ({ user: targetUser } = await signInWithCredential(target.auth, credential));
    targetUid = targetUser.uid;
    assert.equal(targetUser.isAnonymous, false);
    assert.ok(targetUser.providerData.some((provider) => provider.providerId === 'google.com'));
    assert.notEqual(targetUid, sourceUid);

    await assert.rejects(linkWithCredential(source.auth.currentUser, credential), (error) =>
      ['auth/credential-already-in-use', 'auth/email-already-in-use'].includes(error.code));
    assert.equal(source.auth.currentUser.uid, sourceUid);
    assert.equal(source.auth.currentUser.isAnonymous, true);

    const invalidAuth = await client('merge-invalid-secondary', false, project);
    await assert.rejects(signInWithCredential(invalidAuth.auth, GoogleAuthProvider.credential('invalid-token')));
    assert.equal(source.auth.currentUser.uid, sourceUid);

    const offlineApp = initializeApp({ projectId: project, apiKey: 'fake-api-key' }, 'merge-offline-secondary');
    const offlineAuth = getAuth(offlineApp);
    connectAuthEmulator(offlineAuth, 'http://127.0.0.1:1', { disableWarnings: true });
    await assert.rejects(signInWithCredential(offlineAuth, credential), (error) => error.code === 'auth/network-request-failed');
    await deleteApp(offlineApp);
    assert.equal(source.auth.currentUser.uid, sourceUid);
  });

  const sourcePath = `users/${sourceUid}/trackedBills`;
  const targetPath = `users/${targetUid}/trackedBills`;
  const sourceRecord = tracked(sourceBillId, 'AA123456BB');
  const sourceDuplicate = tracked(duplicateBillId, 'BC234567DE', { firstRegisteredByMe: false });
  const targetDuplicate = tracked(duplicateBillId, 'BC234567DE', {
    firstRegisteredByMe: true,
    notifyOnRediscovery: false,
    lastSeenSightingsCount: 8,
    lastSeenMunicipality: '港区',
  });
  await adminSet(`${sourcePath}/${sourceBillId}`, sourceRecord, project);
  await adminSet(`${sourcePath}/${duplicateBillId}`, sourceDuplicate, project);
  await adminSet(`${targetPath}/${duplicateBillId}`, targetDuplicate, project);
  await adminSet(`publicBills/${sourceBillId}`, { id: sourceBillId, sightingsCount: 2 }, project);
  await adminSet('sightings/merge-poc-existing-sighting', { publicBillId: sourceBillId, step: 2 }, project);
  const immutableBefore = await Promise.all([
    adminGet(`publicBills/${sourceBillId}`, project),
    adminGet('sightings/merge-poc-existing-sighting', project),
    adminGet(`billIdentityIndex/v2_JPY_1000_F_black_AA123456BB`, project),
  ]);

  await t.test('preview is read-only and reports copies versus preserved duplicates', async () => {
    await assert.rejects(getDoc(doc(target.db, `${sourcePath}/${sourceBillId}`)), (error) => error.code === 'permission-denied');
    await assert.rejects(getDoc(doc(attacker.db, `${sourcePath}/${sourceBillId}`)), (error) => error.code === 'permission-denied');
    const preview = await previewTrackedBillMerge(source.db, target.db, sourceUid, targetUid);
    assert.equal(preview.totalCount, 2);
    assert.equal(preview.copyCount, 1);
    assert.equal(preview.duplicateCount, 1);
    assert.equal(preview.alreadyCopiedCount, 0);
    assert.equal(await adminGet(`${targetPath}/${sourceBillId}`, project), null);
    const cancelled = await mergeTrackedBillsWithConsent({
      sourceDb: source.db,
      targetDb: target.db,
      sourceUid,
      targetUid,
      preview,
      confirm: () => false,
    });
    assert.deepEqual(cancelled, { status: 'cancelled' });
    assert.equal(await adminGet(`users/${sourceUid}/trackedBillMergeLocks/active`, project), null);
    assert.equal(await adminGet(`${targetPath}/${sourceBillId}`, project), null);
  });

  let preview = await previewTrackedBillMerge(source.db, target.db, sourceUid, targetUid);
  await t.test('interruption keeps source Auth and data, and resume is idempotent', async () => {
    await assert.rejects(runTrackedBillMerge({
      sourceDb: source.db,
      targetDb: target.db,
      sourceUid,
      targetUid,
      preview,
      onProgress: (progress) => {
        if (progress.phase === 'copying' && progress.copiedCount === 1) throw new Error('simulated network interruption');
      },
    }), /simulated network interruption/);

    assert.equal(source.auth.currentUser.uid, sourceUid);
    assert.equal(source.auth.currentUser.isAnonymous, true);
    assert.deepEqual(await adminGet(`${sourcePath}/${sourceBillId}`, project), sourceRecord);
    assert.ok(await adminGet(`${targetPath}/${sourceBillId}`, project));
    const lock = await adminGet(`users/${sourceUid}/trackedBillMergeLocks/active`, project);
    assert.equal(lock.targetUid, targetUid);
    const ticketId = lock.ticketId;

    await assert.rejects(updateDoc(doc(source.db, `${sourcePath}/${sourceBillId}`), { notifyOnRediscovery: false }),
      (error) => error.code === 'permission-denied');

    const exportPath = `users/${sourceUid}/trackedBillMergeExports/${ticketId}/items/${sourceBillId}`;
    assert.equal((await getDoc(doc(source.db, exportPath))).data().tracked.serialNumber, sourceRecord.serialNumber);
    await assert.rejects(setDoc(doc(source.db, `users/${sourceUid}/trackedBillMergeExports/${ticketId}/items/${duplicateBillId}`), {
      sourceUid, targetUid, publicBillId: duplicateBillId,
      tracked: { ...sourceDuplicate, serialNumber: 'ZZ999999Z' }, createdAt: serverTimestamp(),
    }), (error) => error.code === 'permission-denied');
    await assert.rejects(getDoc(doc(attacker.db, exportPath)), (error) => error.code === 'permission-denied');
    assert.equal((await getDoc(doc(target.db, exportPath))).data().tracked.serialNumber, sourceRecord.serialNumber);
    await assert.rejects(setDoc(doc(target.db, `${targetPath}/${sourceBillId}`), { ...sourceRecord, serialNumber: 'ZZ999999Z' }),
      (error) => error.code === 'permission-denied');

    preview = await previewTrackedBillMerge(source.db, target.db, sourceUid, targetUid);
    assert.equal(preview.ticketId, ticketId);
    assert.equal(preview.copyCount, 0);
    assert.equal(preview.duplicateCount, 1);
    assert.equal(preview.alreadyCopiedCount, 1);
    const resumed = await runTrackedBillMerge({ sourceDb: source.db, targetDb: target.db, sourceUid, targetUid, preview });
    assert.equal(resumed.copiedCount, 1);
    assert.equal(resumed.duplicateCount, 1);
    assert.deepEqual(await adminGet(`${targetPath}/${sourceBillId}`, project), sourceRecord);
    assert.deepEqual(await adminGet(`${targetPath}/${duplicateBillId}`, project), targetDuplicate);
    assert.deepEqual(await adminGet(`${sourcePath}/${duplicateBillId}`, project), sourceDuplicate);
  });

  await t.test('cross-account ticket misuse and expired authorization are rejected', async () => {
    const currentLock = await adminGet(`users/${sourceUid}/trackedBillMergeLocks/active`, project);
    await assert.rejects(setDoc(doc(attacker.db,
      `users/${attacker.uid}/trackedBillMergeLocks/active`), {
      sourceUid: attacker.uid, targetUid, ticketId: currentLock.ticketId,
      expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60_000),
    }), (error) => error.code === 'permission-denied');
    await assert.rejects(setDoc(doc(attacker.db,
      `users/${attacker.uid}/trackedBillMergeExports/${currentLock.ticketId}/items/${sourceBillId}`), {
      sourceUid: attacker.uid, targetUid, publicBillId: sourceBillId,
      tracked: sourceRecord, createdAt: serverTimestamp(),
    }), (error) => error.code === 'permission-denied');
    const attackerGoogle = await client('merge-third-party-google', false, project);
    await signInWithCredential(attackerGoogle.auth,
      GoogleAuthProvider.credential(googleToken('merge-attacker')));
    await assert.rejects(setDoc(doc(attackerGoogle.db,
      `users/${targetUid}/trackedBillMergeTickets/${opaque()}`), {
      sourceUid, targetUid, totalCount: 1, status: 'open', createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60_000),
    }), (error) => error.code === 'permission-denied');

    const expiredId = opaque();
    await assert.rejects(setDoc(doc(target.db, `users/${targetUid}/trackedBillMergeTickets/${expiredId}`), {
      sourceUid, targetUid, totalCount: 2, status: 'open', createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() - 60_000),
    }), (error) => error.code === 'permission-denied');
    await cleanupCompletedTrackedBillMerge(source.db, target.db, sourceUid, targetUid, currentLock.ticketId);
  });

  await t.test('simultaneous resumes create one destination record and preserve public history', async () => {
    // A third unique source record creates a fresh import while the same ticket is
    // resumed twice. Transactions and the stable publicBillId path prevent dupes.
    const sourceConcurrent = tracked(concurrentBillId, 'CD345678EF');
    await adminSet(`${sourcePath}/${concurrentBillId}`, sourceConcurrent, project);
    const concurrentTicket = opaque();
    const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60_000);
    await setDoc(doc(target.db, `users/${targetUid}/trackedBillMergeTickets/${concurrentTicket}`), {
      sourceUid, targetUid, totalCount: 3, status: 'open', createdAt: serverTimestamp(), expiresAt,
    });
    await setDoc(doc(source.db, `users/${sourceUid}/trackedBillMergeLocks/active`), {
      sourceUid, targetUid, ticketId: concurrentTicket, expiresAt,
    });
    const concurrentPreview = await previewTrackedBillMerge(source.db, target.db, sourceUid, targetUid);
    const concurrentResults = await Promise.allSettled([
      runTrackedBillMerge({ sourceDb: source.db, targetDb: target.db, sourceUid, targetUid, preview: concurrentPreview }),
      runTrackedBillMerge({ sourceDb: source.db, targetDb: target.db, sourceUid, targetUid, preview: concurrentPreview }),
    ]);
    assert.ok(concurrentResults.some((result) => result.status === 'fulfilled'));
    const retryPreview = await previewTrackedBillMerge(source.db, target.db, sourceUid, targetUid);
    await runTrackedBillMerge({ sourceDb: source.db, targetDb: target.db, sourceUid, targetUid, preview: retryPreview });
    assert.deepEqual(await adminGet(`${targetPath}/${concurrentBillId}`, project), sourceConcurrent);
    assert.deepEqual(await Promise.all([
      adminGet(`publicBills/${sourceBillId}`, project),
      adminGet('sightings/merge-poc-existing-sighting', project),
      adminGet('billIdentityIndex/v2_JPY_1000_F_black_AA123456BB', project),
    ]), immutableBefore);
    await cleanupCompletedTrackedBillMerge(source.db, target.db, sourceUid, targetUid, concurrentTicket);
  });
});
