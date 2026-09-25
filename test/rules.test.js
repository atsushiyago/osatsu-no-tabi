import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  collection,
  getDoc,
  getDocs,
  runTransaction,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';

const app = initializeApp({
  projectId: 'demo-george-rules-test',
  apiKey: 'fake-api-key',
});

const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

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

async function runTests() {
  console.log('=== Firestore Security Rules 網羅テスト開始 ===\n');

  const nowIso = new Date().toISOString();
  const testBillId = 'AB123456C';
  const billRef = doc(db, 'bills', testBillId);
  const sightRef1 = doc(collection(db, 'sightings'));

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
  await assertPass('正常な再発見トランザクション (bill更新 sightingsCount:2 + sighting step:2)', async () => {
    await runTransaction(db, async (txn) => {
      txn.update(billRef, {
        denomination: 1000,
        updatedAt: new Date().toISOString(),
        sightingsCount: 2,
        totalDistanceKm: 350,
        lastSightedAt: new Date().toISOString(),
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
