import {
  collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp,
  setDoc, Timestamp, updateDoc, type DocumentData, type Firestore,
} from 'firebase/firestore';

export interface TrackedBillMergePreview {
  totalCount: number;
  copyCount: number;
  duplicateCount: number;
  alreadyCopiedCount: number;
  ticketId: string | null;
  ticketComplete: boolean;
  sourceBillIds: string[];
  staleTicketId: string | null;
  staleTargetUid: string | null;
}

export interface TrackedBillMergeProgress {
  totalCount: number;
  copiedCount: number;
  duplicateCount: number;
  phase: 'preparing' | 'copying' | 'finishing';
}

export type TrackedBillMergeStage =
  | 'ticket-check-resume' | 'expired-ticket-cleanup' | 'ticket-create' | 'source-lock'
  | 'snapshot-verify' | 'snapshot-copy-read' | 'ticket-verify' | 'snapshot-read' | 'snapshot-write'
  | 'target-copy' | 'ticket-complete';

// Five minutes of clock-skew headroom under the Rules' 30-minute hard limit.
const MERGE_WINDOW_MS = 25 * 60 * 1000;

function ticketRef(db: Firestore, targetUid: string, ticketId: string) {
  return doc(db, 'users', targetUid, 'trackedBillMergeTickets', ticketId);
}

function lockRef(db: Firestore, uid: string) {
  return doc(db, 'users', uid, 'trackedBillMergeLocks', 'active');
}

function exportRef(db: Firestore, sourceUid: string, ticketId: string, billId: string) {
  return doc(db, 'users', sourceUid, 'trackedBillMergeExports', ticketId, 'items', billId);
}

function markerRef(db: Firestore, targetUid: string, billId: string) {
  return doc(db, 'users', targetUid, 'trackedBillMergeImports', billId);
}

function trackedRef(db: Firestore, uid: string, billId: string) {
  return doc(db, 'users', uid, 'trackedBills', billId);
}

export async function previewTrackedBillMerge(
  sourceDb: Firestore,
  targetDb: Firestore,
  sourceUid: string,
  targetUid: string,
): Promise<TrackedBillMergePreview> {
  if (sourceUid === targetUid) throw new Error('Merge source and target must be different users');

  const [sourceSnapshot, targetSnapshot, lockSnapshot] = await Promise.all([
    getDocs(collection(sourceDb, 'users', sourceUid, 'trackedBills')),
    getDocs(collection(targetDb, 'users', targetUid, 'trackedBills')),
    getDoc(lockRef(sourceDb, sourceUid)),
  ]);
  const sourceIds = new Set(sourceSnapshot.docs.map((snapshot) => snapshot.id));
  const targetIds = new Set(targetSnapshot.docs.map((snapshot) => snapshot.id));
  const lock = lockSnapshot.exists() ? lockSnapshot.data() : null;
  const lockTicketId = lock?.ticketId ? String(lock.ticketId) : null;
  const ticketId = lock?.targetUid === targetUid ? lockTicketId : null;
  const ticketSnapshot = ticketId ? await getDoc(ticketRef(targetDb, targetUid, ticketId)) : null;
  const ticket = ticketSnapshot?.exists() ? ticketSnapshot.data() : null;
  const active = Boolean(lock?.expiresAt instanceof Timestamp && lock.expiresAt.toMillis() > Date.now());
  if (active && lock?.targetUid !== targetUid) {
    const error = new Error('A tracked-bill merge is already active for this anonymous account');
    Object.assign(error, { code: 'merge/active-for-another-account' });
    throw error;
  }

  const imported = ticketId
    ? await getDocs(collection(targetDb, 'users', targetUid, 'trackedBillMergeImports'))
    : null;
  const importedForTicket = new Set(imported?.docs
    .filter((snapshot) => snapshot.data().ticketId === ticketId)
    .map((snapshot) => snapshot.id) ?? []);
  let copyCount = 0;
  let duplicateCount = 0;
  let alreadyCopiedCount = 0;
  for (const billId of sourceIds) {
    if (importedForTicket.has(billId) && targetIds.has(billId)) alreadyCopiedCount += 1;
    else if (targetIds.has(billId)) duplicateCount += 1;
    else copyCount += 1;
  }

  return {
    totalCount: sourceIds.size,
    copyCount,
    duplicateCount,
    alreadyCopiedCount,
    ticketId: active ? ticketId : null,
    ticketComplete: ticket?.status === 'complete',
    sourceBillIds: [...sourceIds],
    staleTicketId: !active ? lockTicketId : null,
    staleTargetUid: !active && typeof lock?.targetUid === 'string' ? lock.targetUid : null,
  };
}

