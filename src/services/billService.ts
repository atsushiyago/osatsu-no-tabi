import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';
import type {
  Bill,
  Sighting,
  BillWithSightings,
  GlobalStats,
  RegisterBillInput,
  RegisterResult,
} from '../types';
import { calculateDistanceKm } from '../utils/geo';
import { normalizeSerialNumber } from '../utils/serial';

/**
 * Firestore書き込み用データから undefined のフィールドを除外するヘルパー
 */
function sanitizeFirestoreData<T extends Record<string, any>>(obj: T): T {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

// 初期サンプルデータ（Where's George 日本版の代表ストーリー）
const INITIAL_SAMPLE_BILLS: Bill[] = [
  {
    id: 'AA123456B',
    serialNumber: 'AA123456B',
    denomination: 1000,
    createdAt: '2026-09-25T10:00:00.000Z',
    updatedAt: '2026-12-17T15:30:00.000Z',
    sightingsCount: 4,
    totalDistanceKm: 520,
    firstSightedAt: '2026-09-25T10:00:00.000Z',
    lastSightedAt: '2026-12-17T15:30:00.000Z',
  },
  {
    id: 'BC987654A',
    serialNumber: 'BC987654A',
    denomination: 10000,
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-11-05T09:15:00.000Z',
    sightingsCount: 2,
    totalDistanceKm: 890,
    firstSightedAt: '2026-08-10T12:00:00.000Z',
    lastSightedAt: '2026-11-05T09:15:00.000Z',
  },
  {
    id: 'MN555666D',
    serialNumber: 'MN555666D',
    denomination: 5000,
    createdAt: '2026-09-01T08:20:00.000Z',
    updatedAt: '2026-09-01T08:20:00.000Z',
    sightingsCount: 1,
    totalDistanceKm: 0,
    firstSightedAt: '2026-09-01T08:20:00.000Z',
    lastSightedAt: '2026-09-01T08:20:00.000Z',
  },
];

const INITIAL_SAMPLE_SIGHTINGS: Sighting[] = [
  // AA123456B の旅（大和市 → 新宿区 → 名古屋市 → 京都市）
  {
    id: 'sight-aa1-1',
    billId: 'AA123456B',
    step: 1,
    prefecture: '神奈川県',
    municipality: '大和市',
    latitudeApprox: 35.4883,
    longitudeApprox: 139.4628,
    userNote: '駅前のベーカリーでお釣りとして受け取りました！',
    createdAt: '2026-09-25T10:00:00.000Z',
    distanceFromPrevKm: 0,
    daysFromPrev: 0,
  },
  {
    id: 'sight-aa1-2',
    billId: 'AA123456B',
    step: 2,
    prefecture: '東京都',
    municipality: '新宿区',
    latitudeApprox: 35.6938,
    longitudeApprox: 139.7034,
    userNote: '新宿の書店で本を買った際のお釣りでした。',
    createdAt: '2026-10-02T14:15:00.000Z',
    distanceFromPrevKm: 32,
    daysFromPrev: 7,
  },
  {
    id: 'sight-aa1-3',
    billId: 'AA123456B',
    step: 3,
    prefecture: '愛知県',
    municipality: '名古屋市',
    latitudeApprox: 35.1815,
    longitudeApprox: 136.9066,
    userNote: '出張先の名古屋名物きしめん屋で発見！',
    createdAt: '2026-10-21T18:45:00.000Z',
    distanceFromPrevKm: 262,
    daysFromPrev: 19,
  },
  {
    id: 'sight-aa1-4',
    billId: 'AA123456B',
    step: 4,
    prefecture: '京都府',
    municipality: '京都市',
    latitudeApprox: 35.0116,
    longitudeApprox: 135.7681,
    userNote: '紅葉狩りの途中のカフェで出会いました。どこまで旅するかな？',
    createdAt: '2026-12-17T15:30:00.000Z',
    distanceFromPrevKm: 107,
    daysFromPrev: 57,
  },

  // BC987654A の旅（福岡市 → 札幌市）
  {
    id: 'sight-bc1-1',
    billId: 'BC987654A',
    step: 1,
    prefecture: '福岡県',
    municipality: '福岡市',
    latitudeApprox: 33.5904,
    longitudeApprox: 130.4017,
    userNote: '博多駅の売店にて。',
    createdAt: '2026-08-10T12:00:00.000Z',
    distanceFromPrevKm: 0,
    daysFromPrev: 0,
  },
  {
    id: 'sight-bc1-2',
    billId: 'BC987654A',
    step: 2,
    prefecture: '北海道',
    municipality: '札幌市',
    latitudeApprox: 43.0642,
    longitudeApprox: 141.3469,
    userNote: '北海道へロングトラベル！びっくりしました。',
    createdAt: '2026-11-05T09:15:00.000Z',
    distanceFromPrevKm: 1420,
    daysFromPrev: 87,
  },

  // MN555666D (仙台市)
  {
    id: 'sight-mn1-1',
    billId: 'MN555666D',
    step: 1,
    prefecture: '宮城県',
    municipality: '仙台市',
    latitudeApprox: 38.2682,
    longitudeApprox: 140.8694,
    userNote: '初登録です。これから全国を旅してほしい！',
    createdAt: '2026-09-01T08:20:00.000Z',
    distanceFromPrevKm: 0,
    daysFromPrev: 0,
  },
];

const LOCAL_STORAGE_BILLS_KEY = 'osatsu_bills_repo';
const LOCAL_STORAGE_SIGHTINGS_KEY = 'osatsu_sightings_repo';

function getLocalData(): { bills: Bill[]; sightings: Sighting[] } {
  try {
    const billsRaw = localStorage.getItem(LOCAL_STORAGE_BILLS_KEY);
    const sightingsRaw = localStorage.getItem(LOCAL_STORAGE_SIGHTINGS_KEY);

    let bills: Bill[] = billsRaw ? JSON.parse(billsRaw) : [];
    let sightings: Sighting[] = sightingsRaw ? JSON.parse(sightingsRaw) : [];

    if (bills.length === 0) {
      bills = INITIAL_SAMPLE_BILLS;
      sightings = INITIAL_SAMPLE_SIGHTINGS;
      localStorage.setItem(LOCAL_STORAGE_BILLS_KEY, JSON.stringify(bills));
      localStorage.setItem(LOCAL_STORAGE_SIGHTINGS_KEY, JSON.stringify(sightings));
    }

    return { bills, sightings };
  } catch {
    return { bills: INITIAL_SAMPLE_BILLS, sightings: INITIAL_SAMPLE_SIGHTINGS };
  }
}

function saveLocalData(bills: Bill[], sightings: Sighting[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_BILLS_KEY, JSON.stringify(bills));
    localStorage.setItem(LOCAL_STORAGE_SIGHTINGS_KEY, JSON.stringify(sightings));
  } catch (err) {
    console.error('Failed to save to local storage', err);
  }
}

