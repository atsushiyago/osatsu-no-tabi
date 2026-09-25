import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const projectId = 'demo-george-strict-rate-limit';
const anonymousApp = initializeApp({ projectId, apiKey: 'fake-api-key' }, 'strict-auth');
const auth = getAuth(anonymousApp);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const db = getFirestore(anonymousApp);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

const unauthenticatedApp = initializeApp({ projectId, apiKey: 'fake-api-key' }, 'strict-unauth');
const unauthenticatedDb = getFirestore(unauthenticatedApp);
connectFirestoreEmulator(unauthenticatedDb, '127.0.0.1', 8080);

let passed = 0;
let failed = 0;
let serialIndex = 1;

async function assertPass(name, action) {
  try {
    await action();
    console.log(`  ✔ [PASS] ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✘ [FAIL] ${name}: ${error?.message ?? error}`);
    failed++;
  }
}

async function assertReject(name, action) {
  try {
    await action();
    console.error(`  ✘ [FAIL - Expected rejection] ${name}`);
    failed++;
  } catch {
    console.log(`  ✔ [PASS] ${name} (rejected)`);
    passed++;
  }
}

function nextSerial() {
  const serial = `RL${String(serialIndex++).padStart(6, '0')}A`;
  return serial;
}

function currentCount(rate, field, windowField, windowMs) {
  const start = rate?.[windowField];
  const expired = !start || Date.now() - start.toMillis() >= windowMs;
  return { expired, count: Number.isInteger(rate?.[field]) ? rate[field] : 0 };
}

function makeRateUpdate(rate, billId, sightingId, overrides = {}) {
  const short = currentCount(rate, 'shortCount', 'shortWindowStartedAt', 10 * 60 * 1000);
  const daily = currentCount(rate, 'dailyCount', 'dailyWindowStartedAt', 24 * 60 * 60 * 1000);
  return {
    shortWindowStartedAt: short.expired ? serverTimestamp() : rate.shortWindowStartedAt,
    shortCount: short.expired ? 1 : short.count + 1,
    dailyWindowStartedAt: daily.expired ? serverTimestamp() : rate.dailyWindowStartedAt,
    dailyCount: daily.expired ? 1 : daily.count + 1,
    updatedAt: serverTimestamp(),
    lastOperationBillId: billId,
    lastOperationSightingId: sightingId,
    ...overrides,
  };
}

async function recordOperation({ billId = nextSerial(), rateOverrides = {}, rateWrite = true, secondBill = false } = {}) {
  const billRef = doc(db, 'bills', billId);
  const rateRef = doc(db, 'rateLimits', auth.currentUser.uid);
  const sightingRef = doc(collection(db, 'sightings'));
  const createdAt = new Date().toISOString();

  await runTransaction(db, async (transaction) => {
    const [billSnap, rateSnap] = await Promise.all([
      transaction.get(billRef),
      transaction.get(rateRef),
    ]);
    const rate = rateSnap.exists() ? rateSnap.data() : null;
    const sightingStep = billSnap.exists() ? billSnap.data().sightingsCount + 1 : 1;
    const sighting = {
      id: sightingRef.id,
      billId,
      step: sightingStep,
      prefecture: '東京都',
      municipality: '千代田区',
      latitudeApprox: 35.6938,
      longitudeApprox: 139.7532,
      createdAt,
      distanceFromPrevKm: 0,
      daysFromPrev: 0,
    };

    if (billSnap.exists()) {
      transaction.update(billRef, {
        updatedAt: createdAt,
        sightingsCount: sightingStep,
        totalDistanceKm: billSnap.data().totalDistanceKm,
        lastSightedAt: createdAt,
        lastSightedAtServer: serverTimestamp(),
      });
    } else {
      transaction.set(billRef, {
        id: billId,
        serialNumber: billId,
        denomination: 1000,
        createdAt,
        updatedAt: createdAt,
        sightingsCount: 1,
        totalDistanceKm: 0,
        firstSightedAt: createdAt,
        lastSightedAt: createdAt,
        lastSightedAtServer: serverTimestamp(),
      });
    }
    transaction.set(sightingRef, sighting);
    if (rateWrite) transaction.set(rateRef, makeRateUpdate(rate, billId, sightingRef.id, rateOverrides));
    if (secondBill) {
      const extraBillId = nextSerial();
      const extraBillRef = doc(db, 'bills', extraBillId);
      const extraSightingRef = doc(collection(db, 'sightings'));
      transaction.set(extraBillRef, {
        id: extraBillId, serialNumber: extraBillId, denomination: 1000, createdAt,
        updatedAt: createdAt, sightingsCount: 1, totalDistanceKm: 0,
        firstSightedAt: createdAt, lastSightedAt: createdAt,
        lastSightedAtServer: serverTimestamp(),
      });
      transaction.set(extraSightingRef, {
        id: extraSightingRef.id, billId: extraBillId, step: 1,
        prefecture: '東京都', municipality: '千代田区', latitudeApprox: 35.6938,
        longitudeApprox: 139.7532, createdAt, distanceFromPrevKm: 0, daysFromPrev: 0,
      });
    }
  });
  return { billId, sightingId: sightingRef.id };
}

