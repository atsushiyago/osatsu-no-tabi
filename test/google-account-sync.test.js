import test from 'node:test';
import assert from 'node:assert/strict';
import { getGoogleSyncState, syncGoogleAccount } from '../src/services/googleAccountSync.js';

test('anonymous and Google-linked users expose the expected sync state', () => {
  assert.equal(getGoogleSyncState({ uid: 'anon', isAnonymous: true, providerData: [] }), 'anonymous');
  assert.equal(getGoogleSyncState({
    uid: 'google',
    isAnonymous: false,
    providerData: [{ providerId: 'google.com' }],
  }), 'linked');
});

test('link success preserves UID and keeps tracked bills under the same UID', async () => {
  const user = { uid: 'anonymous-uid', isAnonymous: true };
  const reads = [];
  const result = await syncGoogleAccount({
    user,
    provider: {},
    link: async (currentUser) => ({ uid: currentUser.uid }),
    signIn: async () => assert.fail('link success must not replace the user'),
    countTrackedBills: async (uid) => { reads.push(uid); return 2; },
    confirmSwitch: () => assert.fail('no switch confirmation is needed'),
  });

  assert.deepEqual(result, { status: 'linked', previousUid: 'anonymous-uid', uid: 'anonymous-uid' });
  assert.deepEqual(reads, []);
  const beforePath = `users/${user.uid}/trackedBills`;
  const afterPath = `users/${result.uid}/trackedBills`;
  assert.equal(afterPath, beforePath);
});

test('credential-already-in-use uses the first popup credential and does not call a second popup', async () => {
  const user = { uid: 'anonymous-uid', isAnonymous: true };
  const authError = { code: 'auth/credential-already-in-use' };
  const credential = { accessToken: 'memory-only-test-token' };
  let extractedError;
  let secondPopupCalls = 0;
  let switchedUid;
  let trackedBillsReloaded = false;
  const result = await syncGoogleAccount({
    user,
    provider: {},
    link: async () => { throw authError; },
    getCredentialFromError: (error) => {
      extractedError = error;
      return credential;
    },
    signInWithCredential: async (receivedCredential) => {
      assert.equal(receivedCredential, credential);
      return { uid: 'google-uid' };
    },
    signInWithPopup: async () => { secondPopupCalls += 1; },
    onUserSwitched: (signedInUser) => {
      switchedUid = signedInUser.uid;
      trackedBillsReloaded = true;
    },
    countTrackedBills: async () => 0,
    confirmSwitch: () => assert.fail('empty anonymous account switches without a warning'),
  });

  assert.equal(extractedError, authError);
  assert.equal(secondPopupCalls, 0);
  assert.equal(switchedUid, 'google-uid');
  assert.equal(trackedBillsReloaded, true);
  assert.deepEqual(result, { status: 'switched', previousUid: 'anonymous-uid', uid: 'google-uid' });
});

test('existing local bills require confirmation before signInWithCredential', async () => {
  const user = { uid: 'anonymous-uid', isAnonymous: true };
  let signInCalls = 0;
  let warningCount = 0;
  const result = await syncGoogleAccount({
    user,
    provider: {},
    link: async () => { throw { code: 'auth/credential-already-in-use' }; },
    getCredentialFromError: () => ({ idToken: 'credential' }),
    signInWithCredential: async () => { signInCalls += 1; return { uid: 'google-uid' }; },
    countTrackedBills: async (uid) => { assert.equal(uid, 'anonymous-uid'); return 3; },
    confirmSwitch: (count) => { warningCount = count; return false; },
  });

  assert.equal(warningCount, 3);
  assert.equal(signInCalls, 0);
  assert.deepEqual(result, { status: 'cancelled', previousUid: 'anonymous-uid', uid: 'anonymous-uid' });
  assert.equal(user.uid, 'anonymous-uid');
});

test('existing local bills switch with signInWithCredential only after confirmation', async () => {
  const user = { uid: 'anonymous-uid', isAnonymous: true };
  const credential = { idToken: 'credential' };
  let confirmationCount = 0;
  let signInCalls = 0;
  const result = await syncGoogleAccount({
    user,
    provider: {},
    link: async () => { throw { code: 'auth/credential-already-in-use' }; },
    getCredentialFromError: () => credential,
    signInWithCredential: async (receivedCredential) => {
      signInCalls += 1;
      assert.equal(receivedCredential, credential);
      return { uid: 'google-uid' };
    },
    countTrackedBills: async () => 2,
    confirmSwitch: (count) => { confirmationCount = count; return true; },
  });

  assert.equal(confirmationCount, 2);
  assert.equal(signInCalls, 1);
  assert.equal(result.status, 'switched');
});

test('account collision with zero local bills switches with signInWithCredential', async () => {
  let signInCalls = 0;
  const credential = { idToken: 'credential' };
  const result = await syncGoogleAccount({
    user: { uid: 'anonymous-uid', isAnonymous: true },
    provider: {},
    link: async () => { throw { code: 'auth/credential-already-in-use' }; },
    getCredentialFromError: () => credential,
    signInWithCredential: async (receivedCredential) => {
      signInCalls += 1;
      assert.equal(receivedCredential, credential);
      return { uid: 'google-uid' };
    },
    countTrackedBills: async () => 0,
    confirmSwitch: () => assert.fail('empty anonymous account switches without a warning'),
  });

  assert.equal(signInCalls, 1);
  assert.deepEqual(result, { status: 'switched', previousUid: 'anonymous-uid', uid: 'google-uid' });
});

test('null credential exposes an explicit popup fallback but never starts it automatically', async () => {
  let credentialSignInCalls = 0;
  let popupCalls = 0;
  const result = await syncGoogleAccount({
    user: { uid: 'anonymous-uid', isAnonymous: true },
    provider: {},
    link: async () => { throw { code: 'auth/account-exists-with-different-credential' }; },
    getCredentialFromError: () => null,
    signInWithCredential: async () => { credentialSignInCalls += 1; return { uid: 'unexpected' }; },
    signInWithPopup: async () => { popupCalls += 1; },
    countTrackedBills: async () => 0,
    confirmSwitch: () => assert.fail('empty account does not need confirmation'),
  });

  assert.equal(result.status, 'popup-fallback');
  assert.equal(credentialSignInCalls, 0);
  assert.equal(popupCalls, 0);
});

test('popup cancellation outside account collision propagates without changing auth state', async () => {
  const user = { uid: 'anonymous-uid', isAnonymous: true };
  await assert.rejects(
    syncGoogleAccount({
      user,
      provider: {},
      link: async () => { throw { code: 'auth/popup-closed-by-user' }; },
      getCredentialFromError: () => assert.fail('popup cancellation is not an account collision'),
      signInWithCredential: async () => assert.fail('cancelled link must not start sign-in'),
      countTrackedBills: async () => assert.fail('cancelled link must not query user data'),
      confirmSwitch: () => assert.fail('cancelled link must not ask to switch'),
    }),
    { code: 'auth/popup-closed-by-user' },
  );
  assert.equal(user.uid, 'anonymous-uid');
});
