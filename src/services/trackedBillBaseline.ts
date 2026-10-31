import {
  runTransaction, serverTimestamp,
  type DocumentData, type DocumentReference, type Firestore,
} from 'firebase/firestore';
import { resolveOwnedNotificationBaseline } from '../utils/trackedBillState.js';

/** Fill only the existing missing field, never acknowledge unseen rediscoveries.
 * A transaction protects an acknowledgement saved by another device or a merge.
 */
export async function ensureOwnedNotificationBaseline(
  db: Firestore, ref: DocumentReference<DocumentData>, publicBillId: string,
  sightingsCount: number, storedCount: number | undefined,
) {
  let baseline = resolveOwnedNotificationBaseline(sightingsCount, storedCount);
  if (!baseline.shouldPersistBaseline) return baseline;
  const savedCount = await runTransaction(db, async (tx) => {
    const fresh = await tx.get(ref);
    const data = fresh.data();
    if (!data || data.firstRegisteredByMe !== true || data.publicBillId !== publicBillId) {
      throw new Error('Notification tracking record changed during baseline initialization');
    }
    if (Number.isInteger(data.lastSeenSightingsCount)) return data.lastSeenSightingsCount as number;
    tx.update(ref, { lastSeenSightingsCount: 1 });
    return 1;
  });
  baseline = resolveOwnedNotificationBaseline(sightingsCount, savedCount);
  return baseline;
}

/** A stale detail view on one device must not undo an acknowledgement on another. */
export async function markTrackedBillSeenInFirestore(
  db: Firestore, ref: DocumentReference<DocumentData>, sightingsCount: number, municipality: string,
) {
  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const savedCount = fresh.data().lastSeenSightingsCount;
    if (Number.isInteger(savedCount) && savedCount > sightingsCount) return;
    tx.update(ref, {
      lastSeenSightingsCount: sightingsCount,
      lastSeenAt: serverTimestamp(),
      lastSeenMunicipality: municipality,
    });
  });
}
