import type { Firestore } from 'firebase/firestore';

export function countTrackedBillDocuments(firestore: Firestore, uid: string): Promise<number>;
