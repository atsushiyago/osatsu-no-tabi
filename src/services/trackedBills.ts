import { collection, doc, getDocs, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { BillWithSightings } from '../types';
import { getBillBySerial } from './billService';

export interface TrackedBillRow {
  bill: BillWithSightings;
  createdAt: Timestamp | null;
  firstRegisteredByMe: true;
  notifyOnRediscovery: boolean;
}

export async function trackFirstRegisteredBill(uid: string, billId: string): Promise<void> {
  if (!db) throw new Error('Firestore is unavailable');
  const trackedRef = doc(db, 'users', uid, 'trackedBills', billId);
  await setDoc(trackedRef, {
    billId,
    createdAt: serverTimestamp(),
    firstRegisteredByMe: true,
    notifyOnRediscovery: false,
  });
}

export async function getTrackedBills(uid: string): Promise<TrackedBillRow[]> {
  if (!db) throw new Error('Firestore is unavailable');
  const trackedSnap = await getDocs(collection(db, 'users', uid, 'trackedBills'));
  const tracked = trackedSnap.docs.map((snapshot) => snapshot.data());
  const rows = await Promise.all(tracked.map(async (entry) => {
    if (typeof entry.billId !== 'string') return null;
    const bill = await getBillBySerial(entry.billId);
    if (!bill) return null;
    return {
      bill,
      createdAt: (entry.createdAt as Timestamp | undefined) ?? null,
      firstRegisteredByMe: true,
      notifyOnRediscovery: entry.notifyOnRediscovery === true,
    } satisfies TrackedBillRow;
  }));
  return rows.filter((row): row is TrackedBillRow => row !== null)
    .sort((a, b) => (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0));
}
