import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Compass, PlusCircle, Search, WalletCards } from 'lucide-react';
import type { FirebaseError } from 'firebase/app';
import { GoogleAuthProvider, linkWithPopup, signInWithCredential, signInWithPopup, signOut, type AuthCredential } from 'firebase/auth';
import { HomeView } from './components/HomeView';
import { RegisterView } from './components/RegisterView';
import { SearchView } from './components/SearchView';
import { BillDetailView } from './components/BillDetailView';
import { CelebrationModal } from './components/CelebrationModal';
import type { RegisterResult } from './types';
import { auth, db, emulatorEndpoint, getGoogleMergeContext, isFirebaseConfigured, useFirebaseEmulators } from './services/firebase';
import { TimingMonitor } from './components/TimingMonitor';
import { TrackedBillsView } from './components/TrackedBillsView';
import { PublicBillsView } from './components/PublicBillsView';
import { ensureAnonymousUser, observeAuthState } from './services/firebase';
import { getTrackedBills, getTrackedBillsCount, type TrackedBillRow } from './services/trackedBills';
import { getGoogleSyncErrorMessage, getGoogleSyncState, syncGoogleAccount } from './services/googleAccountSync.js';
import { cleanupCompletedTrackedBillMerge, mergeTrackedBillsWithConsent, previewTrackedBillMerge, type TrackedBillMergePreview, type TrackedBillMergeProgress, type TrackedBillMergeStage } from './services/trackedBillMerge';
import { useI18n } from './useI18n';
import { IDENTITY_EMULATOR_PROJECT } from './utils/identityEnvironment';

type ViewMode = 'home' | 'register' | 'search' | 'bill' | 'tracked' | 'bills';
type TrackedBillsLoadResult = {
  uid: string;
  refreshKey: number;
  rows: TrackedBillRow[] | null;
  error: boolean;
};
type BillReturnContext = {
  hash: string;
  publicBillId: string;
  visibleCount: number | null;
  trackedListKind: 'registered' | 'following' | null;
};
type GoogleSyncDiagnostic = { stage: string; code: string | null };

