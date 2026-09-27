import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc, type Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { BillWithSightings } from '../types';
import { getPublicBillById } from './billService';
import { resolveLastSeenBaseline, sortTrackedBillRows } from '../utils/trackedBillState.js';

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

export async function getTrackedBills(uid: string): Promise<TrackedBillRow[]> {
  const firestore = db;
  if (!firestore) throw new Error('Firestore is unavailable');
  const trackedSnap = await getDocs(collection(firestore, 'users', uid, 'trackedBills'));
  const rows = await Promise.all(trackedSnap.docs.map(async (trackedDoc) => {
    const entry = trackedDoc.data();
    // Rediscovery-created private records hold serial proof for Firestore Rules,
    // but are not bills originally registered by this user.
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
  return sortTrackedBillRows(rows.filter((row): row is TrackedBillRow => row !== null));
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
