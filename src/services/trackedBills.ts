import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { BillWithSightings } from '../types';
import { getPublicBillById } from './billService';
import { resolveLastSeenBaseline, sortTrackedBillRows } from '../utils/trackedBillState.js';
import { getPageWindow } from '../utils/publicBillPagination.js';

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
  firstRegisteredByMe: true;
  notifyOnRediscovery: boolean;
  lastSeenSightingsCount: number;
  lastSeenAt: Timestamp | null;
  lastSeenMunicipality: string | null;
  unseenSightingsCount: number;
}

async function loadTrackedBillRows(
  trackedDocs: QueryDocumentSnapshot<DocumentData>[]
): Promise<TrackedBillRow[]> {
  const rows = await Promise.all(trackedDocs.map(async (trackedDoc) => {
    const entry = trackedDoc.data();
    // Keep a defensive check even though paged queries filter this on Firestore.
    if (entry.firstRegisteredByMe !== true) return null;
    if (typeof entry.publicBillId !== 'string' || typeof entry.serialNumber !== 'string') return null;
    const bill = await getPublicBillById(entry.publicBillId);
    if (!bill) return null;
    const baseline = resolveLastSeenBaseline(bill.sightingsCount, entry.lastSeenSightingsCount as number | undefined);
    const lastSeenSightingsCount = baseline.lastSeenSightingsCount;

    // One-time migration: establish a quiet baseline without showing old bills as new.
    if (baseline.shouldPersistBaseline) {
      try {
        await updateDoc(trackedDoc.ref, {
          lastSeenSightingsCount,
        });
      } catch (error) {
        console.warn('Could not save tracked bill baseline; using current count for this visit:', error);
      }
    }

    return {
      bill,
      serialNumber: entry.serialNumber,
      createdAt: (entry.createdAt as Timestamp | undefined) ?? null,
      firstRegisteredByMe: true,
      notifyOnRediscovery: entry.notifyOnRediscovery === true,
      lastSeenSightingsCount,
      lastSeenAt: (entry.lastSeenAt as Timestamp | undefined) ?? null,
      lastSeenMunicipality: typeof entry.lastSeenMunicipality === 'string' ? entry.lastSeenMunicipality : null,
      unseenSightingsCount: baseline.unseenSightingsCount,
    } satisfies TrackedBillRow;
  }));
  return rows.filter((row): row is TrackedBillRow => row !== null);
}

export async function getTrackedBills(uid: string): Promise<TrackedBillRow[]> {
  const firestore = db;
  if (!firestore) throw new Error('Firestore is unavailable');
  const trackedSnap = await getDocs(collection(firestore, 'users', uid, 'trackedBills'));
  const rows = await loadTrackedBillRows(trackedSnap.docs);
  return sortTrackedBillRows(rows);
}

export async function getTrackedBillsPage(
  uid: string,
  cursor: TrackedBillsCursor | null = null
): Promise<TrackedBillsPage> {
  const firestore = db;
  if (!firestore) throw new Error('Firestore is unavailable');

  const trackedRef = collection(firestore, 'users', uid, 'trackedBills');
  const constraints: QueryConstraint[] = [
    where('firstRegisteredByMe', '==', true),
    orderBy('createdAt', 'desc'),
  ];
  if (cursor) constraints.push(startAfter(cursor));
  const snapshot = await getDocs(query(trackedRef, ...constraints, limit(TRACKED_BILLS_PAGE_SIZE + 1)));
  const page = getPageWindow(snapshot.docs, TRACKED_BILLS_PAGE_SIZE);
  const rows = await loadTrackedBillRows(page.items);

  return {
    rows,
    nextCursor: page.hasMore ? page.cursor : null,
    hasMore: page.hasMore,
  };
}

export async function getTrackedBillsCount(uid: string): Promise<number> {
  const firestore = db;
  if (!firestore) throw new Error('Firestore is unavailable');
  const trackedRef = collection(firestore, 'users', uid, 'trackedBills');
  const snapshot = await getCountFromServer(query(trackedRef, where('firstRegisteredByMe', '==', true)));
  return snapshot.data().count;
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
  const trackedSnap = await getDoc(trackedRef);
  if (!trackedSnap.exists()) return;
  await updateDoc(trackedRef, {
    lastSeenSightingsCount: sightingsCount,
    lastSeenAt: serverTimestamp(),
    lastSeenMunicipality: municipality,
  });
}