async function createOrResumeTicket(
  sourceDb: Firestore,
  targetDb: Firestore,
  sourceUid: string,
  targetUid: string,
  preview: TrackedBillMergePreview,
  onStage?: (stage: TrackedBillMergeStage) => void,
): Promise<string> {
  if (preview.ticketId) return preview.ticketId;

  if (preview.staleTicketId) {
    onStage?.('expired-ticket-cleanup');
    const oldExports = await getDocs(collection(sourceDb, 'users', sourceUid, 'trackedBillMergeExports', preview.staleTicketId, 'items'));
    await Promise.all(oldExports.docs.map((snapshot) => deleteDoc(snapshot.ref)));
    if (preview.staleTargetUid === targetUid) {
      const oldMarkers = await getDocs(collection(targetDb, 'users', targetUid, 'trackedBillMergeImports'));
      await Promise.all(oldMarkers.docs.filter((snapshot) => snapshot.data().ticketId === preview.staleTicketId)
        .map((snapshot) => deleteDoc(snapshot.ref)));
      try { await deleteDoc(ticketRef(targetDb, targetUid, preview.staleTicketId)); } catch { /* Expired artifact can be removed by its owner later. */ }
    }
  }

  const newTicket = doc(collection(targetDb, 'users', targetUid, 'trackedBillMergeTickets'));
  const expiresAt = Timestamp.fromMillis(Date.now() + MERGE_WINDOW_MS);
  onStage?.('ticket-create');
  await setDoc(ticketRef(targetDb, targetUid, newTicket.id), {
    sourceUid,
    targetUid,
    createdAt: serverTimestamp(),
    expiresAt,
    totalCount: preview.totalCount,
    status: 'open',
  });

  // The source-side lock prevents registration and tracked metadata writes from
  // changing the snapshot while it is being copied. Rules release it by expiry.
  onStage?.('source-lock');
  await setDoc(lockRef(sourceDb, sourceUid), {
    sourceUid,
    targetUid,
    ticketId: newTicket.id,
    expiresAt,
  });
  onStage?.('snapshot-verify');
  const lockedSource = await getDocs(collection(sourceDb, 'users', sourceUid, 'trackedBills'));
  const lockedIds = lockedSource.docs.map((snapshot) => snapshot.id).sort();
  const expectedIds = [...preview.sourceBillIds].sort();
  if (lockedIds.length !== expectedIds.length
    || lockedIds.some((billId, index) => billId !== expectedIds[index])) {
    await updateDoc(ticketRef(targetDb, targetUid, newTicket.id), {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
    });
    await deleteDoc(lockRef(sourceDb, sourceUid));
    const error = new Error('Tracked bills changed while the merge was being confirmed');
    Object.assign(error, { code: 'merge/source-changed' });
    throw error;
  }
  return newTicket.id;
}

