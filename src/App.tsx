import { useState, useEffect, useLayoutEffect } from 'react';
import { Compass, PlusCircle, Search, WalletCards } from 'lucide-react';
import { HomeView } from './components/HomeView';
import { RegisterView } from './components/RegisterView';
import { SearchView } from './components/SearchView';
import { BillDetailView } from './components/BillDetailView';
import { CelebrationModal } from './components/CelebrationModal';
import type { RegisterResult } from './types';
import { isFirebaseConfigured } from './services/firebase';
import { TimingMonitor } from './components/TimingMonitor';
import { TrackedBillsView } from './components/TrackedBillsView';
import { auth, ensureAnonymousUser, observeAuthState } from './services/firebase';
import { getTrackedBills, type TrackedBillRow } from './services/trackedBills';

type ViewMode = 'home' | 'register' | 'search' | 'bill' | 'tracked';
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
  const [authReady, setAuthReady] = useState(!auth);
  const [trackingNotice, setTrackingNotice] = useState(false);
  const [registrationCompletedBillId, setRegistrationCompletedBillId] = useState<string | null>(null);
  const [registrationTrackedBillsAvailable, setRegistrationTrackedBillsAvailable] = useState(false);
  const [trackedBillsRefreshKey, setTrackedBillsRefreshKey] = useState(0);
  const [trackedBillsResult, setTrackedBillsResult] = useState<TrackedBillsLoadResult | null>(null);
  const [routeRevision, setRouteRevision] = useState(0);

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
      window.scrollTo({ top: 0, left: window.scrollX, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [routeRevision]);

  useEffect(() => {
    const unsubscribe = observeAuthState((user) => {
      setAuthUid(user?.uid ?? null);
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

      // Public detail routes contain only opaque IDs.
  useEffect(() => {
    const handleUrlChange = () => {
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
      setSelectedPublicBillId(identifier);
      setCurrentView('bill');
      window.location.hash = `#/bill/${identifier}`;
    } else if (view === 'register') {
      if (identifier) {
        setRegisterInitialSerial(identifier);
      } else {
        setRegisterInitialSerial('');
      }
      setCurrentView('register');
      window.location.hash = '#/register';
    } else if (view === 'search') {
      setCurrentView('search');
      window.location.hash = '#/search';
    } else if (view === 'tracked') {
      setTrackedBillsRefreshKey((key) => key + 1);
      setCurrentView('tracked');
      window.location.hash = '#/my-bills';
    } else {
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
            onBack={() => navigateTo('home')}
          />
        )}

        {currentView === 'tracked' && authUid && (
          <TrackedBillsView
            rows={trackedBills ?? []}
            loading={trackedBillsLoading}
            error={trackedBillsError}
            onSelectBill={(publicBillId) => navigateTo('bill', publicBillId)}
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