/**
 * 記番号で紙幣とその全発見記録を取得する
 */
export async function getBillBySerial(serial: string): Promise<BillWithSightings | null> {
  const normSerial = normalizeSerialNumber(serial);
  if (!normSerial) return null;

  if (isFirebaseConfigured && db) {
    const billsRef = collection(db, 'bills');
    const q = query(billsRef, where('serialNumber', '==', normSerial));
    const snap = await getDocs(q);

    if (snap.empty) {
      return null;
    }

    const billDoc = snap.docs[0];
    const bill = { id: billDoc.id, ...billDoc.data() } as Bill;

    // 発見記録を取得
    const sightingsRef = collection(db, 'sightings');
    const sq = query(
      sightingsRef,
      where('billId', '==', bill.id)
    );
    const sSnap = await getDocs(sq);
    const sightings = sSnap.docs
      .map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      } as Sighting))
      .sort((a, b) => a.step - b.step);

    return {
      ...bill,
      sightings,
    };
  }

  // 本番環境でFirebaseが設定されていない場合は事故防止のためエラーを投げる
  if (import.meta.env.PROD) {
    throw new Error('本番環境のFirebase環境変数が設定されていません。VercelのEnvironment Variablesを確認してください。');
  }

  // 開発環境のみのデモモード（ローカルリポジトリ）
  const { bills, sightings } = getLocalData();
  const bill = bills.find((b) => b.serialNumber === normSerial);
  if (!bill) return null;

  const billSightings = sightings
    .filter((s) => s.billId === bill.id)
    .sort((a, b) => a.step - b.step);

  return {
    ...bill,
    sightings: billSightings,
  };
}

