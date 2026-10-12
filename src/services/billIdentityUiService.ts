import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db, ensureAnonymousUser, isIdentityV2Enabled, useFirebaseEmulators, emulatorEndpoint } from './firebase';
import { createBillIdentityKey, type BillIdentity } from '../utils/billIdentity';
import { readIdentityCandidates } from '../utils/identitySearch';
import { IdentityRegistrationError, registerBillIdentityV2, type IdentityRegistrationInput } from './billIdentityRegistry';
import { getPublicBillById } from './billService';
import type { Bill, RegisterResult } from '../types';
import { IDENTITY_EMULATOR_PROJECT, validIdentityConnection } from '../utils/identityEnvironment';

function identityContext() {
  if (!isIdentityV2Enabled) throw new IdentityRegistrationError('registration-paused');
  if (!db || !auth || !validIdentityConnection(useFirebaseEmulators, db.app.options.projectId,
    auth.app.options.projectId, auth.emulatorConfig?.host, emulatorEndpoint.host)) {
    throw new IdentityRegistrationError('invalid-connection');
  }
  return { db, auth };
}

export async function assertIdentityReady() {
  identityContext();
  if (useFirebaseEmulators) {
    // No production URLs or keys are used by emulator probes. Missing registration
    // config must not prevent read-only searches; the transaction rejects writes.
    const paths = [
      `http://${emulatorEndpoint.host}:${emulatorEndpoint.authPort}/emulator/v1/projects/${IDENTITY_EMULATOR_PROJECT}/config`,
      `http://${emulatorEndpoint.host}:${emulatorEndpoint.firestorePort}/v1/projects/${IDENTITY_EMULATOR_PROJECT}/databases/(default)/documents/appConfig/billRegistration`,
    ];
    try {
      const [authResponse, firestoreResponse] = await Promise.all(paths.map((url) => fetch(url, { signal: AbortSignal.timeout(3000), cache: 'no-store' })));
      if (!authResponse.ok || (!firestoreResponse.ok && firestoreResponse.status !== 404)) throw new Error('not-ready');
    } catch { throw new IdentityRegistrationError('emulator-unavailable'); }
  }
  await ensureAnonymousUser();
}

export interface IdentityCandidate {
  bill: Bill;
  legacy: boolean;
}

async function readCandidate(path: string): Promise<IdentityCandidate | null> {
  const { db } = identityContext();
  const index = await getDocFromServer(doc(db, path));
  if (!index.exists()) return null;
  const data = index.data();
  const id = data.publicBillId;
  if (typeof id !== 'string') throw new IdentityRegistrationError('inconsistent-index');
  const snapshot = await getDocFromServer(doc(db, 'publicBills', id));
  if (!snapshot.exists()) throw new IdentityRegistrationError('inconsistent-index');
  const bill = { ...snapshot.data(), id } as Bill;
  const legacy = path.startsWith('serialIndex/');
  if (!legacy && (bill.identityVersion !== 2 || data.identityVersion !== 2
    || createBillIdentityKey(data) !== path.split('/')[1]
    || bill.denomination !== data.denomination || bill.series !== data.series || bill.serialColor !== data.serialColor)) {
    throw new IdentityRegistrationError('inconsistent-index');
  }
  return { bill, legacy };
}

export async function searchBillIdentities(raw: string): Promise<IdentityCandidate[]> {
  await assertIdentityReady();
  const candidates = await readIdentityCandidates(raw, readCandidate);
  return candidates.filter((item, index) => candidates.findIndex((other) => other.bill.id === item.bill.id) === index);
}

export async function findExactBillIdentity(identity: BillIdentity) {
  await assertIdentityReady();
  const candidate = await readCandidate(`billIdentityIndex/${createBillIdentityKey(identity)}`);
  return candidate ? getPublicBillById(candidate.bill.id) : null;
}

export async function registerIdentityForUi(input: IdentityRegistrationInput) {
  await assertIdentityReady();
  const { db, auth } = identityContext();
  const operation = await registerBillIdentityV2(db, auth, input);
  if (operation.status === 'legacy-ambiguous') return operation;
  if (operation.status === 'recently-recorded') return { ...operation, status: 'recently-recorded' as const };
  // Use the actual transaction's step, not a later concurrent discovery.
  const complete = await getPublicBillById(operation.publicBillId);
  const sighting = complete?.sightings.find((item) => item.step === operation.sightingsCount);
  if (!complete || !sighting) throw new IdentityRegistrationError('registered-result-unavailable');
  const result: RegisterResult = {
    isRediscovery: operation.status === 'rediscovered', bill: complete, newSighting: sighting,
    allSightings: complete.sightings, sightingsCount: operation.sightingsCount,
    distanceFromPrevKm: sighting.distanceFromPrevKm ?? 0, daysFromPrev: sighting.daysFromPrev ?? 0,
  };
  return { status: 'complete' as const, result };
}
