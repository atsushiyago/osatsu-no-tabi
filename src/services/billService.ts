import {
  collection,
  doc,
  serverTimestamp,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  documentId,
  startAfter,
  limit,
  runTransaction,
  getAggregateFromServer,
  getCountFromServer,
  Timestamp,
  count,
  sum,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousUser, isFirebaseConfigured } from './firebase';
import type {
  Bill,
  Sighting,
  BillWithSightings,
  GlobalStats,
  RegisterBillInput,
  RegisterResult,
} from '../types';
import { calculateDistanceKm, getMunicipalityLocation } from '../utils/geo';
import { normalizeSerialNumber } from '../utils/serial';
import { startTiming } from '../utils/timing';
import { isDebugTiming } from '../utils/debug';
import { getPageWindow, projectPublicBill } from '../utils/publicBillPagination.js';

export const PUBLIC_BILLS_PAGE_SIZE = 20;
export type PublicBillsCursor = QueryDocumentSnapshot<DocumentData>;

export interface PublicBillsPage {
  bills: Bill[];
  nextCursor: PublicBillsCursor | null;
  hasMore: boolean;
}

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

interface LocalBill extends Bill {
  serialNumber: string;
}

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
  publicBillId: string,
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
    lastOperationPublicBillId: publicBillId,
    lastOperationSightingId: sightingId,
  };
}

function logRegistrationTransactionDebug(details: {
  uid: string;
  publicBillId: string;
  sightingId: string;
  rateLimitPath: string;
  rateLimitWrite: 'create' | 'update';
  rateLimitData: Record<string, any>;
}): void {
  if (!isDebugTiming()) return;
  console.debug('[Registration Debug] transaction writes', {
    authUid: details.uid,
    publicBillId: details.publicBillId,
    sightingId: details.sightingId,
    rateLimitPath: details.rateLimitPath,
    rateLimitWrite: details.rateLimitWrite,
    shortCount: details.rateLimitData.shortCount,
    dailyCount: details.rateLimitData.dailyCount,
  });
}

function getLocalData(): { bills: LocalBill[]; sightings: Sighting[] } {
  try {
    const billsRaw = localStorage.getItem(LOCAL_STORAGE_BILLS_KEY);
    const sightingsRaw = localStorage.getItem(LOCAL_STORAGE_SIGHTINGS_KEY);

    const storedBills: LocalBill[] = billsRaw ? JSON.parse(billsRaw) : [];
    const storedSightings: Sighting[] = sightingsRaw ? JSON.parse(sightingsRaw) : [];
    const legacySampleBillIds = new Set(['AA123456B', 'BC987654A', 'MN555666D']);
    const bills = storedBills.filter((bill) => !legacySampleBillIds.has(bill.id));
    const sightings = storedSightings.filter((sighting) => !legacySampleBillIds.has(sighting.publicBillId ?? sighting.billId ?? ''));

    if (bills.length !== storedBills.length || sightings.length !== storedSightings.length) {
      saveLocalData(bills, sightings);
    }

    return { bills, sightings };
  } catch {
    return { bills: [], sightings: [] };
  }
}

function saveLocalData(bills: LocalBill[], sightings: Sighting[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_BILLS_KEY, JSON.stringify(bills));
    localStorage.setItem(LOCAL_STORAGE_SIGHTINGS_KEY, JSON.stringify(sightings));
  } catch (err) {
    console.error('Failed to save to local storage', err);
  }
}

function toPublicBill(bill: LocalBill): Bill {
  const { serialNumber: _privateSerial, ...publicBill } = bill;
  return publicBill;
}

/**
 * 記番号で紙幣とその全発見記録を取得する
 */
