import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore,
  orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';

const projectId = 'demo-osatsu-public-serial';
const app = initializeApp({ projectId, apiKey: 'fake-api-key' }, 'public-serial-test');
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
const app2 = initializeApp({ projectId, apiKey: 'fake-api-key' }, 'public-serial-other-user');
const auth2 = getAuth(app2);
connectAuthEmulator(auth2, 'http://127.0.0.1:9099', { disableWarnings: true });
const db2 = getFirestore(app2);
connectFirestoreEmulator(db2, '127.0.0.1', 8080);
const app4 = initializeApp({ projectId, apiKey: 'fake-api-key' }, 'public-serial-attacker');
const auth4 = getAuth(app4);
connectAuthEmulator(auth4, 'http://127.0.0.1:9099', { disableWarnings: true });
const db4 = getFirestore(app4);
connectFirestoreEmulator(db4, '127.0.0.1', 8080);
const app3 = initializeApp({ projectId, apiKey: 'fake-api-key' }, 'public-serial-unauthenticated');
const unauthDb = getFirestore(app3);
connectFirestoreEmulator(unauthDb, '127.0.0.1', 8080);

let passed = 0;
let failed = 0;
let sequence = 1;
const opaque = () => crypto.randomUUID();
const serial = () => `RL${String(sequence++).padStart(6, '0')}A`;
const stamp = () => new Date().toISOString();

async function check(name, fn, reject = false) {
  try {
    await fn();
    if (reject) throw new Error('expected rejection');
    console.log(`  ✔ ${name}`); passed++;
  } catch (error) {
    if (reject && error.message !== 'expected rejection') { console.log(`  ✔ ${name} (denied)`); passed++; }
    else { console.error(`  ✘ ${name}: ${error.message}`); failed++; }
  }
}

function nextRate(rate, publicBillId, sightingId) {
  const now = Date.now();
  const shortExpired = !rate || now - rate.shortWindowStartedAt.toMillis() >= 10 * 60_000;
  const dailyExpired = !rate || now - rate.dailyWindowStartedAt.toMillis() >= 24 * 60 * 60_000;
  return {
    shortWindowStartedAt: shortExpired ? serverTimestamp() : rate.shortWindowStartedAt,
    shortCount: shortExpired ? 1 : rate.shortCount + 1,
    dailyWindowStartedAt: dailyExpired ? serverTimestamp() : rate.dailyWindowStartedAt,
    dailyCount: dailyExpired ? 1 : rate.dailyCount + 1,
    updatedAt: serverTimestamp(), lastOperationPublicBillId: publicBillId,
    lastOperationSightingId: sightingId,
  };
}

