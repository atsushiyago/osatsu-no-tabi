import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  getToken,
  type AppCheck,
} from 'firebase/app-check';
import { connectFirestoreEmulator, getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import { connectAuthEmulator, getAuth, signInAnonymously, onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import { isDebugTiming } from '../utils/debug';
import { getOrCreateAnonymousUser } from './anonymousSession.js';

import { identityEmulatorEndpoint, identityV2Enabled, identityEmulatorEnabled, IDENTITY_EMULATOR_PROJECT } from '../utils/identityEnvironment';

export const useFirebaseEmulators = import.meta.env.DEV && identityEmulatorEnabled(true, import.meta.env.VITE_USE_FIREBASE_EMULATORS);
// Keep emulator coordinates out of production bundles. Emulator transport is a
// development-only capability, even when the selected build mode is QA.
export const emulatorEndpoint = import.meta.env.DEV
  ? identityEmulatorEndpoint(true, import.meta.env.VITE_USE_FIREBASE_EMULATORS, import.meta.env.VITE_IDENTITY_LAN_HOST)
  : { host: '', firestorePort: 0, authPort: 0 };
export const isIdentityV2Enabled = identityV2Enabled(import.meta.env.VITE_BILL_IDENTITY_V2);
const firebaseConfig = import.meta.env.DEV && useFirebaseEmulators ? {
  apiKey: 'fake-api-key', projectId: IDENTITY_EMULATOR_PROJECT,
  authDomain: 'localhost', appId: 'demo-identity-v2',
} : {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (import.meta.env.MODE === 'qa' && (
  firebaseConfig.projectId !== 'osatsu-no-tabi-qa' ||
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ||
  import.meta.env.VITE_BILL_IDENTITY_V2 !== 'true'
)) {
  throw new Error('QA mode requires the osatsu-no-tabi-qa project, real Firebase services, and v2 enabled.');
}

const recaptchaEnterpriseSiteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.apiKey !== 'YOUR_API_KEY'
);

export const isAppCheckConfigured = Boolean(
  recaptchaEnterpriseSiteKey &&
  recaptchaEnterpriseSiteKey !== 'YOUR_SITE_KEY' &&
  recaptchaEnterpriseSiteKey !== 'your-recaptcha-enterprise-site-key'
);

// 開発環境（DEV）限定の Debug Provider 設定
// ※ 本番ビルド（import.meta.env.PROD）では Dead Code Elimination により安全に無効化されます
if (!useFirebaseEmulators && import.meta.env.DEV && typeof window !== 'undefined') {
  const debugEnv = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG;
  if (debugEnv === 'true' || debugEnv === true) {
    // @ts-expect-error FIREBASE_APPCHECK_DEBUG_TOKEN is used by Firebase App Check SDK
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    console.info(
      '【開発環境】Firebase App Check: Localhost Debug Provider を有効化しました。ブラウザコンソールに出力されるDebug TokenをFirebase Consoleに登録してください。'
    );
  } else if (typeof debugEnv === 'string' && debugEnv.length > 0) {
    // @ts-expect-error FIREBASE_APPCHECK_DEBUG_TOKEN is used by Firebase App Check SDK
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugEnv;
    console.info('【開発環境】Firebase App Check: カスタムDebug Tokenを設定しました。');
  }
}

let app: FirebaseApp | null = null;
let appCheck: AppCheck | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

if (isFirebaseConfigured) {
  try {
    app = import.meta.env.DEV && useFirebaseEmulators
      ? getApps().find((item) => item.name === 'identity-v2-emulator') ?? initializeApp(firebaseConfig, 'identity-v2-emulator')
      : getApps().find((item) => item.name === '[DEFAULT]') ?? initializeApp(firebaseConfig);

    // 1. App Check の初期化（Firestore 初期化の前）
    if (!useFirebaseEmulators && typeof window !== 'undefined' && !appCheck) {
      if (isAppCheckConfigured) {
        try {
          appCheck = initializeAppCheck(app, {
            provider: new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),
            isTokenAutoRefreshEnabled: true,
          });
          console.info('Firebase App Check (reCAPTCHA Enterprise) successfully initialized.');
        } catch (appCheckErr) {
          console.warn('Failed to initialize Firebase App Check:', appCheckErr);
        }
      } else if (
        import.meta.env.DEV &&
        // @ts-expect-error FIREBASE_APPCHECK_DEBUG_TOKEN is defined on self in dev mode
        Boolean(self.FIREBASE_APPCHECK_DEBUG_TOKEN)
      ) {
        try {
          appCheck = initializeAppCheck(app, {
            provider: new ReCaptchaEnterpriseProvider('dummy-dev-site-key'),
            isTokenAutoRefreshEnabled: true,
          });
          console.info('Firebase App Check: Initialized with Debug Provider in development.');
        } catch (appCheckErr) {
          console.warn('Failed to initialize Firebase App Check in debug mode:', appCheckErr);
        }
      } else {
        if (import.meta.env.PROD) {
          console.warn(
            '【本番環境警告】VITE_RECAPTCHA_ENTERPRISE_SITE_KEY が未設定です。Cloudflare (Workers Buildsの環境変数) に設定されるまで、Firestoreへのリクエストは未認証(Unverified)として送信されます。'
          );
        } else {
          console.info('Firebase App Check: Site key not configured. Running without App Check in local mode.');
        }
      }
    }

    // 2. Firestore の初期化（iPhone遅延対策の forceLongPolling を維持）
    db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    });
    if (import.meta.env.DEV && useFirebaseEmulators) connectFirestoreEmulator(db, emulatorEndpoint.host, emulatorEndpoint.firestorePort);
    console.info('Firebase Firestore initialized with experimentalForceLongPolling: true');
  } catch (err) {
    console.error('Failed to initialize Firebase:', err);
    db = null;
  }
} else {
  if (import.meta.env.PROD) {
    console.error(
      '【本番環境警告】Firebaseの環境変数が未設定です。Cloudflare (Workers Buildsの環境変数) で VITE_FIREBASE_* を設定してください。'
    );
  } else {
    console.info('Firebase environment variables not set. Running in local demo mode for development.');
  }
}

