import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  collection,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  Timestamp,
  deleteDoc,
  updateDoc,
  setDoc,
} from 'firebase/firestore';
import { getOrCreateAnonymousUser } from '../src/services/anonymousSession.js';

const app = initializeApp({
  projectId: 'demo-george-rules-test',
  apiKey: 'fake-api-key',
});

const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

const authApp = initializeApp({
  projectId: 'demo-george-rules-test',
  apiKey: 'fake-api-key',
}, 'anonymous-auth-test');
const auth = getAuth(authApp);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const authenticatedDb = getFirestore(authApp);
connectFirestoreEmulator(authenticatedDb, '127.0.0.1', 8080);

let passedCount = 0;
let failedCount = 0;

async function assertPass(name, fn) {
  try {
    await fn();
    console.log(`  ✔ [PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL - Expected PASS, but got ERROR] ${name}:`, err.message || err);
    failedCount++;
  }
}

async function assertReject(name, fn) {
  try {
    await fn();
    console.error(`  ❌ [FAIL - Expected REJECT, but PASSED] ${name}`);
    failedCount++;
  } catch (err) {
    console.log(`  ✔ [PASS] ${name} (Rejected with: ${err.code || err.message})`);
    passedCount++;
  }
}

async function setTrustedClockForTest(billId, isoTime) {
  const url = `http://127.0.0.1:8080/v1/projects/demo-george-rules-test/databases/(default)/documents/bills/${billId}?updateMask.fieldPaths=lastSightedAtServer`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { lastSightedAtServer: { timestampValue: isoTime } } }),
  });
  if (!response.ok) throw new Error(`Emulator fixture clock update failed: ${response.status} ${await response.text()}`);
}

