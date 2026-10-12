/** Explicit DEV-only opt-in; demo config never inherits production identifiers. */
export function identityEmulatorEnabled(development: boolean, flag: unknown): boolean {
  return development && flag === 'true';
}
export const IDENTITY_EMULATOR_PROJECT = 'demo-osatsu-public-serial';
export const IDENTITY_FIRESTORE_PORT = 18080;
export const IDENTITY_AUTH_PORT = 19099;

/** Feature selection is independent of transport and defaults to off. */
export function identityV2Enabled(flag: unknown): boolean { return flag === 'true'; }

export function validIdentityConnection(emulator: boolean, firestoreProject: unknown, authProject: unknown, authEmulatorHost?: string): boolean {
  if (typeof firestoreProject !== 'string' || !firestoreProject || firestoreProject !== authProject) return false;
  return emulator
    ? firestoreProject === IDENTITY_EMULATOR_PROJECT && authEmulatorHost === '127.0.0.1'
    : !firestoreProject.startsWith('demo-') && authEmulatorHost === undefined;
}
