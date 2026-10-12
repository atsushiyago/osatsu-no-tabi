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
}) {
  const anonymousUid = user.uid;
  try {
    const linkedUser = await link(user, provider);
    if (linkedUser.uid !== anonymousUid) {
      throw new Error('Google link unexpectedly changed the Firebase UID');
    }
    return { status: 'linked', previousUid: anonymousUid, uid: linkedUser.uid };
  } catch (error) {
    if (!['auth/credential-already-in-use', 'auth/account-exists-with-different-credential'].includes(error?.code)) {
      throw error;
    }

    const credential = getCredentialFromError(error);
    const trackedBillCount = await countTrackedBills(anonymousUid);
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
  return translate(language, 'googleGenericError');
}
