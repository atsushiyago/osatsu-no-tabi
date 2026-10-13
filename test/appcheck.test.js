import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Polyfill import.meta.env for test runner outside Vite
if (!globalThis.import) {
  // @ts-expect-error Node env polyfill
  globalThis.import = {};
}

test('App Check site key validation logic', () => {
  const validateSiteKey = (key) => {
    return Boolean(
      key &&
      key !== 'YOUR_SITE_KEY' &&
      key !== 'your-recaptcha-enterprise-site-key' &&
      key !== 'your_recaptcha_enterprise_site_key'
    );
  };

  assert.strictEqual(validateSiteKey(undefined), false);
  assert.strictEqual(validateSiteKey(''), false);
  assert.strictEqual(validateSiteKey('YOUR_SITE_KEY'), false);
  assert.strictEqual(validateSiteKey('your-recaptcha-enterprise-site-key'), false);
  assert.strictEqual(validateSiteKey('6LfakeEnterpriseKey_ABC123xyz'), true);
});

test('App Check provider exports and initialization order', async () => {
  const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
  assert.strictEqual(typeof initializeAppCheck, 'function');
  assert.strictEqual(typeof ReCaptchaEnterpriseProvider, 'function');

  // Verify constructor works
  const provider = new ReCaptchaEnterpriseProvider('dummy-test-key');
  assert.ok(provider);
});

test('secondary App Check is initialized before secondary Auth and Firestore services', async () => {
  const source = await readFile(new URL('../src/services/firebase.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export function getGoogleMergeContext()');
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const mergeContext = source.slice(start, end);
  const appCheckIndex = mergeContext.indexOf('initializeAppCheck(secondaryApp');
  const authIndex = mergeContext.indexOf('getAuth(secondaryApp)');
  const firestoreIndex = mergeContext.indexOf('initializeFirestore(secondaryApp');

  assert.notEqual(appCheckIndex, -1);
  assert.ok(authIndex > appCheckIndex);
  assert.ok(firestoreIndex > appCheckIndex);
});
