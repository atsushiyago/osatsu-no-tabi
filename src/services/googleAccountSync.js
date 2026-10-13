import { translate } from '../i18n.ts';

export function getGoogleSyncState(user) {
  if (!user) return 'unavailable';
  if (user.isAnonymous) return 'anonymous';
  return user.providerData?.some((provider) => provider.providerId === 'google.com')
    ? 'linked'
    : 'other';
}

/**
 * Links Google to the current anonymous user. On an account collision, the
 * caller must explicitly confirm switching before sign-in can replace it.
 */
export async function syncGoogleAccount({
  user,
  provider,
  link,
  getCredentialFromError,
  signInWithCredential,
  onUserSwitched,
  countTrackedBills,
  confirmSwitch,
  handleExistingAccount,
  onStage,
}) {
  const anonymousUid = user.uid;
  try {
    onStage?.('link-popup');
    const linkedUser = await link(user, provider);
    if (linkedUser.uid !== anonymousUid) {
      throw new Error('Google link unexpectedly changed the Firebase UID');
    }
    return { status: 'linked', previousUid: anonymousUid, uid: linkedUser.uid };
  } catch (error) {
    if (!['auth/credential-already-in-use', 'auth/account-exists-with-different-credential'].includes(error?.code)) {
      throw error;
    }

    onStage?.('collision-credential-extraction');
    const credential = getCredentialFromError(error);
    onStage?.(credential ? 'collision-credential-ready' : 'collision-credential-missing');
    if (handleExistingAccount) {
      return handleExistingAccount({ credential, previousUid: anonymousUid });
    }
    let trackedBillCount;
    try {
      trackedBillCount = await countTrackedBills(anonymousUid);
    } catch {
      const error = new Error('Could not verify tracked bills before switching accounts');
      error.code = 'auth/tracked-bills-check-failed';
      throw error;
    }
    if (trackedBillCount > 0 && !confirmSwitch(trackedBillCount)) {
      return { status: 'cancelled', previousUid: anonymousUid, uid: anonymousUid };
    }

    if (!credential) {
      return { status: 'popup-fallback', previousUid: anonymousUid, uid: anonymousUid };
    }

    const signedInUser = await signInWithCredential(credential);
    onUserSwitched?.(signedInUser);
    return { status: 'switched', previousUid: anonymousUid, uid: signedInUser.uid };
  }
}

export function getGoogleSyncErrorMessage(error, language = 'ja') {
  const code = error?.code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  if (code === 'auth/popup-blocked') return translate(language, 'googlePopupBlocked');
  if (code === 'auth/network-request-failed') return translate(language, 'googleNetworkError');
  if (code === 'auth/operation-not-allowed') return translate(language, 'googleNotEnabled');
  if (code === 'auth/unauthorized-domain') return translate(language, 'googleUnauthorizedDomain');
  if (code === 'auth/tracked-bills-check-failed') return translate(language, 'googleTrackedBillsCheckFailed');
  if (code === 'merge/check-failed') return translate(language, 'mergeCheckError');
  if (code === 'unavailable') return translate(language, 'googleNetworkError');
  if (code === 'merge/active-for-another-account') return translate(language, 'mergeActiveOther');
  if (code === 'merge/source-changed') return translate(language, 'mergeSourceChanged');
  if (code === 'merge/failed') return translate(language, 'mergeFailed');
  return translate(language, 'googleGenericError');
}
