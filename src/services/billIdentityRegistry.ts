import type { Auth } from 'firebase/auth';
import {
  collection, doc, getDoc, runTransaction, serverTimestamp, type Firestore,
} from 'firebase/firestore';
import { createBillIdentityKey, validateBillIdentity, type BillIdentity } from '../utils/billIdentity.ts';
import { calculateDistanceKm, getMunicipalityLocation } from '../utils/geo.ts';

export interface IdentityRegistrationInput extends BillIdentity {
  prefecture: string;
  municipality: string;
  userNote?: string;
  // UI acknowledgement only; Rules never treat this as proof of identity.
  legacyAcknowledgedBillId?: string;
}

export type IdentityRegistrationResult =
  | { status: 'registered' | 'rediscovered' | 'recently-recorded'; publicBillId: string; sightingsCount: number }
  | { status: 'legacy-ambiguous'; legacyPublicBillId: string };

export class IdentityRegistrationError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function nextRate(rate: Record<string, any> | null, publicBillId: string, sightingId: string) {
  const now = Date.now();
  const shortExpired = !rate || now - rate.shortWindowStartedAt.toMillis() >= 10 * 60_000;
  const dailyExpired = !rate || now - rate.dailyWindowStartedAt.toMillis() >= 24 * 60 * 60_000;
  if (!shortExpired && rate!.shortCount >= 10) throw new IdentityRegistrationError('short-rate-limit');
  if (!dailyExpired && rate!.dailyCount >= 50) throw new IdentityRegistrationError('daily-rate-limit');
  return {
    shortWindowStartedAt: shortExpired ? serverTimestamp() : rate!.shortWindowStartedAt,
    shortCount: shortExpired ? 1 : rate!.shortCount + 1,
    dailyWindowStartedAt: dailyExpired ? serverTimestamp() : rate!.dailyWindowStartedAt,
    dailyCount: dailyExpired ? 1 : rate!.dailyCount + 1,
    updatedAt: serverTimestamp(), lastOperationPublicBillId: publicBillId,
    lastOperationSightingId: sightingId,
  };
}

/** Stage 2 is intentionally isolated from the live app and accepts demo emulators only. */
export async function registerBillIdentityV2InEmulator(
  firestore: Firestore,
  auth: Auth,
  input: IdentityRegistrationInput,
): Promise<IdentityRegistrationResult> {
  const projectId = firestore.app.options.projectId;
  if (!projectId?.startsWith('demo-') || auth.app.options.projectId !== projectId
    || !auth.emulatorConfig || !['127.0.0.1', 'localhost', '::1'].includes(auth.emulatorConfig.host)) {
    throw new IdentityRegistrationError('emulator-only');
  }
  return registerBillIdentityV2(firestore, auth, input);
}

