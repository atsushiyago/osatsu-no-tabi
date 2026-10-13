import { collection, getCountFromServer } from 'firebase/firestore';

/** Counts every private tracking record for account-switch protection. */
export async function countTrackedBillDocuments(firestore, uid) {
  const trackedRef = collection(firestore, 'users', uid, 'trackedBills');
  const snapshot = await getCountFromServer(trackedRef);
  return snapshot.data().count;
}
