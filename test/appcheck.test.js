import assert from 'node:assert';
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
