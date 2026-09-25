import {
  collection,
  doc,
  serverTimestamp,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  getAggregateFromServer,
  getCountFromServer,
  Timestamp,
  count,
  sum,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';
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
import { startTiming } from '../utils/timing';
import { isDebugTiming } from '../utils/debug';

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

const LOCAL_STORAGE_BILLS_KEY = 'osatsu_bills_repo';
const LOCAL_STORAGE_SIGHTINGS_KEY = 'osatsu_sightings_repo';
const SHORT_RATE_WINDOW_MS = 10 * 60 * 1000;
const DAILY_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class RegistrationRateLimitError extends Error {
  readonly window: 'short' | 'daily';

  constructor(window: 'short' | 'daily') {
    super(window === 'daily' ? 'Daily registration limit reached' : 'Short-term registration limit reached');
    this.name = 'RegistrationRateLimitError';
    this.window = window;
  }
}

function nextRateLimitData(
  current: Record<string, any> | null,
  billId: string,
  sightingId: string
): Record<string, any> {
  const now = Date.now();
  const shortStartedAt = current?.shortWindowStartedAt as Timestamp | undefined;
  const dailyStartedAt = current?.dailyWindowStartedAt as Timestamp | undefined;
  const shortExpired = !shortStartedAt || now - shortStartedAt.toMillis() >= SHORT_RATE_WINDOW_MS;
  const dailyExpired = !dailyStartedAt || now - dailyStartedAt.toMillis() >= DAILY_RATE_WINDOW_MS;
  const shortCount = Number.isInteger(current?.shortCount) ? current!.shortCount as number : 0;
  const dailyCount = Number.isInteger(current?.dailyCount) ? current!.dailyCount as number : 0;

  if (!dailyExpired && dailyCount >= 50) throw new RegistrationRateLimitError('daily');
  if (!shortExpired && shortCount >= 10) throw new RegistrationRateLimitError('short');

  return {
    shortWindowStartedAt: shortExpired ? serverTimestamp() : shortStartedAt,
    shortCount: shortExpired ? 1 : shortCount + 1,
    dailyWindowStartedAt: dailyExpired ? serverTimestamp() : dailyStartedAt,
    dailyCount: dailyExpired ? 1 : dailyCount + 1,
    updatedAt: serverTimestamp(),
    lastOperationBillId: billId,
    lastOperationSightingId: sightingId,
  };
}

function getLocalData(): { bills: Bill[]; sightings: Sighting[] } {
  try {
    const billsRaw = localStorage.getItem(LOCAL_STORAGE_BILLS_KEY);
    const sightingsRaw = localStorage.getItem(LOCAL_STORAGE_SIGHTINGS_KEY);

    const storedBills: Bill[] = billsRaw ? JSON.parse(billsRaw) : [];
    const storedSightings: Sighting[] = sightingsRaw ? JSON.parse(sightingsRaw) : [];
    const legacySampleBillIds = new Set(['AA123456B', 'BC987654A', 'MN555666D']);
    const bills = storedBills.filter((bill) => !legacySampleBillIds.has(bill.id));
    const sightings = storedSightings.filter((sighting) => !legacySampleBillIds.has(sighting.billId));

    if (bills.length !== storedBills.length || sightings.length !== storedSightings.length) {
      saveLocalData(bills, sightings);
    }

    return { bills, sightings };
  } catch {
    return { bills: [], sightings: [] };
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
    const endTotal = startTiming(`getBillBySerial(${normSerial})`);
    try {
      const billRef = doc(db, 'bills', normSerial);
      if (isDebugTiming()) console.debug('[Bill Lookup Debug] target document ID=', billRef.id);
      const endQ1 = startTiming(`getBillBySerial: getDoc(bills/${billRef.id})`);
      const snap = await getDoc(billRef);
      endQ1();

      if (!snap.exists()) {
        endTotal();
        return null;
      }

      const bill = { id: snap.id, ...snap.data() } as Bill;

      // 発見記録を取得
      const sightingsRef = collection(db, 'sightings');
      const sq = query(
        sightingsRef,
        where('billId', '==', bill.id)
      );
      const endQ2 = startTiming(`getBillBySerial: getDocs(sightings)`);
      const sSnap = await getDocs(sq);
      endQ2();
      const sightings = sSnap.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        } as Sighting))
        .sort((a, b) => a.step - b.step);

      endTotal();
      return {
        ...bill,
        sightings,
      };
    } catch (err) {
      endTotal(err);
      throw err;
    }
  }

  // 本番環境でFirebaseが設定されていない場合は事故防止のためエラーを投げる
  if (import.meta.env.PROD) {
    throw new Error('本番環境のFirebase環境変数が設定されていません。Cloudflareの環境変数 (VITE_FIREBASE_*) を確認してください。');
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

/** Initialize the trusted cooldown clock for bills created before it existed. */
export async function initializeLegacyBillCooldown(serial: string): Promise<boolean> {
  if (!db || !isFirebaseConfigured) return false;
  const billRef = doc(db, 'bills', normalizeSerialNumber(serial));
  return runTransaction(db, async (txn) => {
    const snap = await txn.get(billRef);
    if (!snap.exists()) return false;
    if (snap.data().lastSightedAtServer) return false;
    txn.update(billRef, { lastSightedAtServer: serverTimestamp() });
    return true;
  });
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
    const endTotal = startTiming(`registerBillSighting(${normSerial})`);
    // Firebase設定時はFirestoreで実行し、エラー時は隠さずそのままthrowする
    const uid = auth?.currentUser?.uid;
    if (!uid) throw new Error('登録に必要な端末認証を準備できませんでした。ページを再読み込みしてお試しください。');
    const billId = normSerial; // 一意なキーとして正規化記番号を活用
    const billRef = doc(db, 'bills', billId);
    const rateLimitRef = doc(db, 'rateLimits', uid);
    const sightingsColRef = collection(db, 'sightings');

    let endTx: ((err?: unknown) => number) | null = null;
    try {
      endTx = startTiming(`registerBillSighting: runTransaction`);
      const txResult = await runTransaction(db, async (txn) => {
        const endGet = startTiming(`registerBillSighting: txn.get(bill)`);
        const [billSnap, rateLimitSnap] = await Promise.all([
          txn.get(billRef),
          txn.get(rateLimitRef),
        ]);
        endGet();
        const currentRateLimit = rateLimitSnap.exists() ? rateLimitSnap.data() : null;

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
          const endSight = startTiming(`registerBillSighting: getDocs(existing sightings)`);
          const sSnap = await getDocs(sq);
          endSight();
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
        txn.set(rateLimitRef, nextRateLimitData(currentRateLimit, billId, sightingDocRef.id));

        const finalBill: Bill = {
          ...currentBill,
          denomination: currentBill.denomination, // 既存の額面を不変として維持
          updatedAt: nowIso,
          sightingsCount: newStep,
          totalDistanceKm: newTotalDist,
          lastSightedAt: nowIso,
          lastSightedAtServer: Timestamp.fromDate(new Date(nowIso)),
        };

        // denomination は不変フィールドのため更新対象から外す
        txn.update(billRef, sanitizeFirestoreData({
          updatedAt: nowIso,
          sightingsCount: newStep,
          totalDistanceKm: newTotalDist,
          lastSightedAt: nowIso,
          lastSightedAtServer: serverTimestamp(),
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

        txn.set(billRef, sanitizeFirestoreData({
          ...finalBill,
          lastSightedAtServer: serverTimestamp(),
        }));

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
        txn.set(rateLimitRef, nextRateLimitData(currentRateLimit, billId, sightingDocRef.id));

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

    endTx?.();
    endTotal();
    return txResult;
  } catch (err) {
    endTx?.(err);
    endTotal(err);
    throw err;
  }
}

  // 本番環境でFirebaseが設定されていない場合は事故防止のためエラーを投げる
  if (import.meta.env.PROD) {
    throw new Error('本番環境のFirebase環境変数が設定されていません。Cloudflareの環境変数 (VITE_FIREBASE_*) を確認してください。');
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
      lastSightedAtServer: nowIso,
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
      lastSightedAtServer: nowIso,
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
    const endTotal = startTiming('getGlobalStats');
    try {
      const billsRef = collection(db, 'bills');
      const endParallel = startTiming('getGlobalStats: parallel (agg + rediscount + maxDist)');

      const [basicAggSnap, redisoveredAggSnap, maxDistSnap] = await Promise.all([
        getAggregateFromServer(billsRef, {
          totalBills: count(),
          totalSightings: sum('sightingsCount'),
        }),
        getCountFromServer(query(billsRef, where('sightingsCount', '>', 1))),
        getDocs(query(billsRef, orderBy('totalDistanceKm', 'desc'), limit(1))),
      ]);

      endParallel();

      const basicData = basicAggSnap.data();
      const totalBills = basicData.totalBills ?? 0;
      const totalSightings = basicData.totalSightings ?? 0;
      const rediscoveredBills = redisoveredAggSnap.data().count ?? 0;

      let maxDistanceKm = 0;
      if (!maxDistSnap.empty) {
        const topBill = maxDistSnap.docs[0].data() as Bill;
        maxDistanceKm = topBill.totalDistanceKm || 0;
      }

      endTotal();
      return {
        totalBills,
        totalSightings,
        rediscoveredBills,
        maxDistanceKm,
        longestJourneyDays: 0,
      };
    } catch (err) {
      endTotal(err);
      throw err;
    }
  }

  // 本番環境でFirebaseが設定されていない場合は事故防止のためエラーを投げる
  if (import.meta.env.PROD) {
    throw new Error('本番環境のFirebase環境変数が設定されていません。Cloudflareの環境変数 (VITE_FIREBASE_*) を確認してください。');
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
    const endTotal = startTiming(`getRecentJourneys(${limitCount})`);
    try {
      const billsRef = collection(db, 'bills');
      const q = query(billsRef, orderBy('updatedAt', 'desc'), limit(limitCount));
      const endBills = startTiming('getRecentJourneys: getDocs(bills)');
      const snap = await getDocs(q);
      endBills();

      const sightingsRef = collection(db, 'sightings');
      const endSightings = startTiming(`getRecentJourneys: parallel getDocs(sightings x${snap.docs.length})`);
      const journeys = await Promise.all(
        snap.docs.map(async (docSnap) => {
          const bill = { id: docSnap.id, ...docSnap.data() } as Bill;
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

          return {
            ...bill,
            sightings,
          };
        })
      );
      endSightings();
      endTotal();

      return journeys;
    } catch (err) {
      endTotal(err);
      throw err;
    }
  }

  // 本番環境でFirebaseが設定されていない場合は事故防止のためエラーを投げる
  if (import.meta.env.PROD) {
    throw new Error('本番環境のFirebase環境変数が設定されていません。Cloudflareの環境変数 (VITE_FIREBASE_*) を確認してください。');
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