async function setRateFixture(uid, {
  shortWindowStartedAt = new Date().toISOString(),
  shortCount = 1,
  dailyWindowStartedAt = new Date().toISOString(),
  dailyCount = 1,
  lastOperationBillId,
  lastOperationSightingId,
}) {
  const rate = (await getDoc(doc(db, 'rateLimits', uid))).data();
  const values = {
    shortWindowStartedAt: { timestampValue: shortWindowStartedAt },
    shortCount: { integerValue: String(shortCount) },
    dailyWindowStartedAt: { timestampValue: dailyWindowStartedAt },
    dailyCount: { integerValue: String(dailyCount) },
    updatedAt: { timestampValue: new Date().toISOString() },
    lastOperationBillId: { stringValue: lastOperationBillId ?? rate.lastOperationBillId },
    lastOperationSightingId: { stringValue: lastOperationSightingId ?? rate.lastOperationSightingId },
  };
  const mask = Object.keys(values).map((field) => `updateMask.fieldPaths=${field}`).join('&');
  const url = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/rateLimits/${uid}?${mask}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: values }),
  });
  if (!response.ok) throw new Error(`Could not seed rate limit fixture: ${response.status} ${await response.text()}`);
}

async function setBillCooldown(billId, isoTime) {
  const url = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/bills/${billId}?updateMask.fieldPaths=lastSightedAtServer`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { lastSightedAtServer: { timestampValue: isoTime } } }),
  });
  if (!response.ok) throw new Error(`Could not seed bill cooldown: ${response.status} ${await response.text()}`);
}

async function seedLegacyBill(billId) {
  const iso = new Date().toISOString();
  const fields = {
    id: { stringValue: billId },
    serialNumber: { stringValue: billId },
    denomination: { integerValue: '1000' },
    createdAt: { stringValue: iso },
    updatedAt: { stringValue: iso },
    sightingsCount: { integerValue: '1' },
    totalDistanceKm: { integerValue: '0' },
    firstSightedAt: { stringValue: iso },
    lastSightedAt: { stringValue: iso },
  };
  const url = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/bills?documentId=${billId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error(`Could not seed legacy bill: ${response.status} ${await response.text()}`);
}

async function main() {
  const user = (await signInAnonymously(auth)).user;
  console.log('=== Strict Rules UID rate-limit tests ===\n');

  await assertReject('未認証public write拒否', async () => {
    const billId = nextSerial();
    const billRef = doc(unauthenticatedDb, 'bills', billId);
    const sightingRef = doc(collection(unauthenticatedDb, 'sightings'));
    const iso = new Date().toISOString();
    await runTransaction(unauthenticatedDb, async (transaction) => {
      transaction.set(billRef, {
        id: billId, serialNumber: billId, denomination: 1000, createdAt: iso, updatedAt: iso,
        sightingsCount: 1, totalDistanceKm: 0, firstSightedAt: iso, lastSightedAt: iso,
        lastSightedAtServer: serverTimestamp(),
      });
      transaction.set(sightingRef, {
        id: sightingRef.id, billId, step: 1, prefecture: '東京都', municipality: '千代田区',
        latitudeApprox: 35.6938, longitudeApprox: 139.7532, createdAt: iso,
        distanceFromPrevKm: 0, daysFromPrev: 0,
      });
    });
  });

  await assertPass('初回write成功、bill+sightingでもカウントは1回', async () => {
    await recordOperation();
    const rate = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (rate.shortCount !== 1 || rate.dailyCount !== 1) throw new Error('operation incremented more than once');
  });

  await assertPass('legacy cooldown clock初期化は登録rateを消費しない', async () => {
    const billId = nextSerial();
    await seedLegacyBill(billId);
    const before = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    await runTransaction(db, async (transaction) => {
      const billRef = doc(db, 'bills', billId);
      await transaction.get(billRef);
      transaction.update(billRef, { lastSightedAtServer: serverTimestamp() });
    });
    const after = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (after.shortCount !== before.shortCount || after.dailyCount !== before.dailyCount) {
      throw new Error('cooldown clock initialization consumed a registration');
    }
  });

  await assertReject('同一rate incrementで複数billをまとめてwriteできない', async () => {
    await recordOperation({ secondBill: true });
  });

  await assertReject('rateLimits更新なしのpublic write拒否', async () => {
    await recordOperation({ rateWrite: false });
  });

  await setRateFixture(user.uid, { shortCount: 2, dailyCount: 2 });
  await assertReject('counter jumpは拒否', async () => {
    await recordOperation({ rateOverrides: { shortCount: 4, dailyCount: 4 } });
  });

  await assertReject('counter decreaseは拒否', async () => {
    await recordOperation({ rateOverrides: { shortCount: 1, dailyCount: 1 } });
  });

  await assertReject('window start / updatedAtの偽装は拒否', async () => {
    const forged = Timestamp.fromDate(new Date('2000-01-01T00:00:00.000Z'));
    await recordOperation({ rateOverrides: {
      shortWindowStartedAt: forged,
      dailyWindowStartedAt: forged,
      updatedAt: forged,
    } });
  });

  await assertReject('rate-limit update単体では許可されない', async () => {
    const rateRef = doc(db, 'rateLimits', user.uid);
    const rate = (await getDoc(rateRef)).data();
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(rateRef);
      transaction.update(rateRef, makeRateUpdate(snap.data(), rate.lastOperationBillId, rate.lastOperationSightingId));
    });
  });

  const otherUid = 'different-anonymous-uid';
  const otherRateBody = {
    fields: {
      shortWindowStartedAt: { timestampValue: new Date().toISOString() },
      shortCount: { integerValue: '1' },
      dailyWindowStartedAt: { timestampValue: new Date().toISOString() },
      dailyCount: { integerValue: '1' },
      updatedAt: { timestampValue: new Date().toISOString() },
      lastOperationBillId: { stringValue: 'RL000001A' },
      lastOperationSightingId: { stringValue: 'seeded-sighting' },
    },
  };
  const otherRateUrl = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/rateLimits/${otherUid}`;
  const otherRateResponse = await fetch(otherRateUrl, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify(otherRateBody),
  });
  if (!otherRateResponse.ok) throw new Error(`Could not seed other UID rate doc: ${otherRateResponse.status}`);
  await assertReject('他UIDのrateLimits更新拒否', async () => {
    await updateDoc(doc(db, 'rateLimits', otherUid), { shortCount: 2 });
  });

  await assertReject('rateLimits delete拒否', async () => {
    await deleteDoc(doc(db, 'rateLimits', user.uid));
  });

  // Exercise the actual Rule boundary at ten writes in an active ten-minute window.
  await setRateFixture(user.uid, { shortCount: 1, dailyCount: 1 });
  for (let i = 0; i < 9; i++) await recordOperation();
  await assertPass('10分以内の10回目まで成功', async () => {
    const rate = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (rate.shortCount !== 10) throw new Error(`expected shortCount=10, got ${rate.shortCount}`);
  });
  const shortRejectedBillId = nextSerial();
  await assertReject('10分以内11回目拒否', async () => {
    await recordOperation({ billId: shortRejectedBillId, rateOverrides: { shortCount: 11 } });
  });
  await assertPass('拒否された11回目はpublic docもcountも変更しない', async () => {
    const rate = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (rate.shortCount !== 10 || (await getDoc(doc(db, 'bills', shortRejectedBillId))).exists()) {
      throw new Error('rejected operation was partially committed');
    }
  });

  await setRateFixture(user.uid, {
    shortWindowStartedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    shortCount: 10,
    dailyCount: 10,
  });
  await assertPass('10分経過後short windowをcount=1へreset', async () => {
    await recordOperation();
    const rate = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (rate.shortCount !== 1) throw new Error(`expected shortCount=1, got ${rate.shortCount}`);
  });

  // Owner-only emulator fixture time-travel keeps the daily test inside one controlled window.
  for (let count = 12; count <= 50; count++) {
    const currentRate = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    await setRateFixture(user.uid, {
      shortWindowStartedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      shortCount: 10,
      dailyWindowStartedAt: currentRate.dailyWindowStartedAt.toDate().toISOString(),
      dailyCount: currentRate.dailyCount,
    });
    await recordOperation();
  }
  await assertPass('24時間以内50回目まで成功', async () => {
    const rate = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (rate.dailyCount !== 50) throw new Error(`expected dailyCount=50, got ${rate.dailyCount}`);
  });
  const dailyRejectedBillId = nextSerial();
  await assertReject('24時間以内51回目拒否', async () => {
    await recordOperation({ billId: dailyRejectedBillId, rateOverrides: { dailyCount: 51 } });
  });
  await assertPass('拒否された51回目はpublic docもcountも変更しない', async () => {
    const rate = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (rate.dailyCount !== 50 || (await getDoc(doc(db, 'bills', dailyRejectedBillId))).exists()) {
      throw new Error('rejected operation was partially committed');
    }
  });

  await setRateFixture(user.uid, {
    shortCount: 1,
    dailyWindowStartedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    dailyCount: 50,
  });
  await assertPass('24時間経過後daily windowをcount=1へreset', async () => {
    await recordOperation();
    const rate = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (rate.dailyCount !== 1) throw new Error(`expected dailyCount=1, got ${rate.dailyCount}`);
  });

  const rediscoveryBill = nextSerial();
  await recordOperation({ billId: rediscoveryBill });
  await setBillCooldown(rediscoveryBill, '2000-01-01T00:00:00.000Z');
  await assertPass('再発見transactionもbill+sightingでcountを1だけ増やす', async () => {
    const before = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    await recordOperation({ billId: rediscoveryBill });
    const after = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (after.shortCount !== before.shortCount + 1 || after.dailyCount !== before.dailyCount + 1) {
      throw new Error('rediscovery did not increment each counter exactly once');
    }
  });

  console.log(`\n=== Strict Rules: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Strict Rules test runner failed:', error);
  process.exit(1);
});
