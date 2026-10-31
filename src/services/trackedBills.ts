import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import { countTrackedBillDocuments } from './trackedBillCount.js';
import { db } from './firebase';
import type { BillWithSightings } from '../types';
import { getPublicBillById } from './billService';
import { resolveLastSeenBaseline } from '../utils/trackedBillState.js';
import { getPageWindow } from '../utils/publicBillPagination.js';
import { loadHomeTrackedBills, type HomeTrackedBillNotice } from './homeTrackedBills';
import { createShortReadCache, HOME_READ_TTL_MS } from '../utils/shortReadCache';
import { ensureOwnedNotificationBaseline, markTrackedBillSeenInFirestore } from './trackedBillBaseline.ts';

export const TRACKED_BILLS_PAGE_SIZE = 20;
export type TrackedBillsCursor = QueryDocumentSnapshot<DocumentData>;

export interface TrackedBillsPage {
  rows: TrackedBillRow[];
  nextCursor: TrackedBillsCursor | null;
  hasMore: boolean;
}

export interface TrackedBillRow {
  bill: BillWithSightings;
  serialNumber: string;
  createdAt: Timestamp | null;
  firstRegisteredByMe: boolean;
  notifyOnRediscovery: boolean;
  lastSeenSightingsCount: number;
  lastSeenAt: Timestamp | null;
  lastSeenMunicipality: string | null;
  unseenSightingsCount: number;
}

async function loadTrackedBillRows(
  trackedDocs: QueryDocumentSnapshot<DocumentData>[],
  firstRegisteredByMe: boolean,
): Promise<TrackedBillRow[]> {
  const rows = await Promise.all(trackedDocs.map(async (trackedDoc) => {
    const entry = trackedDoc.data();
    // Keep a defensive check even though paged queries filter this on Firestore.
    if (entry.firstRegisteredByMe !== firstRegisteredByMe) return null;
    if (typeof entry.publicBillId !== 'string' || typeof entry.serialNumber !== 'string') return null;
    const bill = await getPublicBillById(entry.publicBillId);
    if (!bill) return null;
    const baseline = firstRegisteredByMe
      ? await ensureOwnedNotificationBaseline(trackedDoc.ref.firestore, trackedDoc.ref, bill.id, bill.sightingsCount, entry.lastSeenSightingsCount)
      : resolveLastSeenBaseline(bill.sightingsCount, entry.lastSeenSightingsCount as number | undefined);
    const lastSeenSightingsCount = baseline.lastSeenSightingsCount;

    return {
      bill,
      serialNumber: entry.serialNumber,
      createdAt: (entry.createdAt as Timestamp | undefined) ?? null,
      firstRegisteredByMe,
      notifyOnRediscovery: entry.notifyOnRediscovery === true,
      lastSeenSightingsCount,
      lastSeenAt: (entry.lastSeenAt as Timestamp | undefined) ?? null,
      lastSeenMunicipality: typeof entry.lastSeenMunicipality === 'string' ? entry.lastSeenMunicipality : null,
      unseenSightingsCount: baseline.unseenSightingsCount,
    } satisfies TrackedBillRow;
  }));
  return rows.filter((row): row is TrackedBillRow => row !== null);
}

const homeNotices = createShortReadCache<HomeTrackedBillNotice[]>(HOME_READ_TTL_MS);
export function invalidateHomeNotifications() { homeNotices.clear(); }
export function getHomeNotifications(uid: string): Promise<HomeTrackedBillNotice[]> {
  return homeNotices.get(uid, () => {
    if (!db) throw new Error('Firestore is unavailable');
    return loadHomeTrackedBills(db, uid);
  });
}

export async function getTrackedBillsPage(
  uid: string,
  cursor: TrackedBillsCursor | null = null,
  firstRegisteredByMe = true,
): Promise<TrackedBillsPage> {
  const firestore = db;
  if (!firestore) throw new Error('Firestore is unavailable');

  const trackedRef = collection(firestore, 'users', uid, 'trackedBills');
  const constraints: QueryConstraint[] = [
    where('firstRegisteredByMe', '==', firstRegisteredByMe),
    orderBy('createdAt', 'desc'),
  ];
  if (cursor) constraints.push(startAfter(cursor));
  const snapshot = await getDocs(query(trackedRef, ...constraints, limit(TRACKED_BILLS_PAGE_SIZE + 1)));
  const page = getPageWindow(snapshot.docs, TRACKED_BILLS_PAGE_SIZE);
  const rows = await loadTrackedBillRows(page.items, firstRegisteredByMe);

  return {
    rows,
    nextCursor: page.hasMore ? page.cursor : null,
    hasMore: page.hasMore,
  };
}

export async function getTrackedBillsCount(uid: string): Promise<number> {
  const firestore = db;
  if (!firestore) throw new Error('Firestore is unavailable');
  return countTrackedBillDocuments(firestore, uid);
}

/** Called after the public bill detail and journey history have rendered. */
export async function markTrackedBillSeen(
  uid: string,
  billId: string,
  sightingsCount: number,
  municipality: string
): Promise<void> {
  if (!db) return;
  const trackedRef = doc(db, 'users', uid, 'trackedBills', billId);
  await markTrackedBillSeenInFirestore(db, trackedRef, sightingsCount, municipality);
  invalidateHomeNotifications();
}