export async function getBillBySerial(serial: string): Promise<BillWithSightings | null> {
  const normSerial = normalizeSerialNumber(serial);
  if (!normSerial) return null;

  if (isFirebaseConfigured && db) {
    const endTotal = startTiming('getBillBySerial');
    try {
      if (!auth?.currentUser) await ensureAnonymousUser();
      // Exact get only: serialIndex rules deny list/query. Firestore cannot prevent
      // determined clients from probing guesses; server lookup is a future hardening path.
      const indexRef = doc(db, 'serialIndex', normSerial);
      const snap = await getDoc(indexRef);
      if (!snap.exists() || typeof snap.data().publicBillId !== 'string') {
        endTotal();
        return null;
      }
      const publicBillId = snap.data().publicBillId as string;
      const billRef = doc(db, 'publicBills', publicBillId);
      const endQ1 = startTiming('getBillBySerial: getDoc(publicBills)');
      const billSnap = await getDoc(billRef);
      endQ1();

      if (!billSnap.exists()) {
        endTotal();
        return null;
      }

      const bill = { id: billSnap.id, ...billSnap.data() } as Bill;

      // 発見記録を取得
      const sightingsRef = collection(db, 'sightings');
      const sq = query(
        sightingsRef,
        where('publicBillId', '==', bill.id)
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
    .filter((s) => (s.publicBillId ?? s.billId) === bill.id)
    .sort((a, b) => a.step - b.step);

  const { serialNumber: _privateSerial, ...publicBill } = bill;
  return { ...publicBill, sightings: billSightings };
}

export async function getPublicBillById(publicBillId: string): Promise<BillWithSightings | null> {
  if (!db || !isFirebaseConfigured) {
    if (import.meta.env.PROD) return null;
    const { bills, sightings } = getLocalData();
    const bill = bills.find((item) => item.id === publicBillId);
    if (!bill) return null;
    const { serialNumber: _privateSerial, ...publicBill } = bill;
    return { ...publicBill, sightings: sightings.filter((item) => (item.publicBillId ?? item.billId) === publicBillId).sort((a, b) => a.step - b.step) };
  }
  const billRef = doc(db, 'publicBills', publicBillId);
  const billSnap = await getDoc(billRef);
  if (!billSnap.exists()) return null;
  const bill = { id: billSnap.id, ...billSnap.data() } as Bill;
  const sightingsSnap = await getDocs(query(collection(db, 'sightings'), where('publicBillId', '==', publicBillId)));
  const sightings = sightingsSnap.docs.map((item) => ({ id: item.id, ...item.data() } as Sighting)).sort((a, b) => a.step - b.step);
  return { ...bill, sightings };
}

/** Legacy public records are intentionally unsupported after the schema reset. */
export async function initializeLegacyBillCooldown(_serial: string): Promise<boolean> { return false; }

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
    const endTotal = startTiming('registerBillSighting');
    // Firebase設定時はFirestoreで実行し、エラー時は隠さずそのままthrowする
    const uid = (auth?.currentUser ?? await ensureAnonymousUser()).uid;
    if (!uid) throw new Error('登録に必要な端末認証を準備できませんでした。ページを再読み込みしてお試しください。');
    const indexRef = doc(db, 'serialIndex', normSerial);
    const candidatePublicBillId = crypto.randomUUID();
    const rateLimitRef = doc(db, 'rateLimits', uid);
    const sightingsColRef = collection(db, 'sightings');
    const sightingDocRef = doc(sightingsColRef);

    let endTx: ((err?: unknown) => number) | null = null;
    try {
      endTx = startTiming(`registerBillSighting: runTransaction`);
      const txResult = await runTransaction(db, async (txn) => {
        const endGet = startTiming('registerBillSighting: txn.get(index/rate)');
        const [indexSnap, rateLimitSnap] = await Promise.all([
          txn.get(indexRef),
          txn.get(rateLimitRef),
        ]);
        endGet();
        const currentRateLimit = rateLimitSnap.exists() ? rateLimitSnap.data() : null;
        const publicBillId = indexSnap.exists() ? String(indexSnap.data().publicBillId) : candidatePublicBillId;
        const firestore = db!;
        const billRef = doc(firestore, 'publicBills', publicBillId);
        const trackedRef = doc(firestore, 'users', uid, 'trackedBills', publicBillId);
        const billSnap = indexSnap.exists() ? await txn.get(billRef) : null;
        const trackedSnap = await txn.get(trackedRef);
        const currentLastSightingSnap = billSnap?.exists() && billSnap.data().lastSightingId
          ? await txn.get(doc(sightingsColRef, String(billSnap.data().lastSightingId)))
          : null;

        if (billSnap?.exists()) {
          // 既に登録されている紙幣（再発見！）
          const currentBill = { id: billSnap.id, ...billSnap.data() } as Bill;

          if (trackedSnap.exists() && trackedSnap.data().serialNumber !== normSerial) {
            throw new Error('このお札の端末内記録と記番号が一致しません。');
          }

          // 額面不整合チェック: 既存の額面と異なる場合はエラー
          if (input.denomination && input.denomination !== currentBill.denomination) {
            throw new Error(
              `この記番号のお札は既に ${currentBill.denomination.toLocaleString()}円札 として登録されています。額面を変更することはできません。`
            );
          }

          // 直前の発見を取得
        const lastSighting = currentLastSightingSnap?.exists()
          ? ({ id: currentLastSightingSnap.id, ...currentLastSightingSnap.data() } as Sighting)
          : undefined;
        const distKm = lastSighting
          ? calculateDistanceKm(
              getMunicipalityLocation(lastSighting.prefecture, lastSighting.municipality)?.lat ?? 0,
              getMunicipalityLocation(lastSighting.prefecture, lastSighting.municipality)?.lng ?? 0,
              getMunicipalityLocation(input.prefecture, input.municipality)?.lat ?? 0,
              getMunicipalityLocation(input.prefecture, input.municipality)?.lng ?? 0
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
        const newTotalDist = (currentBill.totalDistanceKm || 0) + distKm;

        // undefined を含めないよう、userNoteが存在する場合のみプロパティを含める
        const newSighting: Sighting = {
          id: sightingDocRef.id,
          publicBillId,
          step: newStep,
          prefecture: input.prefecture,
          municipality: input.municipality,
          createdAt: nowIso,
          distanceFromPrevKm: distKm,
          daysFromPrev: daysDiff,
          ...(trimmedNote ? { userNote: trimmedNote } : {}),
        };

        txn.set(sightingDocRef, sanitizeFirestoreData(newSighting));
        const rateLimitData = nextRateLimitData(currentRateLimit, publicBillId, sightingDocRef.id);
        logRegistrationTransactionDebug({
          uid,
          publicBillId,
          sightingId: sightingDocRef.id,
          rateLimitPath: rateLimitRef.path,
          rateLimitWrite: rateLimitSnap.exists() ? 'update' : 'create',
          rateLimitData,
        });
        txn.set(rateLimitRef, rateLimitData);
        if (trackedSnap.exists()) {
          txn.update(trackedRef, {
            lastSeenSightingsCount: newStep,
            lastSeenAt: serverTimestamp(),
            lastSeenMunicipality: input.municipality,
          });
        } else {
          // Keep the serial proof private while distinguishing a found bill
          // from a bill originally registered by this user.
          txn.set(trackedRef, {
            publicBillId,
            serialNumber: normSerial,
            denomination: currentBill.denomination,
            createdAt: serverTimestamp(),
            firstRegisteredByMe: false,
            notifyOnRediscovery: false,
            lastSeenSightingsCount: newStep,
            lastSeenAt: serverTimestamp(),
            lastSeenMunicipality: input.municipality,
          });
        }

        const finalBill: Bill = {
          ...currentBill,
          denomination: currentBill.denomination, // 既存の額面を不変として維持
          updatedAt: nowIso,
          sightingsCount: newStep,
          totalDistanceKm: newTotalDist,
          lastSightedAt: nowIso,
          lastSightingId: sightingDocRef.id,
          lastSightedAtServer: Timestamp.fromDate(new Date(nowIso)),
        };

        // denomination は不変フィールドのため更新対象から外す
        txn.update(billRef, sanitizeFirestoreData({
          updatedAt: nowIso,
          sightingsCount: newStep,
          totalDistanceKm: newTotalDist,
          lastSightedAt: nowIso,
          lastSightingId: sightingDocRef.id,
          lastMunicipality: input.municipality,
          lastSightedAtServer: serverTimestamp(),
        }));

        return {
          isRediscovery: true,
          bill: finalBill,
          newSighting,
          allSightings: lastSighting ? [lastSighting, newSighting] : [newSighting],
          sightingsCount: newStep,
          distanceFromPrevKm: distKm,
          daysFromPrev: daysDiff,
        };
      } else {
        // 初回登録
        const finalBill: Bill = {
          id: publicBillId,
          denomination: input.denomination,
          createdAt: nowIso,
          updatedAt: nowIso,
          sightingsCount: 1,
          totalDistanceKm: 0,
          firstSightedAt: nowIso,
          lastSightedAt: nowIso,
        };

        txn.set(indexRef, { publicBillId, createdAt: serverTimestamp() });
        txn.set(billRef, sanitizeFirestoreData({
          id: publicBillId,
          denomination: finalBill.denomination,
          createdAt: nowIso,
          updatedAt: nowIso,
          sightingsCount: 1,
          totalDistanceKm: 0,
          firstSightedAt: nowIso,
          lastSightedAt: nowIso,
          lastSightingId: sightingDocRef.id,
          lastMunicipality: input.municipality,
          lastSightedAtServer: serverTimestamp(),
        }));

        // undefined を含めないよう、userNoteが存在する場合のみプロパティを含める
        const newSighting: Sighting = {
          id: sightingDocRef.id,
          publicBillId,
          step: 1,
          prefecture: input.prefecture,
          municipality: input.municipality,
          createdAt: nowIso,
          distanceFromPrevKm: 0,
          daysFromPrev: 0,
          ...(trimmedNote ? { userNote: trimmedNote } : {}),
        };

        txn.set(sightingDocRef, sanitizeFirestoreData(newSighting));
        const rateLimitData = nextRateLimitData(currentRateLimit, publicBillId, sightingDocRef.id);
        logRegistrationTransactionDebug({
          uid,
          publicBillId,
          sightingId: sightingDocRef.id,
          rateLimitPath: rateLimitRef.path,
          rateLimitWrite: rateLimitSnap.exists() ? 'update' : 'create',
          rateLimitData,
        });
        txn.set(rateLimitRef, rateLimitData);
        txn.set(trackedRef, {
          publicBillId,
          serialNumber: normSerial,
          denomination: input.denomination,
          createdAt: serverTimestamp(),
          firstRegisteredByMe: true,
          notifyOnRediscovery: false,
          lastSeenSightingsCount: 1,
          lastSeenAt: serverTimestamp(),
          lastSeenMunicipality: input.municipality,
        });

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
      const complete = await getPublicBillById(txResult.bill.id);
      return complete ? { ...txResult, allSightings: complete.sightings } : txResult;
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
        `この記番号のお札は既に ${currentBill.denomination.toLocaleString()}円札 として登録されています。額面を変更することはできません。`
      );
    }

    const billSightings = sightings
      .filter((s) => (s.publicBillId ?? s.billId) === currentBill.id)
      .sort((a, b) => a.step - b.step);

    const lastSighting = billSightings[billSightings.length - 1];
    const distKm = lastSighting
      ? calculateDistanceKm(
          getMunicipalityLocation(lastSighting.prefecture, lastSighting.municipality)?.lat ?? 0,
          getMunicipalityLocation(lastSighting.prefecture, lastSighting.municipality)?.lng ?? 0,
          getMunicipalityLocation(input.prefecture, input.municipality)?.lat ?? 0,
          getMunicipalityLocation(input.prefecture, input.municipality)?.lng ?? 0
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
      publicBillId: currentBill.id,
      step: newStep,
      prefecture: input.prefecture,
      municipality: input.municipality,
      userNote: input.userNote?.trim() || undefined,
      createdAt: nowIso,
      distanceFromPrevKm: distKm,
      daysFromPrev: daysDiff,
    };

    const updatedBill: LocalBill = {
      ...currentBill,
      serialNumber: normSerial,
      denomination: currentBill.denomination,
      updatedAt: nowIso,
      sightingsCount: newStep,
      totalDistanceKm: newTotalDist,
      lastSightedAt: nowIso,
      lastSightingId: newSighting.id,
      lastMunicipality: input.municipality,
      lastSightedAtServer: nowIso,
    };

    bills[existingBillIndex] = updatedBill;
    sightings.push(newSighting);
    saveLocalData(bills, sightings);

    return {
      isRediscovery: true,
      bill: toPublicBill(updatedBill),
      newSighting,
      allSightings: [...billSightings, newSighting],
      sightingsCount: newStep,
      distanceFromPrevKm: distKm,
      daysFromPrev: daysDiff,
    };
  } else {
    // 新規登録
    const newBill: LocalBill = {
      id: crypto.randomUUID(),
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
      publicBillId: newBill.id,
      step: 1,
      prefecture: input.prefecture,
      municipality: input.municipality,
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
      bill: toPublicBill(newBill),
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
      const billsRef = collection(db, 'publicBills');
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

/** Fetch one page of public bill summaries, ordered like the Home recent list. */
export async function getPublicBillsPage(
  cursor: PublicBillsCursor | null = null
): Promise<PublicBillsPage> {
  if (isFirebaseConfigured && db) {
    const endTotal = startTiming('getPublicBillsPage');
    try {
      const billsRef = collection(db, 'publicBills');
      const constraints: QueryConstraint[] = [
        orderBy('updatedAt', 'desc'),
        // Stable tie-breaker for bills whose updatedAt values are identical.
        orderBy(documentId(), 'desc'),
      ];
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(PUBLIC_BILLS_PAGE_SIZE + 1));

      const snap = await getDocs(query(billsRef, ...constraints));
      const page = getPageWindow(snap.docs, PUBLIC_BILLS_PAGE_SIZE);
      endTotal();
      return {
        bills: page.items.map((docSnap) => projectPublicBill(docSnap.id, docSnap.data())),
        nextCursor: page.hasMore ? page.cursor : null,
        hasMore: page.hasMore,
      };
    } catch (error) {
      endTotal(error);
      throw error;
    }
  }

  if (import.meta.env.PROD) {
    throw new Error('本番環境のFirebase環境変数が設定されていません。Cloudflareの環境変数 (VITE_FIREBASE_*) を確認してください。');
  }

  // Firebaseを使わないローカルデモでは公開データを取得しない。
  return { bills: [], nextCursor: null, hasMore: false };
}

/**
 * 直近旅したお札の最新リストを取得（トップページ等のティッカー用）
 */
export async function getRecentJourneys(limitCount = 5): Promise<BillWithSightings[]> {
  if (isFirebaseConfigured && db) {
    const endTotal = startTiming(`getRecentJourneys(${limitCount})`);
    try {
    const billsRef = collection(db, 'publicBills');
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
            where('publicBillId', '==', bill.id)
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
      .filter((sight) => (sight.publicBillId ?? sight.billId) === b.id)
      .sort((s1, s2) => s1.step - s2.step);
    const { serialNumber: _privateSerial, ...publicBill } = b;
    return {
      ...publicBill,
      sightings: s,
    };
  });
}