export async function runTrackedBillMerge({
  sourceDb,
  targetDb,
  sourceUid,
  targetUid,
  preview,
  onProgress,
  onStage,
}: {
  sourceDb: Firestore;
  targetDb: Firestore;
  sourceUid: string;
  targetUid: string;
  preview: TrackedBillMergePreview;
  onProgress?: (progress: TrackedBillMergeProgress) => void;
  onStage?: (stage: TrackedBillMergeStage) => void;
}): Promise<{ ticketId: string; copiedCount: number; duplicateCount: number }> {
  onStage?.('ticket-check-resume');
  const ticketId = await createOrResumeTicket(sourceDb, targetDb, sourceUid, targetUid, preview, onStage);
  onStage?.('snapshot-copy-read');
  const sourceSnapshot = await getDocs(collection(sourceDb, 'users', sourceUid, 'trackedBills'));
  const totalCount = sourceSnapshot.size;
  let copiedCount = 0;
  let duplicateCount = 0;
  onProgress?.({ totalCount, copiedCount, duplicateCount, phase: 'preparing' });

  onStage?.('ticket-verify');
  const ticket = await getDoc(ticketRef(targetDb, targetUid, ticketId));
  if (!ticket.exists() || ticket.data().status !== 'open') {
    if (ticket.exists() && ticket.data().status === 'complete') {
      onProgress?.({ totalCount, copiedCount: preview.alreadyCopiedCount, duplicateCount: preview.duplicateCount, phase: 'finishing' });
      return { ticketId, copiedCount: preview.alreadyCopiedCount, duplicateCount: preview.duplicateCount };
    }
    throw new Error('The merge ticket is missing, expired, or no longer open');
  }

  for (const sourceDoc of sourceSnapshot.docs) {
    const billId = sourceDoc.id;
    const tracked = sourceDoc.data();
    const exportDocument = exportRef(sourceDb, sourceUid, ticketId, billId);
    onStage?.('snapshot-read');
    const existingExport = await getDoc(exportDocument);
    if (existingExport.exists()) {
      const existingData = existingExport.data();
      if (existingData.sourceUid !== sourceUid || existingData.targetUid !== targetUid
        || existingData.publicBillId !== billId || !sameValue(existingData.tracked, tracked)) {
        throw new Error('A saved merge snapshot does not match the source record');
      }
    } else {
      onStage?.('snapshot-write');
      await setDoc(exportDocument, {
        sourceUid,
        targetUid,
        publicBillId: billId,
        tracked,
        createdAt: serverTimestamp(),
      });
    }

    onStage?.('target-copy');
    const outcome = await runTransaction(targetDb, async (transaction) => {
      const destinationRef = trackedRef(targetDb, targetUid, billId);
      const markerDocument = markerRef(targetDb, targetUid, billId);
      const [destination, marker, exported] = await Promise.all([
        transaction.get(destinationRef),
        transaction.get(markerDocument),
        transaction.get(exportRef(targetDb, sourceUid, ticketId, billId)),
      ]);
      if (!exported.exists() || exported.data().tracked == null) throw new Error('Merge snapshot is unavailable');
      if (destination.exists()) {
        if (marker.exists() && marker.data().ticketId === ticketId) return 'copied' as const;
        return 'duplicate' as const;
      }
      if (marker.exists()) throw new Error('Merge marker exists without its tracked-bill record');

      transaction.set(markerDocument, {
        sourceUid,
        targetUid,
        ticketId,
        publicBillId: billId,
        createdAt: serverTimestamp(),
      });
      transaction.set(destinationRef, exported.data().tracked as DocumentData);
      return 'copied' as const;
    });

    if (outcome === 'copied') copiedCount += 1;
    else duplicateCount += 1;
    onProgress?.({ totalCount, copiedCount, duplicateCount, phase: 'copying' });
  }

  // Completion is recorded only after every source record has a destination or
  // was preserved as an existing destination record.
  onStage?.('ticket-complete');
  await updateDoc(ticketRef(targetDb, targetUid, ticketId), {
    status: 'complete',
    completedAt: serverTimestamp(),
  });
  onProgress?.({ totalCount, copiedCount, duplicateCount, phase: 'finishing' });

  return { ticketId, copiedCount, duplicateCount };
}

export async function mergeTrackedBillsWithConsent({
  confirm,
  onConfirmed,
  ...mergeOptions
}: Parameters<typeof runTrackedBillMerge>[0] & {
  confirm: () => boolean;
  onConfirmed?: () => void;
}): Promise<{ status: 'cancelled' } | ({ status: 'merged' } & Awaited<ReturnType<typeof runTrackedBillMerge>>)> {
  if (!confirm()) return { status: 'cancelled' };
  onConfirmed?.();
  return { status: 'merged', ...(await runTrackedBillMerge(mergeOptions)) };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Timestamp && right instanceof Timestamp) return left.isEqual(right);
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftObject = left as Record<string, unknown>;
    const rightObject = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftObject).sort();
    const rightKeys = Object.keys(rightObject).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(leftObject[key], rightObject[key]));
  }
  return false;
}

export async function cleanupCompletedTrackedBillMerge(
  sourceDb: Firestore,
  targetDb: Firestore,
  sourceUid: string,
  targetUid: string,
  ticketId: string,
): Promise<void> {
  const lock = await getDoc(lockRef(targetDb, sourceUid));
  if (lock.exists() && lock.data().ticketId === ticketId) await deleteDoc(lockRef(targetDb, sourceUid));
  const exports = await getDocs(collection(sourceDb, 'users', sourceUid, 'trackedBillMergeExports', ticketId, 'items'));
  const markers = await getDocs(collection(targetDb, 'users', targetUid, 'trackedBillMergeImports'));
  await Promise.all([
    ...exports.docs.map((snapshot) => deleteDoc(snapshot.ref)),
    ...markers.docs.filter((snapshot) => snapshot.data().ticketId === ticketId)
      .map((snapshot) => deleteDoc(snapshot.ref)),
  ]);
  await deleteDoc(ticketRef(targetDb, targetUid, ticketId));
}
