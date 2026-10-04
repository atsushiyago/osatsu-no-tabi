import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Compass, PlusCircle, Search, WalletCards } from 'lucide-react';
import type { FirebaseError } from 'firebase/app';
import { GoogleAuthProvider, linkWithPopup, signInWithCredential, signInWithPopup } from 'firebase/auth';
import { HomeView } from './components/HomeView';
import { RegisterView } from './components/RegisterView';
import { SearchView } from './components/SearchView';
import { BillDetailView } from './components/BillDetailView';
import { CelebrationModal } from './components/CelebrationModal';
import type { RegisterResult } from './types';
import { auth, isFirebaseConfigured } from './services/firebase';
import { TimingMonitor } from './components/TimingMonitor';
import { TrackedBillsView } from './components/TrackedBillsView';
import { PublicBillsView } from './components/PublicBillsView';
import { ensureAnonymousUser, observeAuthState } from './services/firebase';
import { getTrackedBills, type TrackedBillRow } from './services/trackedBills';
import { getGoogleSyncErrorMessage, getGoogleSyncState, syncGoogleAccount } from './services/googleAccountSync.js';

type ViewMode = 'home' | 'register' | 'search' | 'bill' | 'tracked' | 'bills';
type TrackedBillsLoadResult = {
  uid: string;
  refreshKey: number;
  rows: TrackedBillRow[] | null;
  error: boolean;
};