async function seedLegacyBillForTest(billId, isoTime) {
  const url = `http://127.0.0.1:8080/v1/projects/demo-george-rules-test/databases/(default)/documents/bills?documentId=${billId}`;
  const fields = {
    id: { stringValue: billId },
    serialNumber: { stringValue: billId },
    denomination: { integerValue: '1000' },
    createdAt: { stringValue: isoTime },
    updatedAt: { stringValue: isoTime },
    sightingsCount: { integerValue: '1' },
    totalDistanceKm: { integerValue: '0' },
    firstSightedAt: { stringValue: isoTime },
    lastSightedAt: { stringValue: isoTime },
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error(`Legacy fixture create failed: ${response.status} ${await response.text()}`);
}

async function runTests() {
  console.log('=== Firestore Security Rules 網羅テスト開始 ===\n');

  const anonymousUser = await getOrCreateAnonymousUser(auth, signInAnonymously);
  await assertPass('anonymous userを作成し、同じAuth sessionを再利用する', async () => {
    const reused = await getOrCreateAnonymousUser(auth, async () => {
      throw new Error('persisted anonymous user should be reused');
    });
    if (!anonymousUser.isAnonymous || reused.uid !== anonymousUser.uid) {
      throw new Error('anonymous user was not reused');
    }
  });

  const nowIso = new Date().toISOString();
  const testBillId = 'AB123456C';
  const billRef = doc(db, 'bills', testBillId);
  const sightRef1 = doc(collection(db, 'sightings'));

  await assertPass('未認証でも公開billをreadできる（Auth失敗時も公開閲覧可能）', async () => {
    await getDoc(billRef);
  });

  const trackedRef = doc(authenticatedDb, 'users', anonymousUser.uid, 'trackedBills', testBillId);
  await assertReject('他人のtrackedBillsをreadできない', async () => {
    await getDoc(doc(authenticatedDb, 'users', 'another-user', 'trackedBills', testBillId));
  });
  await assertReject('他人のtrackedBillsを書き換えできない', async () => {
    await setDoc(doc(authenticatedDb, 'users', 'another-user', 'trackedBills', testBillId), {
      billId: testBillId,
      createdAt: serverTimestamp(),
      firstRegisteredByMe: true,
      notifyOnRediscovery: false,
    });
  });

  // 1. 正常な新規登録トランザクション (新規bill + 第1足跡sighting)
  await assertPass('正常な新規登録トランザクション (bill + sighting step:1)', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(billRef, {
        id: testBillId,
        serialNumber: testBillId,
        denomination: 1000,
        createdAt: nowIso,
        updatedAt: nowIso,
        sightingsCount: 1,
        totalDistanceKm: 0,
        firstSightedAt: nowIso,
        lastSightedAt: nowIso,
        lastSightedAtServer: serverTimestamp(),
      });

      txn.set(sightRef1, {
        id: sightRef1.id,
        billId: testBillId,
        step: 1,
        prefecture: '東京都',
        municipality: '新宿区',
        latitudeApprox: 35.6938,
        longitudeApprox: 139.7034,
        createdAt: nowIso,
        distanceFromPrevKm: 0,
        daysFromPrev: 0,
        userNote: 'テスト登録',
      });
    });
  });

  await assertPass('自分のtrackedBillsを作成・read・更新でき（public billは変化しない）', async () => {
    const publicBefore = (await getDoc(billRef)).data();
    await setDoc(trackedRef, {
      billId: testBillId,
      createdAt: serverTimestamp(),
      firstRegisteredByMe: true,
      notifyOnRediscovery: false,
    });
    if (!(await getDoc(trackedRef)).exists()) throw new Error('own private tracked bill was not readable');
    await updateDoc(trackedRef, { notifyOnRediscovery: true });
    const publicAfter = (await getDoc(billRef)).data();
    if (JSON.stringify(publicBefore) !== JSON.stringify(publicAfter)) {
      throw new Error('private tracking changed public bill data');
    }
    if ('ownerUid' in publicAfter || 'email' in publicAfter || 'fcmToken' in publicAfter) {
      throw new Error('private identity data leaked to public bill');
    }
  });

  const oldClientBillId = 'GH123456A';
  const oldClientBillRef = doc(db, 'bills', oldClientBillId);
  const oldClientSighting1 = doc(collection(db, 'sightings'));
  await assertPass('旧client形式の新規登録 (server clockなし)', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(oldClientBillRef, {
        id: oldClientBillId, serialNumber: oldClientBillId, denomination: 1000,
        createdAt: nowIso, updatedAt: nowIso, sightingsCount: 1,
        totalDistanceKm: 0, firstSightedAt: nowIso, lastSightedAt: nowIso,
      });
      txn.set(oldClientSighting1, {
        id: oldClientSighting1.id, billId: oldClientBillId, step: 1,
        prefecture: '北海道', municipality: '札幌市', latitudeApprox: 43.0618,
        longitudeApprox: 141.3545, createdAt: nowIso, distanceFromPrevKm: 0, daysFromPrev: 0,
      });
    });
  });

  const oldClientSighting2 = doc(collection(db, 'sightings'));
  await assertPass('旧client形式の再発見 (server clockなし)', async () => {
    await runTransaction(db, async (txn) => {
      txn.update(oldClientBillRef, {
        updatedAt: new Date().toISOString(), sightingsCount: 2,
        totalDistanceKm: 0, lastSightedAt: new Date().toISOString(),
      });
      txn.set(oldClientSighting2, {
        id: oldClientSighting2.id, billId: oldClientBillId, step: 2,
        prefecture: '東京都', municipality: '新宿区', latitudeApprox: 35.6938,
        longitudeApprox: 139.7034, createdAt: new Date().toISOString(),
        distanceFromPrevKm: 0, daysFromPrev: 0,
      });
    });
  });

  const oldClientOnNewBillId = 'JK123456A';
  const oldClientOnNewBillRef = doc(db, 'bills', oldClientOnNewBillId);
  const newBillSeedSighting = doc(collection(db, 'sightings'));
  await assertPass('新client形式の新規登録', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(oldClientOnNewBillRef, {
        id: oldClientOnNewBillId, serialNumber: oldClientOnNewBillId, denomination: 1000,
        createdAt: nowIso, updatedAt: nowIso, sightingsCount: 1,
        totalDistanceKm: 0, firstSightedAt: nowIso, lastSightedAt: nowIso,
        lastSightedAtServer: serverTimestamp(),
      });
      txn.set(newBillSeedSighting, {
        id: newBillSeedSighting.id, billId: oldClientOnNewBillId, step: 1,
        prefecture: '東京都', municipality: '千代田区', latitudeApprox: 35.6938,
        longitudeApprox: 139.7532, createdAt: nowIso, distanceFromPrevKm: 0, daysFromPrev: 0,
      });
    });
  });
  const oldClientOnNewBillSighting = doc(collection(db, 'sightings'));
  await assertPass('旧clientは移行済みbillの時計を保持したまま再発見できる', async () => {
    await runTransaction(db, async (txn) => {
      txn.update(oldClientOnNewBillRef, {
        updatedAt: new Date().toISOString(), sightingsCount: 2,
        totalDistanceKm: 0, lastSightedAt: new Date().toISOString(),
      });
      txn.set(oldClientOnNewBillSighting, {
        id: oldClientOnNewBillSighting.id, billId: oldClientOnNewBillId, step: 2,
        prefecture: '東京都', municipality: '港区', latitudeApprox: 35.6581,
        longitudeApprox: 139.7516, createdAt: new Date().toISOString(),
        distanceFromPrevKm: 0, daysFromPrev: 0,
      });
    });
  });

  const otherBillId = 'CD654321A';
  const otherBillRef = doc(db, 'bills', otherBillId);
  const otherSightingRef = doc(collection(db, 'sightings'));
  await assertPass('別紙幣は15分以内でも初回登録できる', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(otherBillRef, {
        id: otherBillId, serialNumber: otherBillId, denomination: 1000,
        createdAt: nowIso, updatedAt: nowIso, sightingsCount: 1,
        totalDistanceKm: 0, firstSightedAt: nowIso, lastSightedAt: nowIso,
        lastSightedAtServer: serverTimestamp(),
      });
      txn.set(otherSightingRef, {
        id: otherSightingRef.id, billId: otherBillId, step: 1,
        prefecture: '東京都', municipality: '千代田区', latitudeApprox: 35.6938,
        longitudeApprox: 139.7532, createdAt: nowIso, distanceFromPrevKm: 0, daysFromPrev: 0,
      });
    });
  });

  const legacyBillId = 'EF123456A';
  const legacyBillRef = doc(db, 'bills', legacyBillId);
  await seedLegacyBillForTest(legacyBillId, nowIso);
  await assertPass('既存legacy billはサーバー時刻を初期化できる', async () => {
    await runTransaction(db, async (txn) => {
      const snap = await txn.get(legacyBillRef);
      if (!snap.exists()) throw new Error('Legacy bill fixture missing');
      txn.update(legacyBillRef, { lastSightedAtServer: serverTimestamp() });
    });
  });
  await assertReject('legacy bill移行後の新client再発見は15分以内なら拒否', async () => {
    const migrationSight = doc(collection(db, 'sightings'));
    await runTransaction(db, async (txn) => {
      txn.update(legacyBillRef, {
        updatedAt: new Date().toISOString(), sightingsCount: 2,
        totalDistanceKm: 0, lastSightedAt: new Date().toISOString(),
        lastSightedAtServer: serverTimestamp(),
      });
      txn.set(migrationSight, {
        id: migrationSight.id, billId: legacyBillId, step: 2,
        prefecture: '東京都', municipality: '新宿区', latitudeApprox: 35.6938,
        longitudeApprox: 139.7034, createdAt: new Date().toISOString(),
        distanceFromPrevKm: 0, daysFromPrev: 0,
      });
    });
  });

  // 2. 正常な読み取り
  await assertPass('bills の公開読み取り', async () => {
    const snap = await getDoc(billRef);
    if (!snap.exists()) throw new Error('Not found');
  });

  await assertPass('sightings の公開読み取り', async () => {
    const snap = await getDocs(collection(db, 'sightings'));
    if (snap.empty) throw new Error('Empty sightings');
  });

  // 3. 正常な再発見トランザクション (bill更新 + 第2足跡sighting)
  const sightRef2 = doc(collection(db, 'sightings'));
  await assertReject('同一紙幣の15分以内再投稿拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.update(billRef, {
        updatedAt: new Date().toISOString(),
        sightingsCount: 2,
        totalDistanceKm: 350,
        lastSightedAt: new Date().toISOString(),
        lastSightedAtServer: serverTimestamp(),
      });
      txn.set(sightRef2, {
        id: sightRef2.id, billId: testBillId, step: 2,
        prefecture: '愛知県', municipality: '名古屋市', latitudeApprox: 35.1816,
        longitudeApprox: 136.9066, createdAt: new Date().toISOString(),
        distanceFromPrevKm: 350, daysFromPrev: 10,
      });
    });
  });

  await setTrustedClockForTest(testBillId, '2000-01-01T00:00:00.000Z');
  await assertPass('同一紙幣15分超の再投稿は許可', async () => {
    await runTransaction(db, async (txn) => {
      txn.update(billRef, {
        updatedAt: new Date().toISOString(),
        sightingsCount: 2,
        totalDistanceKm: 350,
        lastSightedAt: new Date().toISOString(),
        lastSightedAtServer: serverTimestamp(),
      });

      txn.set(sightRef2, {
        id: sightRef2.id,
        billId: testBillId,
        step: 2,
        prefecture: '愛知県',
        municipality: '名古屋市',
        latitudeApprox: 35.1815,
        longitudeApprox: 136.9066,
        createdAt: new Date().toISOString(),
        distanceFromPrevKm: 350,
        daysFromPrev: 10,
      });
    });
  });

  await assertReject('クライアントが過去の時刻を偽装してもクールダウンを回避できない', async () => {
    const forgedSight = doc(collection(db, 'sightings'));
    await runTransaction(db, async (txn) => {
      txn.update(billRef, {
        updatedAt: new Date().toISOString(), sightingsCount: 3,
        totalDistanceKm: 500, lastSightedAt: new Date().toISOString(),
        lastSightedAtServer: Timestamp.fromDate(new Date('2000-01-01T00:00:00.000Z')),
      });
      txn.set(forgedSight, {
        id: forgedSight.id, billId: testBillId, step: 3,
        prefecture: '東京都', municipality: '千代田区', latitudeApprox: 35.6938,
        longitudeApprox: 139.7532, createdAt: new Date().toISOString(),
        distanceFromPrevKm: 150, daysFromPrev: 1,
      });
    });
  });

  // 3-B. 5000円札の登録と再発見の額面整合性テスト
  const bill5000Id = 'AA555555A';
  const bill5000Ref = doc(db, 'bills', bill5000Id);
  const sight5000_1 = doc(collection(db, 'sightings'));

  await assertPass('5000円札の新規登録 (AA555555A)', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(bill5000Ref, {
        id: bill5000Id,
        serialNumber: bill5000Id,
        denomination: 5000,
        createdAt: nowIso,
        updatedAt: nowIso,
        sightingsCount: 1,
        totalDistanceKm: 0,
        firstSightedAt: nowIso,
        lastSightedAt: nowIso,
        lastSightedAtServer: serverTimestamp(),
      });

      txn.set(sight5000_1, {
        id: sight5000_1.id,
        billId: bill5000Id,
        step: 1,
        prefecture: '大阪府',
        municipality: '大阪市',
        latitudeApprox: 34.6937,
        longitudeApprox: 135.5023,
        createdAt: nowIso,
        distanceFromPrevKm: 0,
        daysFromPrev: 0,
      });
    });
  });

  // 3-C. 拒否: 5000円札として登録済みの記番号を1000円として再発見しようとすると拒否
  const badSight5000_2 = doc(collection(db, 'sightings'));
  await assertReject('5000円札として登録済みの記番号を1000円で再発見しようとすると拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.update(bill5000Ref, {
        denomination: 1000, // 意図的に額面を変更
        updatedAt: new Date().toISOString(),
        sightingsCount: 2,
        totalDistanceKm: 50,
        lastSightedAt: new Date().toISOString(),
      });

      txn.set(badSight5000_2, {
        id: badSight5000_2.id,
        billId: bill5000Id,
        step: 2,
        prefecture: '京都府',
        municipality: '京都市',
        latitudeApprox: 35.0116,
        longitudeApprox: 135.7681,
        createdAt: new Date().toISOString(),
        distanceFromPrevKm: 50,
        daysFromPrev: 2,
      });
    });
  });

  // 3-D. 成功: 正しい5000円（または denomination を更新せず維持）での再発見は成功
  const goodSight5000_2 = doc(collection(db, 'sightings'));
  await setTrustedClockForTest(bill5000Id, '2000-01-01T00:00:00.000Z');
  await assertPass('正しい5000円での再発見トランザクションは成功', async () => {
    await runTransaction(db, async (txn) => {
      txn.update(bill5000Ref, {
        updatedAt: new Date().toISOString(),
        sightingsCount: 2,
        totalDistanceKm: 50,
        lastSightedAt: new Date().toISOString(),
        lastSightedAtServer: serverTimestamp(),
      });

      txn.set(goodSight5000_2, {
        id: goodSight5000_2.id,
        billId: bill5000Id,
        step: 2,
        prefecture: '京都府',
        municipality: '京都市',
        latitudeApprox: 35.0116,
        longitudeApprox: 135.7681,
        createdAt: new Date().toISOString(),
        distanceFromPrevKm: 50,
        daysFromPrev: 2,
      });
    });
  });

  console.log('\n--- 拒否されるべき不正操作の検証 ---\n');

  // 4. 拒否: 不正な記番号形式
  const invalidSerialRef = doc(db, 'bills', 'INVALID_SERIAL');
  await assertReject('不正な記番号形式の作成拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(invalidSerialRef, {
        id: 'INVALID_SERIAL',
        serialNumber: 'INVALID_SERIAL',
        denomination: 1000,
        createdAt: nowIso,
        updatedAt: nowIso,
        sightingsCount: 1,
        totalDistanceKm: 0,
        firstSightedAt: nowIso,
        lastSightedAt: nowIso,
      });
    });
  });

  // 5. 拒否: 不正な額面 denomination = 12345
  const badDenomRef = doc(db, 'bills', 'ZZ112233Y');
  await assertReject('不正な額面 (12345) の作成拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(badDenomRef, {
        id: 'ZZ112233Y',
        serialNumber: 'ZZ112233Y',
        denomination: 12345,
        createdAt: nowIso,
        updatedAt: nowIso,
        sightingsCount: 1,
        totalDistanceKm: 0,
        firstSightedAt: nowIso,
        lastSightedAt: nowIso,
      });
    });
  });

  // 6. 拒否: 新規作成時に sightingsCount を改ざん (例: 5)
  const badSightingsCountRef = doc(db, 'bills', 'ZZ223344Y');
  await assertReject('新規作成時の sightingsCount 改ざん (5) の拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(badSightingsCountRef, {
        id: 'ZZ223344Y',
        serialNumber: 'ZZ223344Y',
        denomination: 1000,
        createdAt: nowIso,
        updatedAt: nowIso,
        sightingsCount: 5,
        totalDistanceKm: 0,
        firstSightedAt: nowIso,
        lastSightedAt: nowIso,
      });
    });
  });

  // 7. 拒否: 未知のフィールド追加
  const unknownFieldRef = doc(db, 'bills', 'ZZ334455Y');
  await assertReject('bills への未知フィールド追加の拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(unknownFieldRef, {
        id: 'ZZ334455Y',
        serialNumber: 'ZZ334455Y',
        denomination: 1000,
        createdAt: nowIso,
        updatedAt: nowIso,
        sightingsCount: 1,
        totalDistanceKm: 0,
        firstSightedAt: nowIso,
        lastSightedAt: nowIso,
        unknownFieldHacked: true,
      });
    });
  });

  await assertReject('新client形式のbillへの未知フィールド追加の拒否', async () => {
    const newUnknownFieldRef = doc(db, 'bills', 'LM334455A');
    await runTransaction(db, async (txn) => {
      txn.set(newUnknownFieldRef, {
        id: 'LM334455A', serialNumber: 'LM334455A', denomination: 1000,
        createdAt: nowIso, updatedAt: nowIso, sightingsCount: 1,
        totalDistanceKm: 0, firstSightedAt: nowIso, lastSightedAt: nowIso,
        lastSightedAtServer: serverTimestamp(), unknownFieldHacked: true,
      });
    });
  });

  await assertReject('新client形式でもimmutable fieldのserialNumber改ざんを拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.update(oldClientOnNewBillRef, {
        serialNumber: 'HA111111H',
        updatedAt: new Date().toISOString(),
        sightingsCount: 3,
        totalDistanceKm: 0,
        lastSightedAt: new Date().toISOString(),
        lastSightedAtServer: serverTimestamp(),
      });
    });
  });

  // 8. 拒否: bill の削除
  await assertReject('bill の削除拒否', async () => {
    await deleteDoc(billRef);
  });

  // 9. 拒否: bill の serialNumber 変更
  await assertReject('bill の serialNumber 変更拒否', async () => {
    await updateDoc(billRef, {
      serialNumber: 'HA111111H',
    });
  });

  // 10. 拒否: bill の denomination 変更
  await assertReject('bill の denomination 変更拒否', async () => {
    await updateDoc(billRef, {
      denomination: 10000,
    });
  });

  // 11. 拒否: bill の sightingsCount を任意の値へジャンプ (現在2 → +10で12)
  await assertReject('bill の sightingsCount 任意値への改ざん拒否', async () => {
    await updateDoc(billRef, {
      sightingsCount: 12,
    });
  });

  // 12. 拒否: bill の totalDistanceKm の減少 (現在350 → 100)
  await assertReject('bill の totalDistanceKm 減少の拒否', async () => {
    await updateDoc(billRef, {
      totalDistanceKm: 100,
    });
  });

  // 13. 拒否: sighting の更新
  await assertReject('sighting の更新拒否', async () => {
    await updateDoc(sightRef1, {
      municipality: '改ざんされた市',
    });
  });

  // 14. 拒否: sighting の削除
  await assertReject('sighting の削除拒否', async () => {
    await deleteDoc(sightRef1);
  });

  // 15. 拒否: sighting の負の移動距離
  const badSightDistRef = doc(collection(db, 'sightings'));
  await assertReject('sighting の負の移動距離 (-50) の拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(badSightDistRef, {
        id: badSightDistRef.id,
        billId: testBillId,
        step: 3,
        prefecture: '東京都',
        municipality: '千代田区',
        latitudeApprox: 35.6938,
        longitudeApprox: 139.7034,
        createdAt: nowIso,
        distanceFromPrevKm: -50,
        daysFromPrev: 1,
      });
    });
  });

  // 16. 拒否: sighting の不正な緯度経度 (lat: 100, lng: 200)
  const badCoordsRef = doc(collection(db, 'sightings'));
  await assertReject('sighting の不正な緯度経度 (lat: 100) の拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(badCoordsRef, {
        id: badCoordsRef.id,
        billId: testBillId,
        step: 3,
        prefecture: '東京都',
        municipality: '千代田区',
        latitudeApprox: 100.0,
        longitudeApprox: 200.0,
        createdAt: nowIso,
        distanceFromPrevKm: 10,
        daysFromPrev: 1,
      });
    });
  });

  // 17. 拒否: sighting の userNote 極端に長い文字列 (> 100文字)
  const longNoteRef = doc(collection(db, 'sightings'));
  await assertReject('sighting の極端に長い userNote (>100文字) の拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(longNoteRef, {
        id: longNoteRef.id,
        billId: testBillId,
        step: 3,
        prefecture: '東京都',
        municipality: '千代田区',
        latitudeApprox: 35.6938,
        longitudeApprox: 139.7034,
        createdAt: nowIso,
        distanceFromPrevKm: 10,
        daysFromPrev: 1,
        userNote: 'あ'.repeat(101),
      });
    });
  });

  // 18. 拒否: sighting への未知のフィールド追加
  const unkSightingRef = doc(collection(db, 'sightings'));
  await assertReject('sightings への未知フィールド追加の拒否', async () => {
    await runTransaction(db, async (txn) => {
      txn.set(unkSightingRef, {
        id: unkSightingRef.id,
        billId: testBillId,
        step: 3,
        prefecture: '東京都',
        municipality: '千代田区',
        latitudeApprox: 35.6938,
        longitudeApprox: 139.7034,
        createdAt: nowIso,
        distanceFromPrevKm: 10,
        daysFromPrev: 1,
        injectedMaliciousField: 'exploit',
      });
    });
  });

  console.log(`\n=== テスト結果サマリー ===`);
  console.log(`全 ${passedCount + failedCount} テスト中: 成功 ${passedCount}件, 失敗 ${failedCount}件`);

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((e) => {
  console.error('Test run failed:', e);
  process.exit(1);
});