// Auth initialization is isolated from Firestore/App Check so an Auth failure
// never prevents public bill browsing or the existing registration flow.
if (app) {
  try {
    auth = getAuth(app);
    if (import.meta.env.DEV && useFirebaseEmulators) connectAuthEmulator(auth, `http://${emulatorEndpoint.host}:${emulatorEndpoint.authPort}`, { disableWarnings: true });
  } catch (err) {
    if (useFirebaseEmulators) auth = null; // Never retain an unconnected demo Auth instance.
    console.warn('Firebase Auth is unavailable; device bill list is disabled:', err);
  }
}

export function ensureAnonymousUser(): Promise<User> {
  if (!auth) return Promise.reject(new Error('Firebase Auth is unavailable'));
  return getOrCreateAnonymousUser(auth, signInAnonymously);
}

export function observeAuthState(
  next: (user: User | null) => void,
  error: (reason: Error) => void
): (() => void) | null {
  return auth ? onAuthStateChanged(auth, next, error) : null;
}

let mergeContext: { auth: Auth; db: Firestore } | null = null;

/**
 * A separate Firebase App/Auth keeps the device's anonymous session intact while
 * the user authenticates to an already-linked Google UID. It uses the same
 * project and, in development, the same explicitly configured local emulators.
 */
export function getGoogleMergeContext(): { auth: Auth; db: Firestore } {
  if (mergeContext) return mergeContext;
  if (!app || !isFirebaseConfigured) throw new Error('Firebase is not configured');

  const name = 'google-account-merge-secondary';
  const existingSecondaryApp = getApps().find((item) => item.name === name);
  const secondaryApp = existingSecondaryApp ?? initializeApp(app.options, name);
  const secondaryAuth = getAuth(secondaryApp);
  const secondaryDb = existingSecondaryApp
    ? getFirestore(secondaryApp)
    : initializeFirestore(secondaryApp, { experimentalForceLongPolling: true });

  if (import.meta.env.DEV && useFirebaseEmulators && !existingSecondaryApp) {
    connectAuthEmulator(secondaryAuth, `http://${emulatorEndpoint.host}:${emulatorEndpoint.authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(secondaryDb, emulatorEndpoint.host, emulatorEndpoint.firestorePort);
  } else if (!useFirebaseEmulators && isAppCheckConfigured && typeof window !== 'undefined') {
    // App Check is per Firebase App. Do not let a secondary Firestore request
    // silently bypass an App Check-enforced production project.
    try {
      initializeAppCheck(secondaryApp, {
        provider: new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'app-check/already-initialized') {
        // Vite HMR can preserve the named Firebase App while reloading this module.
      } else {
      console.warn('Could not initialize App Check for the secondary Auth session.');
      throw error;
      }
    }
  }

  mergeContext = { auth: secondaryAuth, db: secondaryDb };
  return mergeContext;
}

/**
 * App Check 診断用関数
 * ?debug=timing が指定されている場合のみ実行され、
 * getToken(appCheck, true) を強制実行して結果を検証します。
 * - 成功時: token length と expireTimeMillis のみ console.log (token本文は絶対に出力しない)
 * - 失敗時: error code / message を console.error
 */
export async function runDiagnoseAppCheck(): Promise<{
  success: boolean;
  length?: number;
  expireTimeMillis?: number;
  error?: string;
} | null> {
  if (!isDebugTiming()) return null;

  if (!appCheck) {
    const errorMsg = isAppCheckConfigured
      ? 'App Check 初期化インスタンスが存在しません。'
      : 'VITE_RECAPTCHA_ENTERPRISE_SITE_KEY が未設定のため App Check は初期化されていません。';
    console.error(`[App Check Diagnostics] 診断エラー: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  try {
    const result = await getToken(appCheck, true);
    const tokenLen = result?.token ? result.token.length : 0;
    const expireTime = (result as { expireTimeMillis?: number })?.expireTimeMillis;

    // token本文そのものは絶対にconsoleへ出さない
    console.log(
      `[App Check Diagnostics] Token取得成功: length=${tokenLen}, expireTimeMillis=${expireTime ?? 'N/A'}`
    );

    return {
      success: true,
      length: tokenLen,
      expireTimeMillis: expireTime,
    };
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    const code = errorObj?.code || 'UNKNOWN';
    const message = errorObj?.message || String(err);

    console.error(
      `[App Check Diagnostics] Token取得失敗: code=${code}, message=${message}`
    );

    return {
      success: false,
      error: `[${code}] ${message}`,
    };
  }
}

// ?debug=timing が付いている場合のみ初期化完了後に診断を自動実行
if (isDebugTiming() && appCheck) {
  runDiagnoseAppCheck();
}

export { app, appCheck, auth, db };
