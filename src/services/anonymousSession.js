/** @type {WeakMap<object, Promise<import('firebase/auth').User>>} */
const pendingSignIns = new WeakMap();

/**
 * Reuses the Auth user's persisted session and coalesces simultaneous startup calls.
 * @param {import('firebase/auth').Auth} auth
 * @param {(auth: import('firebase/auth').Auth) => Promise<import('firebase/auth').UserCredential>} signIn
 */
export function getOrCreateAnonymousUser(auth, signIn) {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  const pending = pendingSignIns.get(auth);
  if (pending) return pending;
  const request = signIn(auth).then(({ user }) => user).finally(() => {
    pendingSignIns.delete(auth);
  });
  pendingSignIns.set(auth, request);
  return request;
}