export function App() {
  const { language, setLanguage, t } = useI18n();
  const [currentView, setCurrentView] = useState<ViewMode>('home');
  const [selectedPublicBillId, setSelectedPublicBillId] = useState<string>('');
  const [registerInitialSerial, setRegisterInitialSerial] = useState<string>('');
  const [celebrationResult, setCelebrationResult] = useState<RegisterResult | null>(null);
  const [authUid, setAuthUid] = useState<string | null>(null);
  const [authIsAnonymous, setAuthIsAnonymous] = useState(false);
  const [authIsGoogleLinked, setAuthIsGoogleLinked] = useState(false);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googleSyncError, setGoogleSyncError] = useState<string | null>(null);
  const [googlePopupFallbackAvailable, setGooglePopupFallbackAvailable] = useState(false);
  const [googleMergeProgress, setGoogleMergeProgress] = useState<TrackedBillMergeProgress | null>(null);
  const [googleMergeResumeAvailable, setGoogleMergeResumeAvailable] = useState(false);
  const [googleSyncDiagnostic, setGoogleSyncDiagnostic] = useState<GoogleSyncDiagnostic | null>(null);
  const googleSyncStageRef = useRef('idle');
  const pendingMergeRef = useRef<{ credential: AuthCredential; sourceUid: string } | null>(null);
  const [authReady, setAuthReady] = useState(!auth);
  const [trackingNotice, setTrackingNotice] = useState(false);
  const [registrationCompletedBillId, setRegistrationCompletedBillId] = useState<string | null>(null);
  const [registrationTrackedBillsAvailable, setRegistrationTrackedBillsAvailable] = useState(false);
  const [trackedBillsRefreshKey, setTrackedBillsRefreshKey] = useState(0);
  const [trackedBillsResult, setTrackedBillsResult] = useState<TrackedBillsLoadResult | null>(null);
  const [billReturnForRestore, setBillReturnForRestore] = useState<BillReturnContext | null>(null);
  const [routeRevision, setRouteRevision] = useState(0);
  const billReturnRef = useRef<BillReturnContext | null>(null);
  const lastHandledLocationRef = useRef<string | null>(null);

  const reportGoogleSyncStage = (stage: string, error?: unknown) => {
    googleSyncStageRef.current = stage;
    if (!import.meta.env.DEV || !useFirebaseEmulators) return;
    const rawCode = (error as { code?: unknown } | null)?.code;
    const code = typeof rawCode === 'string' && /^[a-z0-9/-]+$/i.test(rawCode) ? rawCode : error ? 'unknown' : null;
    setGoogleSyncDiagnostic({ stage, code });
    // Deliberately log only a phase and sanitized Firebase error code.
    console.info('[Google sync diagnostic]', { stage, code });
  };

  const reportGoogleMergeStage = (stage: TrackedBillMergeStage) => reportGoogleSyncStage(`merge-${stage}`);

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return;
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        left: window.scrollX,
        behavior: 'auto',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentView, routeRevision]);

  useEffect(() => {
    const unsubscribe = observeAuthState((user) => {
      setAuthUid(user?.uid ?? null);
      const syncState = getGoogleSyncState(user);
      setAuthIsAnonymous(syncState === 'anonymous');
      setAuthIsGoogleLinked(syncState === 'linked');
      setAuthReady(true);
      if (!user) {
        void ensureAnonymousUser().catch((error) => {
          console.warn('Anonymous Auth unavailable; this-device bill list is disabled:', error);
        });
      }
    }, (error) => {
      console.warn('Firebase Auth state unavailable; public features remain enabled:', error);
      setAuthUid(null);
      setAuthReady(true);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (currentView !== 'home') return;
    if (!authUid) return;
    let active = true;
    getTrackedBills(authUid)
      .then((rows) => {
        if (active) setTrackedBillsResult({ uid: authUid, refreshKey: trackedBillsRefreshKey, rows, error: false });
      })
      .catch((error) => {
        console.warn('Could not load this-device tracked bills:', error);
        if (active) setTrackedBillsResult({ uid: authUid, refreshKey: trackedBillsRefreshKey, rows: null, error: true });
      });
    return () => { active = false; };
  }, [authUid, currentView, trackedBillsRefreshKey]);

  const currentTrackedBillsResult = trackedBillsResult?.uid === authUid &&
    trackedBillsResult.refreshKey === trackedBillsRefreshKey ? trackedBillsResult : null;
  const trackedBills = currentTrackedBillsResult?.rows ?? null;

  const clearBillReturnForRestore = useCallback(() => {
    setBillReturnForRestore(null);
  }, []);

  // Public detail routes contain only opaque IDs.
  useEffect(() => {
    const handleUrlChange = () => {
      const currentLocation = window.location.href;
      if (lastHandledLocationRef.current === currentLocation) return;
      lastHandledLocationRef.current = currentLocation;

      setRouteRevision((revision) => revision + 1);
      const hash = window.location.hash;
      const pathname = window.location.pathname;

      const billMatch = hash.match(/#\/bill\/([a-f0-9-]{36})/i) || pathname.match(/\/bill\/([a-f0-9-]{36})/i);
      if (!billMatch) {
        setRegistrationCompletedBillId(null);
        setRegistrationTrackedBillsAvailable(false);
      }
      if (billMatch && billMatch[1]) {
        setSelectedPublicBillId(billMatch[1]);
        setCurrentView('bill');
      } else if (hash === '#/register') {
        setCurrentView('register');
      } else if (hash === '#/search') {
        setCurrentView('search');
      } else if (hash === '#/my-bills') {
        setCurrentView('tracked');
      } else if (hash === '#/bills') {
        setCurrentView('bills');
      } else {
        setCurrentView('home');
      }
    };

    handleUrlChange();
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);

    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  const navigateTo = (
    view: ViewMode,
    identifier?: string,
    keepRegistrationNotice = false,
    visibleCount: number | null = null,
    trackedListKind: 'registered' | 'following' | null = null,
  ) => {
    setRouteRevision((revision) => revision + 1);
    if (!keepRegistrationNotice) {
      setRegistrationCompletedBillId(null);
      setRegistrationTrackedBillsAvailable(false);
    }
    if (view === 'bill' && identifier) {
      billReturnRef.current = {
        hash: window.location.hash || '#/',
        publicBillId: identifier,
        visibleCount,
        trackedListKind,
      };
      setSelectedPublicBillId(identifier);
      setCurrentView('bill');
      window.location.hash = `#/bill/${identifier}`;
    } else if (view === 'register') {
      billReturnRef.current = null;
      setBillReturnForRestore(null);
      if (identifier) {
        setRegisterInitialSerial(identifier);
      } else {
        setRegisterInitialSerial('');
      }
      setCurrentView('register');
      window.location.hash = '#/register';
    } else if (view === 'search') {
      billReturnRef.current = null;
      setBillReturnForRestore(null);
      setCurrentView('search');
      window.location.hash = '#/search';
    } else if (view === 'tracked') {
      billReturnRef.current = null;
      setBillReturnForRestore(null);
      setTrackedBillsRefreshKey((key) => key + 1);
      setCurrentView('tracked');
      window.location.hash = '#/my-bills';
    } else if (view === 'bills') {
      billReturnRef.current = null;
      setBillReturnForRestore(null);
      setCurrentView('bills');
      window.location.hash = '#/bills';
    } else {
      billReturnRef.current = null;
      setBillReturnForRestore(null);
      setTrackedBillsRefreshKey((key) => key + 1);
      setCurrentView('home');
      window.location.hash = '#/';
    }
  };

  const handleRegisterSuccess = (result: RegisterResult, trackingFailed = false) => {
    setTrackingNotice(trackingFailed);
    if (result.isRediscovery) {
      setRegistrationCompletedBillId(null);
      // 再発見時の祝祭モーダルを表示
      setCelebrationResult(result);
    } else {
      setRegistrationCompletedBillId(result.bill.id);
      setRegistrationTrackedBillsAvailable(Boolean(authUid && !trackingFailed));
      // 初回登録の場合も紙幣詳細ページへ
      navigateTo('bill', result.bill.id, true);
    }
  };

  const completeGoogleSwitch = async (
    credential: AuthCredential,
    sourceUid: string,
    targetUid: string,
    secondary: ReturnType<typeof getGoogleMergeContext>,
    ticketId?: string,
  ) => {
    reportGoogleSyncStage('primary-auth-switch');
    const { user } = await signInWithCredential(auth!, credential);
    reportGoogleSyncStage('primary-auth-switched');
    if (user.uid !== targetUid) throw new Error('The authenticated Google UID changed during merge');
    setAuthUid(user.uid);
    setAuthIsAnonymous(false);
    setAuthIsGoogleLinked(user.providerData.some((entry) => entry.providerId === 'google.com'));
    setTrackedBillsRefreshKey((key) => key + 1);
    setGoogleMergeProgress(null);
    setGoogleMergeResumeAvailable(false);
    pendingMergeRef.current = null;
    if (ticketId) {
      reportGoogleSyncStage('merge-cleanup');
      try {
        await cleanupCompletedTrackedBillMerge(db!, secondary.db, sourceUid, targetUid, ticketId);
      } catch {
        console.warn('[Google sync] Completed merge cleanup deferred; data was already copied.');
      }
    }
    try { await signOut(secondary.auth); } catch { /* The primary Google session is already active. */ }
    return { status: 'merged' as const, previousUid: sourceUid, uid: user.uid };
  };

  const mergeAndSwitchGoogle = async (credential: AuthCredential, sourceUid: string) => {
    reportGoogleSyncStage('validate-secondary-google-auth');
    if (!auth || !db) throw new Error('Firebase is unavailable');
    const secondary = getGoogleMergeContext();
    const target = secondary.auth.currentUser;
    if (!target || target.isAnonymous || !target.providerData.some((entry) => entry.providerId === 'google.com')) {
      throw new Error('The secondary Google session is unavailable');
    }
    if (target.uid === sourceUid) throw new Error('The source and target accounts are already the same');
    reportGoogleSyncStage('secondary-google-auth-ready');

    let preview: TrackedBillMergePreview;
    try {
      reportGoogleSyncStage('merge-preview-read');
      preview = await previewTrackedBillMerge(db, secondary.db, sourceUid, target.uid);
      reportGoogleSyncStage('merge-preview-ready');
    } catch (cause) {
      const error = new Error('Could not inspect both tracked-bill lists; no merge was started.', { cause });
      Object.assign(error, { code: 'merge/check-failed' });
      throw error;
    }
    if (preview.totalCount === 0) return completeGoogleSwitch(credential, sourceUid, target.uid, secondary);
    try {
      const mergeResult = await mergeTrackedBillsWithConsent({
        sourceDb: db,
        targetDb: secondary.db,
        sourceUid,
        targetUid: target.uid,
        preview,
        confirm: () => {
          const accepted = window.confirm([
            t('mergeConfirmTitle'),
            '',
            t('mergeConfirmCounts', {
              copyCount: preview.copyCount,
              duplicateCount: preview.duplicateCount,
              alreadyCopiedCount: preview.alreadyCopiedCount,
            }),
            '',
            t('mergeConfirmDetails'),
          ].join('\n'));
          reportGoogleSyncStage(accepted ? 'merge-consent-accepted' : 'merge-consent-cancelled');
          return accepted;
        },
        onConfirmed: () => {
          pendingMergeRef.current = { credential, sourceUid };
          setGoogleMergeResumeAvailable(true);
          setGoogleMergeProgress({
            totalCount: preview.totalCount,
            copiedCount: preview.alreadyCopiedCount,
            duplicateCount: preview.duplicateCount,
            phase: 'preparing',
          });
        },
        onProgress: setGoogleMergeProgress,
        onStage: reportGoogleMergeStage,
      });
      if (mergeResult.status === 'cancelled') {
        return { status: 'cancelled' as const, previousUid: sourceUid, uid: sourceUid };
      }
      return await completeGoogleSwitch(credential, sourceUid, target.uid, secondary, mergeResult.ticketId);
    } catch (error) {
      reportGoogleSyncStage(googleSyncStageRef.current, error);
      setGoogleSyncError((error as { code?: string }).code === 'merge/active-for-another-account'
        ? 'merge/active-for-another-account'
        : (error as { code?: string }).code === 'merge/source-changed'
          ? 'merge/source-changed'
          : 'merge/failed');
      throw error;
    }
  };

  const handleGoogleSync = async () => {
    const currentUser = auth?.currentUser;
    if (!currentUser || !currentUser.isAnonymous) return;

    setGoogleSyncing(true);
    setGoogleSyncError(null);
    setGooglePopupFallbackAvailable(false);
    setGoogleSyncDiagnostic(null);
    reportGoogleSyncStage('start-link-popup');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const result = await syncGoogleAccount({
        user: currentUser,
        provider,
        link: async (user, googleProvider) => {
          const result = await linkWithPopup(user, googleProvider);
          reportGoogleSyncStage('anonymous-account-linked');
          return result.user;
        },
        getCredentialFromError: (error) => GoogleAuthProvider.credentialFromError(error as FirebaseError),
        signInWithCredential: async (credential) => (await signInWithCredential(auth!, credential)).user,
        onUserSwitched: (user) => {
          setAuthUid(user.uid);
          setAuthIsAnonymous(false);
          setAuthIsGoogleLinked(user.providerData.some((entry) => entry.providerId === 'google.com'));
          setTrackedBillsRefreshKey((key) => key + 1);
        },
        countTrackedBills: getTrackedBillsCount,
        confirmSwitch: () => window.confirm(
          `${t('switchGoogleTitle')}\n\n${t('switchGoogleWarning')}\n\n${t('switchGooglePrompt')}`
        ),
        handleExistingAccount: async ({ credential, previousUid }) => {
          if (!credential) {
            setGooglePopupFallbackAvailable(true);
            return { status: 'popup-fallback', previousUid, uid: previousUid };
          }
          reportGoogleSyncStage('secondary-auth-credential-sign-in');
          const secondary = getGoogleMergeContext();
          await signInWithCredential(secondary.auth, credential);
          reportGoogleSyncStage('secondary-auth-signed-in');
          return mergeAndSwitchGoogle(credential, previousUid);
        },
        onStage: reportGoogleSyncStage,
      });

      if (result.status === 'linked') {
        console.info('[Google sync] Anonymous UID preserved:', result.previousUid === result.uid);
        setAuthUid(result.uid);
        setAuthIsAnonymous(false);
        setAuthIsGoogleLinked(true);
        setTrackedBillsRefreshKey((key) => key + 1);
      } else if (result.status === 'popup-fallback') {
        setGooglePopupFallbackAvailable(true);
      }
    } catch (error) {
      const code = (error as { code?: string })?.code ?? 'unknown';
      reportGoogleSyncStage(googleSyncStageRef.current, error);
      if (import.meta.env.DEV && useFirebaseEmulators) {
        console.warn(`[Google sync] Failed at ${googleSyncStageRef.current}: ${code}`);
      } else {
        console.warn(`[Google sync] Firebase Auth failed: ${code}`);
      }
      const message = getGoogleSyncErrorMessage(error as { code?: string } | null, language);
      if (message) setGoogleSyncError(code);
    } finally {
      setGoogleSyncing(false);
    }
  };

  const handleGooglePopupFallback = async () => {
    if (!googlePopupFallbackAvailable || !auth?.currentUser?.isAnonymous) return;
    setGoogleSyncing(true);
    setGoogleSyncError(null);
    setGoogleSyncDiagnostic(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      reportGoogleSyncStage('secondary-auth-popup');
      const secondary = getGoogleMergeContext();
      const result = await signInWithPopup(secondary.auth, provider);
      reportGoogleSyncStage('secondary-auth-credential-extraction');
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential) throw new Error('Google credential was not returned by the explicit sign-in');
      reportGoogleSyncStage('secondary-auth-signed-in');
      setGooglePopupFallbackAvailable(false);
      await mergeAndSwitchGoogle(credential, auth.currentUser.uid);
    } catch (error) {
      const code = (error as { code?: string })?.code ?? 'unknown';
      reportGoogleSyncStage(googleSyncStageRef.current, error);
      if (import.meta.env.DEV && useFirebaseEmulators) {
        console.warn(`[Google sync] Explicit popup failed at ${googleSyncStageRef.current}: ${code}`);
      } else {
        console.warn(`[Google sync] Explicit secondary popup failed: ${code}`);
      }
      const message = getGoogleSyncErrorMessage(error as { code?: string } | null, language);
      if (message) setGoogleSyncError(code);
    } finally {
      setGoogleSyncing(false);
    }
  };

  const handleGoogleMergeResume = async () => {
    const pending = pendingMergeRef.current;
    if (!pending || !auth?.currentUser?.isAnonymous) return;
    setGoogleSyncing(true);
    setGoogleSyncError(null);
    setGoogleSyncDiagnostic(null);
    try {
      reportGoogleSyncStage('resume-merge');
      await mergeAndSwitchGoogle(pending.credential, pending.sourceUid);
    } catch (error) {
      const code = (error as { code?: string })?.code ?? 'merge/failed';
      reportGoogleSyncStage(googleSyncStageRef.current, error);
      if (import.meta.env.DEV && useFirebaseEmulators) {
        console.warn(`[Google sync] Resume failed at ${googleSyncStageRef.current}: ${code}`);
      }
      setGoogleSyncError(code === 'merge/active-for-another-account' ? code : 'merge/failed');
    } finally {
      setGoogleSyncing(false);
    }
  };

  return (
    <div className="app-container">
      {/* 祝祭モーダル */}
      {celebrationResult && (
        <CelebrationModal
          result={celebrationResult}
          onClose={() => {
            const publicBillId = celebrationResult.bill.id;
            setCelebrationResult(null);
            navigateTo('bill', publicBillId);
          }}
          onViewJourney={() => {
            const publicBillId = celebrationResult.bill.id;
            setCelebrationResult(null);
            navigateTo('bill', publicBillId);
          }}
          onViewTrackedBills={authUid ? () => {
            setCelebrationResult(null);
            navigateTo('tracked');
          } : undefined}
        />
      )}

      {/* 本番環境でのFirebase未設定警告バナー */}
      {import.meta.env.PROD && !isFirebaseConfigured && (
        <div
          style={{
            backgroundColor: '#ef4444',
            color: '#ffffff',
            padding: '10px 14px',
            fontSize: '12px',
            fontWeight: 700,
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          {t('firebaseEnvWarning')}
        </div>
      )}

      {/* ヘッダー */}
      <header className="header">
        <div className="brand" onClick={() => navigateTo('home')}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="brand-title">{t('brand')}</span>
            </div>
          </div>
        </div>
        <div className="language-switch" role="group" aria-label="Language / 言語">
          <button type="button" className={language === 'ja' ? 'selected' : ''} aria-pressed={language === 'ja'} onClick={() => setLanguage('ja')}>日本語</button>
          <span aria-hidden="true">/</span>
          <button type="button" className={language === 'en' ? 'selected' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="main-content">
        {currentView === 'bill' && trackingNotice && (
          <p className="tracked-bills-warning" role="status">
            {t('trackedSaveFailed')}
          </p>
        )}
        {currentView === 'home' && (
          <HomeView
            onNavigateRegister={(serial) => navigateTo('register', serial)}
            onNavigateSearch={() => navigateTo('search')}
            onSelectBill={(publicBillId) => navigateTo('bill', publicBillId)}
            trackedBills={authUid ? trackedBills : null}
            onNavigateTrackedBills={() => navigateTo('tracked')}
            onNavigateBills={() => navigateTo('bills')}
            restoreTargetBillId={billReturnForRestore?.hash === '#/' ? billReturnForRestore.publicBillId : null}
            onRestoreComplete={clearBillReturnForRestore}
          />
        )}

        {currentView === 'register' && (
          <RegisterView
            initialSerial={registerInitialSerial}
            onSuccess={handleRegisterSuccess}
            onViewBill={(id) => navigateTo('bill', id)}
            onCancel={() => navigateTo('home')}
          />
        )}

        {currentView === 'search' && (
          <SearchView
            onBillFound={(publicBillId) => navigateTo('bill', publicBillId)}
            onRegisterNew={(serial) => navigateTo('register', serial)}
          />
        )}

        {currentView === 'bill' && (
          <BillDetailView
            publicBillId={selectedPublicBillId}
            userUid={authUid}
            registrationCompleted={registrationCompletedBillId === selectedPublicBillId}
            showTrackedBillsLink={registrationTrackedBillsAvailable}
            onNavigateTrackedBills={() => navigateTo('tracked')}
            onBack={() => {
              const previousRoute = billReturnRef.current;
              billReturnRef.current = null;
              if (previousRoute) {
                setBillReturnForRestore(previousRoute);
                window.history.back();
              } else {
                navigateTo('home');
              }
            }}
          />
        )}

        {currentView === 'tracked' && authUid && (
          <TrackedBillsView
            key={authUid}
            uid={authUid}
            restoreTargetBillId={billReturnForRestore?.hash === '#/my-bills' && billReturnForRestore.trackedListKind !== 'following' ? billReturnForRestore.publicBillId : null}
            followingRestoreTargetBillId={billReturnForRestore?.hash === '#/my-bills' && billReturnForRestore.trackedListKind === 'following' ? billReturnForRestore.publicBillId : null}
            restoreVisibleCount={billReturnForRestore?.hash === '#/my-bills' ? billReturnForRestore.visibleCount : null}
            restoreListKind={billReturnForRestore?.hash === '#/my-bills' ? billReturnForRestore.trackedListKind : null}
            onSelectBill={(publicBillId, visibleCount, listKind) => navigateTo('bill', publicBillId, false, visibleCount, listKind)}
            onRestoreComplete={clearBillReturnForRestore}
            syncState={authIsGoogleLinked ? 'linked' : authIsAnonymous ? 'anonymous' : 'other'}
            syncing={googleSyncing}
            syncError={googleSyncError ? getGoogleSyncErrorMessage({ code: googleSyncError }, language) : null}
            onGoogleSync={handleGoogleSync}
            popupFallbackAvailable={googlePopupFallbackAvailable}
            onGooglePopupFallback={handleGooglePopupFallback}
            syncDiagnostic={import.meta.env.DEV && useFirebaseEmulators && googleSyncDiagnostic ? {
              ...googleSyncDiagnostic,
              transport: `demo project ${IDENTITY_EMULATOR_PROJECT}; Auth ${emulatorEndpoint.host}:${emulatorEndpoint.authPort}; Firestore ${emulatorEndpoint.host}:${emulatorEndpoint.firestorePort}; App Check disabled`,
            } : null}
            mergeProgress={googleMergeProgress}
            mergeResumeAvailable={googleMergeResumeAvailable}
            onGoogleMergeResume={handleGoogleMergeResume}
          />
        )}
        {currentView === 'tracked' && !authReady && (
          <div className="tracked-bills-unavailable" role="status" aria-live="polite">
            <h1>{t('trackedTitle')}</h1>
            <p>{t('trackedPrepare')}</p>
          </div>
        )}
        {currentView === 'tracked' && authReady && !authUid && (
          <div className="tracked-bills-unavailable">
            <h1>{t('trackedTitle')}</h1>
            <p>{t('trackedUnavailable')}</p>
          </div>
        )}
        {currentView === 'bills' && (
          <PublicBillsView
            onSelectBill={(publicBillId, visibleCount) => navigateTo('bill', publicBillId, false, visibleCount)}
            restoreTargetBillId={billReturnForRestore?.hash === '#/bills' ? billReturnForRestore.publicBillId : null}
            restoreVisibleCount={billReturnForRestore?.hash === '#/bills' ? billReturnForRestore.visibleCount : null}
            onRestoreComplete={clearBillReturnForRestore}
          />
        )}

        <footer className="app-social-links" aria-label={t('social')}>
          <a
            href="https://x.com/bicycle_geek"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X @bicycle_geek"
          >
            𝕏
          </a>
          <span aria-hidden="true">｜</span>
          <a href="https://github.com/atsushiyago/osatsu-no-tabi" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </footer>
      </main>

      {/* ボトムナビゲーションバー（スマホ用） */}
      <nav className="bottom-nav">
        <button
          className={`nav-item ${currentView === 'home' ? 'active' : ''}`}
          onClick={() => navigateTo('home')}
          id="nav-home"
        >
          <Compass size={20} />
          <span>{t('home')}</span>
        </button>

        <button
          className={`nav-item ${currentView === 'register' ? 'active' : ''}`}
          onClick={() => navigateTo('register')}
          id="nav-register"
        >
          <PlusCircle size={20} />
          <span>{t('register')}</span>
        </button>

        <button
          className={`nav-item ${currentView === 'search' ? 'active' : ''}`}
          onClick={() => navigateTo('search')}
          id="nav-search"
        >
          <Search size={20} />
          <span>{t('search')}</span>
        </button>

        <button
          className={`nav-item ${currentView === 'tracked' ? 'active' : ''}`}
          onClick={() => navigateTo('tracked')}
          id="nav-tracked-bills"
        >
          <WalletCards size={20} />
          <span>{t('tracked')}</span>
        </button>
      </nav>
      <TimingMonitor />
    </div>
  );
}

export default App;
