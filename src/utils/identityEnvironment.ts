/** Explicit DEV-only opt-in; demo config never inherits production identifiers. */
export function identityEmulatorEnabled(development: boolean, flag: unknown): boolean {
  return development && flag === 'true';
}
export const IDENTITY_EMULATOR_PROJECT = 'demo-osatsu-public-serial';
export const QA_FIREBASE_PROJECT_ID = 'osatsu-no-tabi-qa';
export const IDENTITY_FIRESTORE_PORT = 18080;
export const IDENTITY_AUTH_PORT = 19099;

/** Feature selection is independent of transport and defaults to off. */
export function identityV2Enabled(flag: unknown): boolean { return flag === 'true'; }

/** In QA mode, fail closed if the app points at any project or transport other than QA. */
export function validQaFirebaseEnvironment(mode: unknown, projectId: unknown, emulatorFlag: unknown, v2Flag: unknown): boolean {
  return mode !== 'qa' || (
    projectId === QA_FIREBASE_PROJECT_ID &&
    emulatorFlag !== 'true' &&
    v2Flag === 'true'
  );
}

export function validIdentityConnection(emulator: boolean, firestoreProject: unknown, authProject: unknown, authEmulatorHost?: string, expectedEmulatorHost = '127.0.0.1'): boolean {
  if (typeof firestoreProject !== 'string' || !firestoreProject || firestoreProject !== authProject) return false;
  return emulator
    ? firestoreProject === IDENTITY_EMULATOR_PROJECT && authEmulatorHost === expectedEmulatorHost && (expectedEmulatorHost === '127.0.0.1' || isIdentityLanAddress(expectedEmulatorHost))
    : !firestoreProject.startsWith('demo-') && authEmulatorHost === undefined;
}

/** Only literal RFC1918 IPv4 addresses, never public/DNS/wildcard hosts. */
export function isIdentityLanAddress(host: unknown): host is string {
  if (typeof host !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  const parts = host.split('.').map(Number);
  if (parts.some((n, i) => n > 255 || String(n) !== host.split('.')[i])) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

export function identityEmulatorEndpoint(development: boolean, flag: unknown, lanHost: unknown) {
  if (!development || lanHost === undefined || lanHost === '') return { host: '127.0.0.1', firestorePort: IDENTITY_FIRESTORE_PORT, authPort: IDENTITY_AUTH_PORT };
  if (!identityEmulatorEnabled(development, flag) || !isIdentityLanAddress(lanHost)) throw new Error('LAN demo transport requires explicit Emulator opt-in and a private IPv4 address');
  // One LAN Vite port proxies both services; Emulators stay loopback-only.
  return { host: lanHost, firestorePort: 5174, authPort: 5174 };
}