async function writeOperation(expected = serial(), overrides = {}, { firestore = db, userAuth = auth } = {}) {
  const uid = userAuth.currentUser.uid;
  const indexRef = doc(firestore, 'serialIndex', expected);
  const rateRef = doc(firestore, 'rateLimits', uid);
  const sightingRef = doc(collection(firestore, 'sightings'));
  const proposedId = opaque();
  const now = stamp();
  return runTransaction(firestore, async (tx) => {
    const [indexSnap, rateSnap] = await Promise.all([tx.get(indexRef), tx.get(rateRef)]);
    const publicBillId = indexSnap.exists() ? indexSnap.data().publicBillId : proposedId;
    const billRef = doc(firestore, 'publicBills', publicBillId);
    const trackedRef = doc(firestore, 'users', uid, 'trackedBills', publicBillId);
    const billSnap = indexSnap.exists() ? await tx.get(billRef) : null;
    const trackedSnap = await tx.get(trackedRef);
    const step = billSnap?.exists() ? billSnap.data().sightingsCount + 1 : 1;
    const sighting = {
      id: sightingRef.id, publicBillId, step, prefecture: '東京都', municipality: '千代田区',
      createdAt: now, distanceFromPrevKm: 0, daysFromPrev: 0,
    };
    if (!billSnap?.exists()) {
      tx.set(indexRef, { publicBillId: overrides.index?.publicBillId ?? publicBillId, createdAt: serverTimestamp() });
      tx.set(billRef, {
        id: publicBillId, denomination: 1000, createdAt: now, updatedAt: now,
        sightingsCount: 1, totalDistanceKm: 0, firstSightedAt: now, lastSightedAt: now,
        lastSightedAtServer: serverTimestamp(), lastMunicipality: '千代田区', lastSightingId: sightingRef.id,
        ...overrides.publicBill,
      });
      tx.set(trackedRef, {
        publicBillId, serialNumber: expected, denomination: 1000, createdAt: serverTimestamp(),
        firstRegisteredByMe: true, notifyOnRediscovery: false, lastSeenSightingsCount: 1,
        lastSeenAt: serverTimestamp(), lastSeenMunicipality: '千代田区',
        ...overrides.tracked,
      });
    } else {
      const bill = billSnap.data();
      tx.update(billRef, {
        updatedAt: now, sightingsCount: step, totalDistanceKm: bill.totalDistanceKm,
        lastSightedAt: now, lastSightedAtServer: serverTimestamp(), lastMunicipality: '千代田区',
        lastSightingId: sightingRef.id, ...overrides.publicBill,
      });
      if (trackedSnap.exists()) {
        tx.update(trackedRef, {
          lastSeenSightingsCount: step, lastSeenAt: serverTimestamp(), lastSeenMunicipality: '千代田区',
          ...overrides.tracked,
        });
      } else {
        tx.set(trackedRef, {
          publicBillId, serialNumber: expected, denomination: billSnap.data().denomination,
          createdAt: serverTimestamp(), firstRegisteredByMe: false, notifyOnRediscovery: false,
          lastSeenSightingsCount: step, lastSeenAt: serverTimestamp(), lastSeenMunicipality: '千代田区',
          ...overrides.tracked,
        });
      }
    }
    tx.set(sightingRef, { ...sighting, ...overrides.sighting });
    const rate = rateSnap.exists() ? rateSnap.data() : null;
    if (!overrides.skipRate) tx.set(rateRef, { ...nextRate(rate, publicBillId, sightingRef.id), ...overrides.rate });
    return { publicBillId, sightingId: sightingRef.id, serial: expected };
  });
}

async function writeByPublicIdOnly(publicBillId, firestore = db, userAuth = auth) {
  const uid = userAuth.currentUser.uid;
  const billRef = doc(firestore, 'publicBills', publicBillId);
  const rateRef = doc(firestore, 'rateLimits', uid);
  const sightingRef = doc(collection(firestore, 'sightings'));
  const now = stamp();
  await runTransaction(firestore, async (tx) => {
    const [billSnap, rateSnap] = await Promise.all([tx.get(billRef), tx.get(rateRef)]);
    const bill = billSnap.data();
    const step = bill.sightingsCount + 1;
    tx.update(billRef, {
      updatedAt: now, sightingsCount: step, totalDistanceKm: bill.totalDistanceKm,
      lastSightedAt: now, lastSightedAtServer: serverTimestamp(),
      lastMunicipality: '横浜市', lastSightingId: sightingRef.id,
    });
    tx.set(sightingRef, {
      id: sightingRef.id, publicBillId, step, prefecture: '神奈川県', municipality: '横浜市',
      createdAt: now, distanceFromPrevKm: 0, daysFromPrev: 0,
    });
    tx.set(rateRef, nextRate(rateSnap.data(), publicBillId, sightingRef.id));
  });
}

