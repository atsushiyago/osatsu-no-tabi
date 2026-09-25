import { useState, useEffect } from 'react';
import { Compass, PlusCircle, Search, WalletCards } from 'lucide-react';
import { HomeView } from './components/HomeView';
import { RegisterView } from './components/RegisterView';
import { SearchView } from './components/SearchView';
import { BillDetailView } from './components/BillDetailView';
import { CelebrationModal } from './components/CelebrationModal';
import type { RegisterResult } from './types';
import { normalizeSerialNumber } from './utils/serial';
import { isFirebaseConfigured } from './services/firebase';
import { TimingMonitor } from './components/TimingMonitor';
import { TrackedBillsView } from './components/TrackedBillsView';
import { auth, ensureAnonymousUser, observeAuthState } from './services/firebase';

type ViewMode = 'home' | 'register' | 'search' | 'bill' | 'tracked';

export function App() {
  const [currentView, setCurrentView] = useState<ViewMode>('home');
  const [selectedSerial, setSelectedSerial] = useState<string>('');
  const [registerInitialSerial, setRegisterInitialSerial] = useState<string>('');
  const [celebrationResult, setCelebrationResult] = useState<RegisterResult | null>(null);
  const [authUid, setAuthUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!auth);
  const [trackingNotice, setTrackingNotice] = useState(false);

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

  // URLハッシュまたはパスのパース (/bill/:serial)
  useEffect(() => {
    const handleUrlChange = () => {
      const hash = window.location.hash;
      const pathname = window.location.pathname;

      // #/bill/XXXX または /bill/XXXX に対応
      const billMatch = hash.match(/#\/bill\/([A-Za-z0-9]+)/) || pathname.match(/\/bill\/([A-Za-z0-9]+)/);
      if (billMatch && billMatch[1]) {
        setSelectedSerial(normalizeSerialNumber(billMatch[1]));
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

  const navigateTo = (view: ViewMode, serial?: string) => {
    if (view === 'bill' && serial) {
      const norm = normalizeSerialNumber(serial);
      setSelectedSerial(norm);
      setCurrentView('bill');
      window.location.hash = `#/bill/${norm}`;
    } else if (view === 'register') {
      if (serial) {
        setRegisterInitialSerial(serial);
      } else {
        setRegisterInitialSerial('');
      }
      setCurrentView('register');
      window.location.hash = '#/register';
    } else if (view === 'search') {
      setCurrentView('search');
      window.location.hash = '#/search';
    } else if (view === 'tracked' && authUid) {
      setCurrentView('tracked');
      window.location.hash = '#/my-bills';
    } else {
      setCurrentView('home');
      window.location.hash = '#/';
    }
  };

  const handleRegisterSuccess = (result: RegisterResult, trackingFailed = false) => {
    setTrackingNotice(trackingFailed);
    if (result.isRediscovery) {
      // 再発見時の祝祭モーダルを表示
      setCelebrationResult(result);
    } else {
      // 初回登録の場合も紙幣詳細ページへ
      navigateTo('bill', result.bill.serialNumber);
    }
  };

  return (
    <div className="app-container">
      {/* 祝祭モーダル */}
      {celebrationResult && (
        <CelebrationModal
          result={celebrationResult}
          onClose={() => {
            const serial = celebrationResult.bill.serialNumber;
            setCelebrationResult(null);
            navigateTo('bill', serial);
          }}
          onViewJourney={() => {
            const serial = celebrationResult.bill.serialNumber;
            setCelebrationResult(null);
            navigateTo('bill', serial);
          }}
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
            登録は完了しましたが、この端末の一覧には保存できませんでした。
          </p>
        )}
        {currentView === 'home' && (
          <HomeView
            onNavigateRegister={(serial) => navigateTo('register', serial)}
            onNavigateSearch={() => navigateTo('search')}
            onSelectBill={(serial) => navigateTo('bill', serial)}
          />
        )}

        {currentView === 'register' && (
          <RegisterView
            initialSerial={registerInitialSerial}
            onSuccess={handleRegisterSuccess}
            userUid={authUid}
            onCancel={() => navigateTo('home')}
          />
        )}

        {currentView === 'search' && (
          <SearchView
            onBillFound={(serial) => navigateTo('bill', serial)}
            onRegisterNew={(serial) => navigateTo('register', serial)}
          />
        )}

        {currentView === 'bill' && (
          <BillDetailView
            serialNumber={selectedSerial}
            onBack={() => navigateTo('home')}
            onRegisterAgain={(serial) => navigateTo('register', serial)}
          />
        )}

        {currentView === 'tracked' && authUid && (
          <TrackedBillsView uid={authUid} onSelectBill={(serial) => navigateTo('bill', serial)} />
        )}
        {currentView === 'tracked' && authReady && !authUid && (
          <div className="tracked-bills-unavailable">
            <h1>この端末で登録したお札</h1>
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

        {authReady && authUid && (
          <button
            className={`nav-item ${currentView === 'tracked' ? 'active' : ''}`}
            onClick={() => navigateTo('tracked')}
            id="nav-tracked-bills"
          >
            <WalletCards size={20} />
            <span>この端末のお札</span>
          </button>
        )}
      </nav>
      <TimingMonitor />
    </div>
  );
}

export default App;
