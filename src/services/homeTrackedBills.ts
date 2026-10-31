import {
  collection, doc, documentId, getCountFromServer, getDocFromServer, getDocsFromServer,
  limit, query, where,
  type DocumentData, type Firestore, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { Bill, Sighting } from '../types/index.ts';
import { sortTrackedBillRows } from '../utils/trackedBillState.js';
import { ensureOwnedNotificationBaseline } from './trackedBillBaseline.ts';

export interface HomeTrackedBillNotice {
  bill: Bill;
  unseenSightingsCount: number;
  routeSightings: Sighting[];
}

type TrackingRecord = { ref: ReturnType<typeof doc>; data: DocumentData };

function validTracking(data: DocumentData) {
  return data.firstRegisteredByMe === true
    && typeof data.publicBillId === 'string' && typeof data.serialNumber === 'string';
}

function publicBill(item: QueryDocumentSnapshot<DocumentData>): Bill {
  const data = item.data();
  if (!Number.isInteger(data.sightingsCount) || data.sightingsCount < 1) {
    throw new Error('Invalid public sighting count during notification check');
  }
  return { ...data, id: item.id } as Bill;
}

/** No new collection, index, Rules, or persistent migration marker is needed.
 * `owned` keeps the previous complete scan available as an explicit rollback.
 * Counts choose a plan only; a bounded result is never treated as a complete scan.
 */
export async function loadHomeTrackedBills(
  db: Firestore, uid: string, options: { strategy?: 'auto' | 'owned' } = {},
): Promise<HomeTrackedBillNotice[]> {
  const owned = query(collection(db, 'users', uid, 'trackedBills'), where('firstRegisteredByMe', '==', true));
  const rediscovered = query(collection(db, 'publicBills'), where('sightingsCount', '>', 1));
  const bills = new Map<string, Bill>();
  let tracked: TrackingRecord[] | undefined;

  if (options.strategy !== 'owned') {
    const ownedCount = (await getCountFromServer(owned)).data().count;
    if (ownedCount === 0) return [];
    // Limit the aggregation too: a large global collection must not cause an
    // unbounded index scan merely to decide to use the old plan.
    const boundedRediscovered = query(rediscovered, limit(ownedCount + 1));
    const globalCount = (await getCountFromServer(boundedRediscovered)).data().count;
    if (globalCount < ownedCount) {
      const candidates = await getDocsFromServer(boundedRediscovered);
      for (const item of candidates.docs) bills.set(item.id, publicBill(item));
      if (candidates.size <= ownedCount) {
        tracked = [];
        // Every candidate is checked; bound concurrency, not the result set.
        for (let offset = 0; offset < candidates.docs.length; offset += 30) {
          const records = await Promise.all(candidates.docs.slice(offset, offset + 30).map(async (item) => {
            const ref = doc(db, 'users', uid, 'trackedBills', item.id);
            const snapshot = await getDocFromServer(ref);
            const data = snapshot.data();
            return data && validTracking(data) && data.publicBillId === item.id ? { ref, data } : null;
          }));
          tracked.push(...records.filter((item): item is TrackingRecord => item !== null));
        }
      }
      // Growth between count and fetch can fill the bound. Fall through to the
      // full owned scan and reuse any public summaries already obtained.
    }
  }

  if (!tracked) {
    const snapshot = await getDocsFromServer(owned);
    tracked = snapshot.docs.filter((item) => validTracking(item.data()))
      .map((item) => ({ ref: item.ref, data: item.data() }));
    const ids = [...new Set(tracked.map((item) => item.data.publicBillId as string))].filter((id) => !bills.has(id));
    for (let offset = 0; offset < ids.length; offset += 30) {
      const result = await getDocsFromServer(query(collection(db, 'publicBills'), where(documentId(), 'in', ids.slice(offset, offset + 30))));
      for (const item of result.docs) bills.set(item.id, publicBill(item));
    }
  }
  const notices: HomeTrackedBillNotice[] = [];
  for (const { ref, data } of tracked) {
    const bill = bills.get(data.publicBillId);
    if (!bill) continue; // Preserve the existing treatment of a missing public bill.
    const baseline = await ensureOwnedNotificationBaseline(db, ref, bill.id, bill.sightingsCount, data.lastSeenSightingsCount);
    if (baseline.unseenSightingsCount > 0) notices.push({ bill, unseenSightingsCount: baseline.unseenSightingsCount, routeSightings: [] });
  }
  const sorted = sortTrackedBillRows(notices);
  const leading = sorted[0];
  if (leading) {
    const history = await getDocsFromServer(query(collection(db, 'sightings'), where('publicBillId', '==', leading.bill.id)));
    leading.routeSightings = history.docs.map((item) => ({ ...item.data(), id: item.id } as Sighting)).sort((a, b) => a.step - b.step);
  }
  return sorted;
}
