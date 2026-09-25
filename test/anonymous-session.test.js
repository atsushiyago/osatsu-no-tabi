import test from 'node:test';
import assert from 'node:assert/strict';
import { getOrCreateAnonymousUser } from '../src/services/anonymousSession.js';

test('reuses the persisted anonymous user and coalesces parallel sign-ins', async () => {
  const auth = { currentUser: null };
  const user = { uid: 'anonymous-uid', isAnonymous: true };
  let signInCalls = 0;
  const signIn = async () => {
    signInCalls += 1;
    await Promise.resolve();
    auth.currentUser = user;
    return { user };
  };

  const [first, concurrent] = await Promise.all([
    getOrCreateAnonymousUser(auth, signIn),
    getOrCreateAnonymousUser(auth, signIn),
  ]);
  const persisted = await getOrCreateAnonymousUser(auth, async () => {
    throw new Error('must reuse currentUser');
  });

  assert.equal(signInCalls, 1);
  assert.equal(first.uid, user.uid);
  assert.equal(concurrent.uid, user.uid);
  assert.equal(persisted.uid, user.uid);
});
