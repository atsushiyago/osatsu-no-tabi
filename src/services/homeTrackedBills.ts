import {
  collection, doc, documentId, getDocs, query, updateDoc, where,
  type Firestore,
} from 'firebase/firestore';
import type { Bill, Sighting } from '../types/index.ts';
import { resolveLastSeenBaseline, sortTrackedBillRows } from '../utils/trackedBillState.js';

export interface HomeTrackedBillNotice {
  bill: Bill;
  unseenSightingsCount: number;
  routeSightings: Sighting[];
}

/** Check every owned tracking record, without loading every journey history. No new index required. */
export async function loadHomeTrackedBills(db: Firestore, uid: string): Promise<HomeTrackedBillNotice[]> {
  const tracked = await getDocs(query(collection(db, 'users', uid, 'trackedBills'), where('firstRegisteredByMe', '==', true)));
  const valid = tracked.docs.filter((item) => typeof item.data().publicBillId === 'string' && typeof item.data().serialNumber === 'string');
  const ids = [...new Set(valid.map((item) => item.data().publicBillId as string))];
  const bills = new Map<string, Bill>();
  // Batching reduces RPCs; it does not assume that one RPC is one billed document read.
  for (let offset = 0; offset < ids.length; offset += 30) {
    const result = await getDocs(query(collection(db, 'publicBills'), where(documentId(), 'in', ids.slice(offset, offset + 30))));
    for (const item of result.docs) bills.set(item.id, { ...item.data(), id: item.id } as Bill);
  }
  const notices: HomeTrackedBillNotice[] = [];
  for (const item of valid) {
    const entry = item.data();
    const bill = bills.get(entry.publicBillId);
    if (!bill) continue; // Preserve the existing treatment of a missing public bill.
    const baseline = resolveLastSeenBaseline(bill.sightingsCount, entry.lastSeenSightingsCount);
    if (baseline.shouldPersistBaseline) {
      // Preserve the existing one-time, quiet legacy baseline. Never acknowledge an existing baseline.
      try { await updateDoc(doc(db, 'users', uid, 'trackedBills', item.id), { lastSeenSightingsCount: baseline.lastSeenSightingsCount }); }
      catch { console.warn('Could not save tracked bill baseline; using current count for this visit.'); }
    }
    if (baseline.unseenSightingsCount > 0) notices.push({ bill, unseenSightingsCount: baseline.unseenSightingsCount, routeSightings: [] });
  }
  const sorted = sortTrackedBillRows(notices);
  const leading = sorted[0];
  if (leading) {
    // Home displays a route for only this bill. Keep the existing query to avoid a new composite index.
    const history = await getDocs(query(collection(db, 'sightings'), where('publicBillId', '==', leading.bill.id)));
    leading.routeSightings = history.docs.map((item) => ({ ...item.data(), id: item.id } as Sighting)).sort((a, b) => a.step - b.step);
  }
  return sorted;
}
