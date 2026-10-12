import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, doc, getDoc, getFirestore,
  serverTimestamp, Timestamp, terminate, writeBatch,
} from 'firebase/firestore';

export const projectId = 'demo-osatsu-public-serial';
export const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:18080';
export const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:19099';
if (![firestoreHost, authHost].every((host) => /^127\.0\.0\.1:[0-9]+$/.test(host))) {
  throw new Error('Emulator helpers require loopback hosts');
}
let sequence = 1000;
const clients = [];
export const serial = () => `TX${String(sequence++).padStart(6, '0')}A`;
export const opaque = () => crypto.randomUUID();
export const rawKey = (identity) => `v2_JPY_${identity.denomination}_${identity.series}_${identity.serialColor}_${identity.serialNumber}`;

export async function client(name, authenticated = true, project = projectId, port = Number(firestoreHost.split(':')[1])) {
  if (!project.startsWith('demo-')) throw new Error('Only demo projects are permitted');
  const app = initializeApp({ projectId: project, apiKey: 'fake-api-key' }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', port);
  if (authenticated) await signInAnonymously(auth);
  clients.push({ app, db });
  return { db, auth, uid: auth.currentUser?.uid, projectId: project };
}

export async function closeClients() {
  const closing = clients.splice(0);
  await Promise.all(closing.map(async ({ app, db }) => { await terminate(db); await deleteApp(app); }));
}

function encode(value) {
  if (value instanceof Date || value instanceof Timestamp) return { timestampValue: value.toISOString?.() ?? value.toDate().toISOString() };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  throw new Error('Unsupported emulator fixture value');
}
function decode(value) {
  if ('timestampValue' in value) return Timestamp.fromDate(new Date(value.timestampValue));
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  return value.stringValue;
}
export async function adminSet(path, data, project = projectId, patch = false) {
  if (!project.startsWith('demo-')) throw new Error('Only demo projects are permitted');
  const query = patch ? `?${Object.keys(data).map((key) => `updateMask.fieldPaths=${key}`).join('&')}` : '';
  const response = await fetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/${path}${query}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])) }),
  });
  if (!response.ok) throw new Error(`Emulator seed failed: ${response.status}`);
}
export async function adminGet(path, project = projectId) {
  const response = await fetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Emulator inspection failed: ${response.status}`);
  return Object.fromEntries(Object.entries((await response.json()).fields ?? {}).map(([key, value]) => [key, decode(value)]));
}
export async function adminDelete(path, project = projectId) {
  const response = await fetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/${path}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer owner' },
  });
  if (!response.ok && response.status !== 404) throw new Error(`Emulator delete failed: ${response.status}`);
}

export async function loadRules(content, project) {
  if (!project.startsWith('demo-')) throw new Error('Only demo projects are permitted');
  const response = await fetch(`http://${firestoreHost}/emulator/v1/projects/${project}:securityRules`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!response.ok) throw new Error(`Emulator rule load failed: ${response.status} ${await response.text()}`);
}

export async function clearDemoProject(project) {
  if (!project.startsWith('demo-')) throw new Error('Only demo projects are permitted');
  const response = await fetch(`http://${firestoreHost}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Emulator reset failed: ${response.status}`);
}
export async function resetRate(c) {
  const old = new Date('2000-01-01T00:00:00Z');
  const data = await adminGet(`rateLimits/${c.uid}`, c.projectId);
  if (data) await adminSet(`rateLimits/${c.uid}`, { shortWindowStartedAt: old, dailyWindowStartedAt: old }, c.projectId, true);
}
export async function ageBill(id, project = projectId) {
  await adminSet(`publicBills/${id}`, { lastSightedAtServer: new Date('2000-01-01T00:00:00Z') }, project, true);
}

/** Raw SDK writes deliberately bypass the validated service for adversarial tests. */
export async function plan(c, identity = { denomination: 1000, series: 'E', serialColor: 'black', serialNumber: serial() }, options = {}) {
  const key = options.key ?? rawKey(identity);
  const index = await getDoc(doc(c.db, 'billIdentityIndex', key));
  const id = options.id ?? index.data()?.publicBillId ?? opaque();
  const current = (await getDoc(doc(c.db, 'publicBills', id))).data();
  const tracked = (await getDoc(doc(c.db, 'users', c.uid, 'trackedBills', id))).data();
  const rate = (await getDoc(doc(c.db, 'rateLimits', c.uid))).data();
  const sightingId = options.sightingId ?? doc(collection(c.db, 'sightings')).id;
  const now = new Date().toISOString();
  const step = current ? current.sightingsCount + 1 : 1;
  const full = { identityVersion: 2, ...identity };
  const { serialNumber: _serial, ...visible } = full;
  const shortExpired = !rate || Date.now() - rate.shortWindowStartedAt.toMillis() >= 10 * 60_000;
  const dailyExpired = !rate || Date.now() - rate.dailyWindowStartedAt.toMillis() >= 24 * 60 * 60_000;
  const commonBill = {
    ...visible, id, updatedAt: now, lastSightedAt: now, sightingsCount: step,
    totalDistanceKm: current?.totalDistanceKm ?? 0, lastSightedAtServer: serverTimestamp(),
    lastMunicipality: '千代田区', lastSightingId: sightingId,
  };
  const entries = [];
  if (!index.exists() || options.forceIndexes) {
    entries.push({ role: 'index', path: `billIdentityIndex/${key}`, data: { ...full, publicBillId: id, createdAt: serverTimestamp() } });
    entries.push({ role: 'reverse', path: `billIdentities/${id}`, data: { ...full, identityKey: key, publicBillId: id, createdAt: serverTimestamp() } });
  }
  entries.push({ role: 'bill', path: `publicBills/${id}`, data: {
    ...(current ?? { createdAt: now, firstSightedAt: now }), ...commonBill,
  } });
  entries.push({ role: 'sighting', path: `sightings/${sightingId}`, data: {
    identityVersion: 2, id: sightingId, publicBillId: id, step,
    prefecture: '東京都', municipality: '千代田区', createdAt: now, distanceFromPrevKm: 0, daysFromPrev: 0,
  } });
  entries.push({ role: 'tracked', path: `users/${c.uid}/trackedBills/${id}`, data: {
    ...(tracked ?? { ...full, publicBillId: id, createdAt: serverTimestamp(), firstRegisteredByMe: !current, notifyOnRediscovery: false }),
    lastSeenSightingsCount: step, lastSeenAt: serverTimestamp(), lastSeenMunicipality: '千代田区',
  } });
  entries.push({ role: 'rate', path: `rateLimits/${c.uid}`, data: {
    shortWindowStartedAt: shortExpired ? serverTimestamp() : rate.shortWindowStartedAt,
    shortCount: shortExpired ? 1 : rate.shortCount + 1,
    dailyWindowStartedAt: dailyExpired ? serverTimestamp() : rate.dailyWindowStartedAt,
    dailyCount: dailyExpired ? 1 : rate.dailyCount + 1,
    updatedAt: serverTimestamp(), lastOperationPublicBillId: id, lastOperationSightingId: sightingId,
  } });
  return { id, key, sightingId, identity, entries };
}

export async function commit(c, operation, entries = operation.entries) {
  const batch = writeBatch(c.db);
  for (const entry of entries) batch.set(doc(c.db, entry.path), entry.data);
  await batch.commit();
}