/** Shared transaction. Server Rules/config remain authoritative for every client. */
export async function registerBillIdentityV2(
  firestore: Firestore, auth: Auth, input: IdentityRegistrationInput,
): Promise<IdentityRegistrationResult> {
  if (!firestore.app.options.projectId || firestore.app !== auth.app) {
    throw new IdentityRegistrationError('invalid-connection');
  }
  const uid = auth.currentUser?.uid;
  if (!uid) throw new IdentityRegistrationError('unauthenticated');
  const validation = validateBillIdentity(input);
  if (validation.isValid === false) throw new IdentityRegistrationError(validation.code);
  const identity = validation.identity;
  const identityKey = createBillIdentityKey(identity);
  if (!getMunicipalityLocation(input.prefecture, input.municipality)) {
    throw new IdentityRegistrationError('invalid-location');
  }
  if (input.userNote && /[A-Z]{1,2}[0-9]{6}[A-Z]/.test(input.userNote.normalize('NFKC').toUpperCase().replace(/[\s-]/g, ''))) {
    throw new IdentityRegistrationError('private-serial-note');
  }
  const candidateId = crypto.randomUUID();
  const sightingRef = doc(collection(firestore, 'sightings'));
  const indexRef = doc(firestore, 'billIdentityIndex', identityKey);
  const legacyRef = doc(firestore, 'serialIndex', identity.serialNumber);
  const rateRef = doc(firestore, 'rateLimits', uid);
  let initiallyMissing = false;
  try {
    return await runTransaction(firestore, async (tx) => {
      const [index, legacy, rate, config] = await Promise.all([
        tx.get(indexRef), tx.get(legacyRef), tx.get(rateRef),
        tx.get(doc(firestore, 'appConfig', 'billRegistration')),
      ]);
      if (config.data()?.mode !== 'v2' || config.data()?.identityVersion !== 2) {
        throw new IdentityRegistrationError('registration-paused');
      }
      if (auth.currentUser?.uid !== uid) throw new IdentityRegistrationError('auth-user-changed');
      initiallyMissing = !index.exists();
      const publicBillId = index.exists() ? index.data().publicBillId : candidateId;
      if (typeof publicBillId !== 'string') throw new IdentityRegistrationError('inconsistent-index');
      const billRef = doc(firestore, 'publicBills', publicBillId);
      const trackedRef = doc(firestore, 'users', uid, 'trackedBills', publicBillId);
      const [bill, tracked] = await Promise.all([tx.get(billRef), tx.get(trackedRef)]);
      const current = bill.data();
      if (index.exists()) {
        if (!current || current.identityVersion !== 2 || current.id !== publicBillId
          || current.denomination !== identity.denomination || current.series !== identity.series
          || current.serialColor !== identity.serialColor
          || index.data().identityVersion !== 2
          || createBillIdentityKey(index.data()) !== identityKey) {
          throw new IdentityRegistrationError('inconsistent-index');
        }
        if (Date.now() - current.lastSightedAtServer.toMillis() < 15 * 60_000) {
          return { status: 'recently-recorded', publicBillId, sightingsCount: current.sightingsCount };
        }
      } else if (bill.exists() || tracked.exists()) {
        throw new IdentityRegistrationError('uuid-collision');
      }
      if (!index.exists() && legacy.exists()) {
        const legacyId = legacy.data().publicBillId;
        if (typeof legacyId !== 'string') throw new IdentityRegistrationError('inconsistent-legacy-index');
        const legacyBill = await tx.get(doc(firestore, 'publicBills', legacyId));
        if (!legacyBill.exists()) throw new IdentityRegistrationError('inconsistent-legacy-index');
        if (legacyBill.data().denomination === identity.denomination
          && input.legacyAcknowledgedBillId !== legacyId) {
          return { status: 'legacy-ambiguous', legacyPublicBillId: legacyId };
        }
      }
      const previous = current?.lastSightingId
        ? (await tx.get(doc(firestore, 'sightings', current.lastSightingId))).data() : undefined;
      if (current && !previous) throw new IdentityRegistrationError('inconsistent-history');
      if (tracked.exists() && (tracked.data().identityVersion !== 2
        || createBillIdentityKey(tracked.data()) !== identityKey)) {
        throw new IdentityRegistrationError('inconsistent-tracked-identity');
      }
      const now = new Date().toISOString();
      const step = current ? current.sightingsCount + 1 : 1;
      const previousLocation = previous && getMunicipalityLocation(previous.prefecture, previous.municipality);
      const location = getMunicipalityLocation(input.prefecture, input.municipality)!;
      const distance = previousLocation
        ? calculateDistanceKm(previousLocation.lat, previousLocation.lng, location.lat, location.lng) : 0;
      const days = previous ? Math.max(0, Math.round((Date.parse(now) - Date.parse(previous.createdAt)) / 86_400_000)) : 0;
      const rateData = nextRate(rate.data() ?? null, publicBillId, sightingRef.id);
      const { serialNumber: _privateSerial, ...publicIdentity } = identity;
      if (!current) {
        tx.set(indexRef, { identityVersion: 2, ...identity, publicBillId, createdAt: serverTimestamp() });
        tx.set(doc(firestore, 'billIdentities', publicBillId), {
          identityVersion: 2, ...identity, publicBillId, identityKey, createdAt: serverTimestamp(),
        });
        tx.set(billRef, {
          identityVersion: 2, ...publicIdentity, id: publicBillId, createdAt: now, updatedAt: now,
          firstSightedAt: now, lastSightedAt: now, sightingsCount: 1, totalDistanceKm: 0,
          lastSightedAtServer: serverTimestamp(), lastMunicipality: input.municipality, lastSightingId: sightingRef.id,
        });
      } else {
        tx.update(billRef, {
          updatedAt: now, lastSightedAt: now, sightingsCount: step,
          totalDistanceKm: current.totalDistanceKm + distance,
          lastSightedAtServer: serverTimestamp(), lastMunicipality: input.municipality, lastSightingId: sightingRef.id,
        });
      }
      tx.set(sightingRef, {
        identityVersion: 2, id: sightingRef.id, publicBillId, step,
        prefecture: input.prefecture, municipality: input.municipality, createdAt: now,
        distanceFromPrevKm: distance, daysFromPrev: days,
        ...(input.userNote?.trim() ? { userNote: input.userNote.trim() } : {}),
      });
      if (!tracked.exists()) {
        tx.set(trackedRef, {
          identityVersion: 2, ...identity, publicBillId, createdAt: serverTimestamp(),
          firstRegisteredByMe: !current, notifyOnRediscovery: false,
          lastSeenSightingsCount: step, lastSeenAt: serverTimestamp(), lastSeenMunicipality: input.municipality,
          ...(!current && input.legacyAcknowledgedBillId ? { legacyAcknowledgedBillId: input.legacyAcknowledgedBillId } : {}),
        });
      } else {
        tx.update(trackedRef, {
          lastSeenSightingsCount: step, lastSeenAt: serverTimestamp(), lastSeenMunicipality: input.municipality,
        });
      }
      tx.set(rateRef, rateData);
      return { status: current ? 'rediscovered' : 'registered', publicBillId, sightingsCount: step };
    });
  } catch (error) {
    // Some emulator commit conflicts are permission-denied because immutable-index
    // Rules see the competing commit first. Resolve only a demonstrable creation
    // race; never retry arbitrary denied writes or suppress the original failure.
    if (initiallyMissing && (error as { code?: string }).code === 'permission-denied') {
      const winner = await getDoc(indexRef);
      const winnerData = winner.data();
      if (winnerData && winnerData.identityVersion === 2
        && winnerData.publicBillId !== candidateId
        && createBillIdentityKey(winnerData) === identityKey) {
        const winnerBill = (await getDoc(doc(firestore, 'publicBills', winnerData.publicBillId))).data();
        if (winnerBill?.identityVersion === 2 && winnerBill.denomination === identity.denomination
          && winnerBill.series === identity.series && winnerBill.serialColor === identity.serialColor
          && winnerBill.sightingsCount >= 1
          && Date.now() - winnerBill.lastSightedAtServer.toMillis() < 15 * 60_000) {
          return { status: 'recently-recorded', publicBillId: winnerData.publicBillId, sightingsCount: winnerBill.sightingsCount };
        }
      }
    }
    throw error;
  }
}
