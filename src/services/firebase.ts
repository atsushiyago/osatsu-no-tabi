import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  getToken,
  type AppCheck,
} from 'firebase/app-check';
import { initializeFirestore, type Firestore } from 'firebase/firestore';
import { isDebugTiming } from '../utils/debug';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

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
if (import.meta.env.DEV && typeof window !== 'undefined') {
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

if (isFirebaseConfigured) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

    // 1. App Check の初期化（Firestore 初期化の前）
    if (typeof window !== 'undefined' && !appCheck) {
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

export { app, appCheck, db };
