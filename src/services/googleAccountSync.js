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

export function getGoogleSyncErrorMessage(error) {
  const code = error?.code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  if (code === 'auth/popup-blocked') return 'Google認証の画面を開けませんでした。ポップアップを許可して、もう一度お試しください。';
  if (code === 'auth/network-request-failed') return '通信に失敗しました。ネットワークを確認して、もう一度お試しください。';
  if (code === 'auth/operation-not-allowed') return 'Googleログインがまだ有効になっていません。時間をおいて再度お試しください。';
  if (code === 'auth/unauthorized-domain') return 'このサイトではGoogleログインを利用できません。管理者へお問い合わせください。';
  return 'Googleとの同期に失敗しました。時間をおいて再度お試しください。';
}