export function App() {
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
  const [authReady, setAuthReady] = useState(!auth);
  const [trackingNotice, setTrackingNotice] = useState(false);
  const [registrationCompletedBillId, setRegistrationCompletedBillId] = useState<string | null>(null);
  const [registrationTrackedBillsAvailable, setRegistrationTrackedBillsAvailable] = useState(false);
  const [trackedBillsRefreshKey, setTrackedBillsRefreshKey] = useState(0);
  const [trackedBillsResult, setTrackedBillsResult] = useState<TrackedBillsLoadResult | null>(null);
  const [routeRevision, setRouteRevision] = useState(0);
  const billReturnRef = useRef<{ hash: string; scrollY: number } | null>(null);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const lastHandledLocationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return;
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    const restoreScrollY = pendingScrollRestoreRef.current;
    if (restoreScrollY !== null && currentView === 'bills') return;
    pendingScrollRestoreRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({
        top: restoreScrollY ?? 0,
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
    if (currentView !== 'home' && currentView !== 'tracked') return;
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

  const hasTrackedBillsView = currentView === 'home' || currentView === 'tracked';
  const currentTrackedBillsResult = trackedBillsResult?.uid === authUid &&
    trackedBillsResult.refreshKey === trackedBillsRefreshKey ? trackedBillsResult : null;
  const trackedBills = currentTrackedBillsResult?.rows ?? null;
  const trackedBillsLoading = hasTrackedBillsView && Boolean(authUid) && !currentTrackedBillsResult;
  const trackedBillsError = currentTrackedBillsResult?.error ?? false;

  const restorePublicBillsScroll = useCallback(() => {
    const scrollY = pendingScrollRestoreRef.current;
    if (scrollY === null) return;
    pendingScrollRestoreRef.current = null;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, left: window.scrollX, behavior: 'auto' });
    });
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

  const navigateTo = (view: ViewMode, identifier?: string, keepRegistrationNotice = false) => {
    setRouteRevision((revision) => revision + 1);
    if (!keepRegistrationNotice) {
      setRegistrationCompletedBillId(null);
      setRegistrationTrackedBillsAvailable(false);
    }
    if (view === 'bill' && identifier) {
      billReturnRef.current = {
        hash: window.location.hash || '#/',
        scrollY: window.scrollY,
      };
      setSelectedPublicBillId(identifier);
      setCurrentView('bill');
      window.location.hash = `#/bill/${identifier}`;
    } else if (view === 'register') {
      billReturnRef.current = null;
      if (identifier) {
        setRegisterInitialSerial(identifier);
      } else {
        setRegisterInitialSerial('');
      }
      setCurrentView('register');
      window.location.hash = '#/register';
    } else if (view === 'search') {
      billReturnRef.current = null;
      setCurrentView('search');
      window.location.hash = '#/search';
    } else if (view === 'tracked') {
      billReturnRef.current = null;
      setTrackedBillsRefreshKey((key) => key + 1);
      setCurrentView('tracked');
      window.location.hash = '#/my-bills';
    } else if (view === 'bills') {
      billReturnRef.current = null;
      setCurrentView('bills');
      window.location.hash = '#/bills';
    } else {
      billReturnRef.current = null;
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

  const handleGoogleSync = async () => {
    const currentUser = auth?.currentUser;
    if (!currentUser || !currentUser.isAnonymous) return;

    setGoogleSyncing(true);
    setGoogleSyncError(null);
    setGooglePopupFallbackAvailable(false);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const result = await syncGoogleAccount({
        user: currentUser,
        provider,
        link: async (user, googleProvider) => (await linkWithPopup(user, googleProvider)).user,
        getCredentialFromError: (error) => GoogleAuthProvider.credentialFromError(error as FirebaseError),
        signInWithCredential: async (credential) => (await signInWithCredential(auth!, credential)).user,
        onUserSwitched: (user) => {
          setAuthUid(user.uid);
          setAuthIsAnonymous(false);
          setAuthIsGoogleLinked(user.providerData.some((entry) => entry.providerId === 'google.com'));
          setTrackedBillsRefreshKey((key) => key + 1);
        },
        countTrackedBills: async (uid) => (await getTrackedBills(uid)).length,
        confirmSwitch: () => window.confirm(
          'このGoogleアカウントには、すでに「お札の旅」のデータがあります。\n\n' +
          'このブラウザには未同期の「登録したお札」があります。既存のGoogle同期データへ切り替えると、このブラウザの一覧は自動では統合されません。\n\n' +
          '既存のGoogle同期データへ切り替えますか？'
        ),
      });

      if (result.status === 'linked') {
        console.info('[Google sync] Anonymous UID preserved:', result.previousUid === result.uid);
        setAuthUid(result.uid);
        setAuthIsAnonymous(false);
        setAuthIsGoogleLinked(true);
        setTrackedBillsRefreshKey((key) => key + 1);
      } else if (result.status === 'switched') {
        console.info('[Google sync] Switched to existing Google-linked Firebase user.');
      } else if (result.status === 'popup-fallback') {
        setGooglePopupFallbackAvailable(true);
      }
    } catch (error) {
      const code = (error as { code?: string })?.code ?? 'unknown';
      console.warn(`[Google sync] Firebase Auth failed: ${code}`, error);
      const message = getGoogleSyncErrorMessage(error as { code?: string } | null);
      if (message) setGoogleSyncError(message);
    } finally {
      setGoogleSyncing(false);
    }
  };

  const handleGooglePopupFallback = async () => {
    if (!googlePopupFallbackAvailable || !auth?.currentUser?.isAnonymous) return;

    setGoogleSyncing(true);
    setGoogleSyncError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const { user } = await signInWithPopup(auth, provider);
      console.info('[Google sync] Switched using explicit popup fallback.');
      setAuthUid(user.uid);
      setAuthIsAnonymous(false);
      setAuthIsGoogleLinked(user.providerData.some((entry) => entry.providerId === 'google.com'));
      setTrackedBillsRefreshKey((key) => key + 1);
      setGooglePopupFallbackAvailable(false);
    } catch (error) {
      const code = (error as { code?: string })?.code ?? 'unknown';
      console.warn(`[Google sync] Explicit popup fallback failed: ${code}`, error);
      const message = getGoogleSyncErrorMessage(error as { code?: string } | null);
      if (message) setGoogleSyncError(message);
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
          ⚠️ Firebase環境変数が未設定です。Cloudflare (Workers Builds) の環境変数を設定してください。
        </div>
      )}

      {/* ヘッダー */}
      <header className="header">
        <div className="brand" onClick={() => navigateTo('home')}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="brand-title">お札の旅</span>
            </div>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="main-content">
        {currentView === 'bill' && trackingNotice && (
          <p className="tracked-bills-warning" role="status">
            登録は完了しましたが、「登録したお札」の一覧には保存できませんでした。
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
          />
        )}

        {currentView === 'register' && (
          <RegisterView
            initialSerial={registerInitialSerial}
            onSuccess={handleRegisterSuccess}
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
                if (previousRoute.hash === '#/bills') {
                  pendingScrollRestoreRef.current = previousRoute.scrollY;
                }
                window.history.back();
              } else {
                navigateTo('home');
              }
            }}
          />
        )}

        {currentView === 'tracked' && authUid && (
          <TrackedBillsView
            rows={trackedBills ?? []}
            loading={trackedBillsLoading}
            error={trackedBillsError}
            onSelectBill={(publicBillId) => navigateTo('bill', publicBillId)}
            syncState={authIsGoogleLinked ? 'linked' : authIsAnonymous ? 'anonymous' : 'other'}
            syncing={googleSyncing}
            syncError={googleSyncError}
            onGoogleSync={handleGoogleSync}
            popupFallbackAvailable={googlePopupFallbackAvailable}
            onGooglePopupFallback={handleGooglePopupFallback}
          />
        )}
        {currentView === 'tracked' && !authReady && (
          <div className="tracked-bills-unavailable" role="status" aria-live="polite">
            <h1>登録したお札</h1>
            <p>登録したお札を準備しています…</p>
          </div>
        )}
        {currentView === 'tracked' && authReady && !authUid && (
          <div className="tracked-bills-unavailable">
            <h1>登録したお札</h1>
            <p>現在この機能を利用できません。公開中のお札の検索や閲覧は引き続き利用できます。</p>
          </div>
        )}
        {currentView === 'bills' && (
          <PublicBillsView
            onSelectBill={(publicBillId) => navigateTo('bill', publicBillId)}
            onInitialLoadComplete={restorePublicBillsScroll}
          />
        )}

        <footer className="app-social-links" aria-label="外部リンク">
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
          <span>ホーム</span>
        </button>

        <button
          className={`nav-item ${currentView === 'register' ? 'active' : ''}`}
          onClick={() => navigateTo('register')}
          id="nav-register"
        >
          <PlusCircle size={20} />
          <span>登録する</span>
        </button>

        <button
          className={`nav-item ${currentView === 'search' ? 'active' : ''}`}
          onClick={() => navigateTo('search')}
          id="nav-search"
        >
          <Search size={20} />
          <span>検索</span>
        </button>

        <button
          className={`nav-item ${currentView === 'tracked' ? 'active' : ''}`}
          onClick={() => navigateTo('tracked')}
          id="nav-tracked-bills"
        >
          <WalletCards size={20} />
          <span>登録したお札</span>
        </button>
      </nav>
      <TimingMonitor />
    </div>
  );
}

export default App;