/**
 * お札を新規登録または再発見記録を追加
 */
export async function registerBillSighting(
  input: RegisterBillInput
): Promise<RegisterResult> {
  const normSerial = normalizeSerialNumber(input.serialNumber);
  const nowIso = new Date().toISOString();
  const trimmedNote = input.userNote?.trim();

  if (isFirebaseConfigured && db) {
    // Firebase設定時はFirestoreで実行し、エラー時は隠さずそのままthrowする
    const billId = normSerial; // 一意なキーとして正規化記番号を活用
    const billRef = doc(db, 'bills', billId);
    const sightingsColRef = collection(db, 'sightings');

    const txResult = await runTransaction(db, async (txn) => {
      const billSnap = await txn.get(billRef);

      if (billSnap.exists()) {
        // 既に登録されている紙幣（再発見！）
        const currentBill = billSnap.data() as Bill;

        // 額面不整合チェック: 既存の額面と異なる場合はエラー
        if (input.denomination && input.denomination !== currentBill.denomination) {
          throw new Error(
            `このお札（記番号: ${normSerial}）は既に ${currentBill.denomination.toLocaleString()}円札 として登録されています。額面を変更することはできません。`
          );
        }

        // 直前の発見を取得
        const sq = query(
          sightingsColRef,
          where('billId', '==', billId)
        );
        const sSnap = await getDocs(sq);
        const existingSightings = sSnap.docs
          .map((d) => ({
            id: d.id,
            ...d.data(),
          } as Sighting))
          .sort((a, b) => a.step - b.step);

        const lastSighting = existingSightings[existingSightings.length - 1];
        const distKm = lastSighting
          ? calculateDistanceKm(
              lastSighting.latitudeApprox,
              lastSighting.longitudeApprox,
              input.latitudeApprox,
              input.longitudeApprox
            )
          : 0;

        const daysDiff = lastSighting
          ? Math.max(
              0,
              Math.round(
                (new Date(nowIso).getTime() - new Date(lastSighting.createdAt).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            )
          : 0;

        const newStep = (currentBill.sightingsCount || existingSightings.length) + 1;
        const newTotalDist = (currentBill.totalDistanceKm || 0) + distKm;

        const sightingDocRef = doc(sightingsColRef);
        // undefined を含めないよう、userNoteが存在する場合のみプロパティを含める
        const newSighting: Sighting = {
          id: sightingDocRef.id,
          billId,
          step: newStep,
          prefecture: input.prefecture,
          municipality: input.municipality,
          latitudeApprox: input.latitudeApprox,
          longitudeApprox: input.longitudeApprox,
          createdAt: nowIso,
          distanceFromPrevKm: distKm,
          daysFromPrev: daysDiff,
          ...(trimmedNote ? { userNote: trimmedNote } : {}),
        };

        txn.set(sightingDocRef, sanitizeFirestoreData(newSighting));

        const finalBill: Bill = {
          ...currentBill,
          denomination: currentBill.denomination, // 既存の額面を不変として維持
          updatedAt: nowIso,
          sightingsCount: newStep,
          totalDistanceKm: newTotalDist,
          lastSightedAt: nowIso,
        };

        // denomination は不変フィールドのため更新対象から外す
        txn.update(billRef, sanitizeFirestoreData({
          updatedAt: nowIso,
          sightingsCount: newStep,
          totalDistanceKm: newTotalDist,
          lastSightedAt: nowIso,
        }));

        return {
          isRediscovery: true,
          bill: finalBill,
          newSighting,
          allSightings: [...existingSightings, newSighting],
          sightingsCount: newStep,
          distanceFromPrevKm: distKm,
          daysFromPrev: daysDiff,
        };
      } else {
        // 初回登録
        const finalBill: Bill = {
          id: billId,
          serialNumber: normSerial,
          denomination: input.denomination,
          createdAt: nowIso,
          updatedAt: nowIso,
          sightingsCount: 1,
          totalDistanceKm: 0,
          firstSightedAt: nowIso,
          lastSightedAt: nowIso,
        };

        txn.set(billRef, sanitizeFirestoreData(finalBill));

        const sightingDocRef = doc(sightingsColRef);
        // undefined を含めないよう、userNoteが存在する場合のみプロパティを含める
        const newSighting: Sighting = {
          id: sightingDocRef.id,
          billId,
          step: 1,
          prefecture: input.prefecture,
          municipality: input.municipality,
          latitudeApprox: input.latitudeApprox,
          longitudeApprox: input.longitudeApprox,
          createdAt: nowIso,
          distanceFromPrevKm: 0,
          daysFromPrev: 0,
          ...(trimmedNote ? { userNote: trimmedNote } : {}),
        };

        txn.set(sightingDocRef, sanitizeFirestoreData(newSighting));

        return {
          isRediscovery: false,
          bill: finalBill,
          newSighting,
          allSightings: [newSighting],
          sightingsCount: 1,
          distanceFromPrevKm: 0,
          daysFromPrev: 0,
        };
      }
    });

    return txResult;
  }

  // 本番環境でFirebaseが設定されていない場合は事故防止のためエラーを投げる
  if (import.meta.env.PROD) {
    throw new Error('本番環境のFirebase環境変数が設定されていません。VercelのEnvironment Variablesを確認してください。');
  }

  // 開発環境のみのデモモード（ローカルリポジトリ）
  const { bills, sightings } = getLocalData();
  const existingBillIndex = bills.findIndex((b) => b.serialNumber === normSerial);

  if (existingBillIndex >= 0) {
    // 既存紙幣の再発見
    const currentBill = bills[existingBillIndex];

    if (input.denomination && input.denomination !== currentBill.denomination) {
      throw new Error(
        `このお札（記番号: ${normSerial}）は既に ${currentBill.denomination.toLocaleString()}円札 として登録されています。額面を変更することはできません。`
      );
    }

    const billSightings = sightings
      .filter((s) => s.billId === currentBill.id)
      .sort((a, b) => a.step - b.step);

    const lastSighting = billSightings[billSightings.length - 1];
    const distKm = lastSighting
      ? calculateDistanceKm(
          lastSighting.latitudeApprox,
          lastSighting.longitudeApprox,
          input.latitudeApprox,
          input.longitudeApprox
        )
      : 0;

    const daysDiff = lastSighting
      ? Math.max(
          0,
          Math.round(
            (new Date(nowIso).getTime() - new Date(lastSighting.createdAt).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : 0;

    const newStep = currentBill.sightingsCount + 1;
    const newTotalDist = currentBill.totalDistanceKm + distKm;

    const newSighting: Sighting = {
      id: `sight-local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      billId: currentBill.id,
      step: newStep,
      prefecture: input.prefecture,
      municipality: input.municipality,
      latitudeApprox: input.latitudeApprox,
      longitudeApprox: input.longitudeApprox,
      userNote: input.userNote?.trim() || undefined,
      createdAt: nowIso,
      distanceFromPrevKm: distKm,
      daysFromPrev: daysDiff,
    };

    const updatedBill: Bill = {
      ...currentBill,
      denomination: currentBill.denomination,
      updatedAt: nowIso,
      sightingsCount: newStep,
      totalDistanceKm: newTotalDist,
      lastSightedAt: nowIso,
    };

    bills[existingBillIndex] = updatedBill;
    sightings.push(newSighting);
    saveLocalData(bills, sightings);

    return {
      isRediscovery: true,
      bill: updatedBill,
      newSighting,
      allSightings: [...billSightings, newSighting],
      sightingsCount: newStep,
      distanceFromPrevKm: distKm,
      daysFromPrev: daysDiff,
    };
  } else {
    // 新規登録
    const newBill: Bill = {
      id: normSerial,
      serialNumber: normSerial,
      denomination: input.denomination,
      createdAt: nowIso,
      updatedAt: nowIso,
      sightingsCount: 1,
      totalDistanceKm: 0,
      firstSightedAt: nowIso,
      lastSightedAt: nowIso,
    };

    const newSighting: Sighting = {
      id: `sight-local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      billId: newBill.id,
      step: 1,
      prefecture: input.prefecture,
      municipality: input.municipality,
      latitudeApprox: input.latitudeApprox,
      longitudeApprox: input.longitudeApprox,
      userNote: input.userNote?.trim() || undefined,
      createdAt: nowIso,
      distanceFromPrevKm: 0,
      daysFromPrev: 0,
    };

    bills.push(newBill);
    sightings.push(newSighting);
    saveLocalData(bills, sightings);

    return {
      isRediscovery: false,
      bill: newBill,
      newSighting,
      allSightings: [newSighting],
      sightingsCount: 1,
      distanceFromPrevKm: 0,
      daysFromPrev: 0,
    };
  }
}

/**
 * 全体統計を取得
 */
export async function getGlobalStats(): Promise<GlobalStats> {
  if (isFirebaseConfigured && db) {
    const billsRef = collection(db, 'bills');
    const snap = await getDocs(billsRef);

    const totalBills = snap.size;
    let totalSightings = 0;
    let rediscoveredBills = 0;
    let maxDistanceKm = 0;
    let longestJourneyDays = 0;

    snap.forEach((docSnap) => {
      const data = docSnap.data() as Bill;
      const count = data.sightingsCount || 1;
      totalSightings += count;
      if (count >= 2) {
        rediscoveredBills += 1;
      }
      if ((data.totalDistanceKm || 0) > maxDistanceKm) {
        maxDistanceKm = data.totalDistanceKm;
      }
      if (data.firstSightedAt && data.lastSightedAt) {
        const days = Math.round(
          (new Date(data.lastSightedAt).getTime() - new Date(data.firstSightedAt).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        if (days > longestJourneyDays) {
          longestJourneyDays = days;
        }
      }
    });

    return {
      totalBills,
      totalSightings,
      rediscoveredBills,
      maxDistanceKm,
      longestJourneyDays,
    };
  }

  // 本番環境でFirebaseが設定されていない場合は事故防止のためエラーを投げる
  if (import.meta.env.PROD) {
    throw new Error('本番環境のFirebase環境変数が設定されていません。VercelのEnvironment Variablesを確認してください。');
  }

  // 開発環境のみのデモモード（ローカルリポジトリ）
  const { bills } = getLocalData();
  const totalBills = bills.length;
  let totalSightings = 0;
  let rediscoveredBills = 0;
  let maxDistanceKm = 0;
  let longestJourneyDays = 0;

  for (const b of bills) {
    totalSightings += b.sightingsCount;
    if (b.sightingsCount >= 2) {
      rediscoveredBills += 1;
    }
    if (b.totalDistanceKm > maxDistanceKm) {
      maxDistanceKm = b.totalDistanceKm;
    }
    if (b.firstSightedAt && b.lastSightedAt) {
      const days = Math.round(
        (new Date(b.lastSightedAt).getTime() - new Date(b.firstSightedAt).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      if (days > longestJourneyDays) {
        longestJourneyDays = days;
      }
    }
  }

  return {
    totalBills,
    totalSightings,
    rediscoveredBills,
    maxDistanceKm,
    longestJourneyDays,
  };
}

/**
 * 直近旅したお札の最新リストを取得（トップページ等のティッカー用）
 */
export async function getRecentJourneys(limitCount = 5): Promise<BillWithSightings[]> {
  if (isFirebaseConfigured && db) {
    const billsRef = collection(db, 'bills');
    const q = query(billsRef, orderBy('updatedAt', 'desc'), limit(limitCount));
    const snap = await getDocs(q);

    const journeys: BillWithSightings[] = [];
    for (const docSnap of snap.docs) {
      const bill = { id: docSnap.id, ...docSnap.data() } as Bill;
      const sightingsRef = collection(db, 'sightings');
      const sq = query(
        sightingsRef,
        where('billId', '==', bill.id)
      );
      const sSnap = await getDocs(sq);
      const sightings = sSnap.docs
        .map((sDoc) => ({
          id: sDoc.id,
          ...sDoc.data(),
        } as Sighting))
        .sort((a, b) => a.step - b.step);

      journeys.push({
        ...bill,
        sightings,
      });
    }

    return journeys;
  }

  // 本番環境でFirebaseが設定されていない場合は事故防止のためエラーを投げる
  if (import.meta.env.PROD) {
    throw new Error('本番環境のFirebase環境変数が設定されていません。VercelのEnvironment Variablesを確認してください。');
  }

  // 開発環境のみのデモモード
  const { bills, sightings } = getLocalData();
  const sortedBills = [...bills]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limitCount);

  return sortedBills.map((b) => {
    const s = sightings
      .filter((sight) => sight.billId === b.id)
      .sort((s1, s2) => s1.step - s2.step);
    return {
      ...b,
      sightings: s,
    };
  });
}