async function adminPatch(path, fields) {
  const values = Object.entries(fields).map(([key, value]) => {
    const encoded = value instanceof Date ? { timestampValue: value.toISOString() }
      : typeof value === 'number' ? { integerValue: String(value) }
      : { stringValue: value };
    return `${key}=${encodeURIComponent(JSON.stringify(encoded))}`;
  }).join('&');
  const qs = values.replaceAll('%3D', '=').replaceAll('%26', '&').replaceAll('%3A', ':').replaceAll('%22', '"');
  const response = await fetch(`http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/${path}?${Object.keys(fields).map((key) => `updateMask.fieldPaths=${key}`).join('&')}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
      value instanceof Date ? { timestampValue: value.toISOString() } : typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value },
    ])) }),
  });
  if (!response.ok) throw new Error(`admin fixture update failed: ${response.status} ${await response.text()} ${qs}`);
}

async function seedLegacySighting() {
  const response = await fetch(`http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/sightings?documentId=legacy-serial-leak`, {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      id: { stringValue: 'legacy-serial-leak' }, billId: { stringValue: 'AA123456B' }, step: { integerValue: '1' },
      prefecture: { stringValue: '東京都' }, municipality: { stringValue: '千代田区' },
      latitudeApprox: { doubleValue: 35.69 }, longitudeApprox: { doubleValue: 139.75 },
      createdAt: { stringValue: stamp() }, distanceFromPrevKm: { integerValue: '0' }, daysFromPrev: { integerValue: '0' },
    } }),
  });
  if (!response.ok) throw new Error(`could not seed pre-reset sighting: ${response.status}`);
}

async function main() {
  const user = (await signInAnonymously(auth)).user;
  await signInAnonymously(auth2);
  await signInAnonymously(auth4);
  console.log('=== Opaque public serial schema Rules tests ===');

  const initial = await writeOperation();
  await seedLegacySighting();
  await check('初回登録 transaction: index/publicBill/sighting/tracked/rateLimit が同時作成', async () => {
    const [i, b, s, t, r] = await Promise.all([
      getDoc(doc(db, 'serialIndex', initial.serial)), getDoc(doc(db, 'publicBills', initial.publicBillId)),
      getDoc(doc(db, 'sightings', initial.sightingId)), getDoc(doc(db, 'users', user.uid, 'trackedBills', initial.publicBillId)),
      getDoc(doc(db, 'rateLimits', user.uid)),
    ]);
    if (![i, b, s, t, r].every((snap) => snap.exists())) throw new Error('missing transaction document');
    if (b.data().serialNumber || b.data().normalizedSerial || s.data().billId || s.data().latitudeApprox) throw new Error('public serial/legacy field present');
    if (r.data().shortCount !== 1 || r.data().dailyCount !== 1) throw new Error('registration counted more than once');
  });
  for (const acceptedSerial of ['A123456B', 'AA123456B', 'AA123456BB', 'CD777777EF', 'AA000001AA', 'AA900000BB']) {
    await check(`Rules: official serial ${acceptedSerial} accepted`, async () => writeOperation(acceptedSerial));
  }
  for (const rejectedSerial of [
    'A123456BB', 'A000000B', 'AA000000BB', 'AA900001BB', 'AI123456BB',
    'AO123456BB', 'AA123456BI', 'AA123456BO', '123456', 'AA123456',
  ]) {
    await check(`Rules: invalid serial ${rejectedSerial} rejected`, async () => writeOperation(rejectedSerial), true);
  }
  await check('serialIndex exact get許可', async () => { if (!(await getDoc(doc(db, 'serialIndex', initial.serial))).exists()) throw new Error('not found'); });
  await check('serialIndex collection list拒否', async () => getDocs(collection(db, 'serialIndex')), true);
  await check('serialIndex query拒否', async () => getDocs(query(collection(db, 'serialIndex'), where('publicBillId', '==', initial.publicBillId))), true);
  await check('serialIndex arbitrary update拒否', async () => updateDoc(doc(db, 'serialIndex', initial.serial), { publicBillId: opaque() }), true);
  await check('不正serialのserialIndex作成拒否', async () => writeOperation('INVALID'), true);
  await check('serialIndexとpublicBillの対応不整合拒否', async () => writeOperation(serial(), { index: { publicBillId: opaque() } }), true);
  await check('publicBills get/list許可', async () => {
    if (!(await getDoc(doc(db, 'publicBills', initial.publicBillId))).exists()) throw new Error('get failed');
    await getDocs(query(collection(db, 'publicBills'), orderBy('updatedAt')));
  });
  await check('publicBillIdでのsighting query許可', async () => {
    const sightings = await getDocs(query(collection(db, 'sightings'), where('publicBillId', '==', initial.publicBillId)));
    if (sightings.empty) throw new Error('public sightings query returned nothing');
  });
  await check('旧serial billIdを持つsightingのget拒否', async () => getDoc(doc(db, 'sightings', 'legacy-serial-leak')), true);
  await check('旧sighting混在時のcollection全件list拒否', async () => getDocs(collection(db, 'sightings')), true);
  await check('public bill serialNumber field create拒否', async () => writeOperation(serial(), { publicBill: { serialNumber: 'AA123456B' } }), true);
  await check('public bill normalizedSerial field create拒否', async () => writeOperation(serial(), { publicBill: { normalizedSerial: 'AA123456B' } }), true);
  await check('登録に必要なrateLimit更新がない場合は拒否', async () => writeOperation(serial(), { skipRate: true }), true);
  await check('sighting complete serial/billId field write拒否', async () => writeOperation(serial(), { sighting: { billId: 'AA123456B' } }), true);
  await check('公開userNoteへ完全記番号を含める書き込み拒否', async () => writeOperation(serial(), { sighting: { userNote: '番号はAA123456Bでした' } }), true);
  await check('sighting precise coordinate fields write拒否', async () => writeOperation(serial(), { sighting: { latitudeApprox: 35.6, longitudeApprox: 139.7 } }), true);
  await check('owner trackedBills read許可', async () => getDocs(collection(db, 'users', user.uid, 'trackedBills')));
  await check('other UID trackedBills read拒否', async () => getDocs(collection(db2, 'users', user.uid, 'trackedBills')), true);
  await check('other UID trackedBills write拒否', async () => updateDoc(doc(db2, 'users', user.uid, 'trackedBills', initial.publicBillId), { notifyOnRediscovery: true }), true);
  await check('rateLimits delete拒否', async () => deleteDoc(doc(db, 'rateLimits', user.uid)), true);
  await check('未認証public write拒否', async () => setDoc(doc(unauthDb, 'publicBills', opaque()), { denomination: 1000 }), true);
  await check('別UIDからpublicBill write拒否', async () => updateDoc(doc(db2, 'publicBills', initial.publicBillId), { sightingsCount: 90 }), true);

  await check('同一紙幣15分未満の再発見拒否', async () => writeOperation(initial.serial), true);
  await adminPatch(`publicBills/${initial.publicBillId}`, { lastSightedAtServer: new Date('2000-01-01T00:00:00Z') });
  await check('15分経過済み紙幣の再発見成功、rateは1操作で+1', async () => {
    const before = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    await writeOperation(initial.serial);
    const after = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (after.shortCount !== before.shortCount + 1 || after.dailyCount !== before.dailyCount + 1) throw new Error('counter mismatch');
  });
  await adminPatch(`publicBills/${initial.publicBillId}`, { lastSightedAtServer: new Date('2000-01-01T00:00:00Z') });
  await check('正しいserialでtrackedBillを同時createして再発見できる（別UID）', async () => {
    const op = await writeOperation(initial.serial, {}, { firestore: db2, userAuth: auth2 });
    const proof = await getDoc(doc(db2, 'users', auth2.currentUser.uid, 'trackedBills', initial.publicBillId));
    if (!proof.exists() || proof.data().serialNumber !== initial.serial || proof.data().firstRegisteredByMe !== false) {
      throw new Error('rediscovery proof record was not created correctly');
    }
    if (op.publicBillId !== initial.publicBillId) throw new Error('serial resolved to another public bill');
  });
  await check('存在しないserialをtrackedBillへ同時作成する再発見は拒否', async () =>
    writeOperation(serial(), { tracked: { serialNumber: 'ZZ999999Z' } }), true);
  await check('別紙幣に対応するserialをtrackedBillへ設定する作成は拒否', async () =>
    writeOperation(serial(), { tracked: { serialNumber: initial.serial } }), true);
  const other = await writeOperation();
  await adminPatch(`publicBills/${initial.publicBillId}`, { lastSightedAtServer: new Date('2000-01-01T00:00:00Z') });
  await adminPatch(`users/${user.uid}/trackedBills/${initial.publicBillId}`, { serialNumber: other.serial });
  await check('事前trackedBillがserialIndexとの対応不一致なら再発見拒否', async () => writeOperation(initial.serial), true);
  await adminPatch(`users/${user.uid}/trackedBills/${initial.publicBillId}`, { serialNumber: initial.serial });
  await adminPatch(`publicBills/${initial.publicBillId}`, { lastSightedAtServer: new Date('2000-01-01T00:00:00Z') });
  await adminPatch(`publicBills/${initial.publicBillId}`, { lastSightedAtServer: new Date('2000-01-01T00:00:00Z') });
  await check('publicBillIdだけの直接transactionはserial proofがなく拒否', async () => {
    await writeByPublicIdOnly(initial.publicBillId, db4, auth4);
  }, true);
  await adminPatch(`publicBills/${initial.publicBillId}`, { lastSightedAtServer: new Date('2000-01-01T00:00:00Z') });
  await check('arbitrary sightingsCount/lastSightedAt update拒否', async () => writeOperation(initial.serial, { publicBill: { sightingsCount: 90, lastSightedAt: '2000-01-01T00:00:00.000Z' } }), true);

  await adminPatch(`rateLimits/${user.uid}`, {
    shortWindowStartedAt: new Date(), shortCount: 2,
    dailyWindowStartedAt: new Date(), dailyCount: 2,
  });
  for (let index = 0; index < 8; index++) await writeOperation();
  await check('10分内10回目まで許可', async () => {
    if ((await getDoc(doc(db, 'rateLimits', user.uid))).data().shortCount !== 10) throw new Error('expected 10');
  });
  await check('10分内11回目拒否', async () => writeOperation(), true);
  await adminPatch(`rateLimits/${user.uid}`, { shortWindowStartedAt: new Date(Date.now() - 11 * 60_000), shortCount: 10 });
  await check('10分経過後countリセット', async () => {
    await writeOperation();
    if ((await getDoc(doc(db, 'rateLimits', user.uid))).data().shortCount !== 1) throw new Error('not reset');
  });
  for (let index = 0; index < 40; index++) {
    const current = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    await adminPatch(`rateLimits/${user.uid}`, { shortWindowStartedAt: new Date(Date.now() - 11 * 60_000), shortCount: 10 });
    if (current.dailyCount < 50) await writeOperation();
  }
  await check('24時間内50回上限後は拒否', async () => writeOperation(), true);
  await check('count飛ばし増加拒否', async () => writeOperation(serial(), { rate: { shortCount: 9 } }), true);
  await check('count減少拒否', async () => writeOperation(serial(), { rate: { shortCount: 1 } }), true);
  await check('updatedAt偽装拒否', async () => writeOperation(serial(), { rate: { updatedAt: new Date('2000-01-01T00:00:00Z') } }), true);
  await adminPatch(`rateLimits/${user.uid}`, {
    shortWindowStartedAt: new Date(Date.now() - 11 * 60_000), shortCount: 10,
    dailyWindowStartedAt: new Date(Date.now() - 25 * 60 * 60_000), dailyCount: 50,
  });
  await check('24時間経過後daily windowをcount=1へreset', async () => {
    await writeOperation();
    const rate = (await getDoc(doc(db, 'rateLimits', user.uid))).data();
    if (rate.dailyCount !== 1 || rate.shortCount !== 1) throw new Error('window counters were not reset');
  });
  console.log(`=== Opaque schema Rules: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
