import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.OSATSU_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.OSATSU_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OSATSU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OSATSU_CHROMIUM_EXECUTABLE } : {}) });
const attempts = []; const writes = [];
try {
  const page = await browser.newPage();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (/(firestore|identitytoolkit|securetoken|firebaseappcheck|firebaseinstallations)\.googleapis\.com$|firebaseapp\.com$/.test(url.hostname)) { attempts.push(url.hostname); await route.abort(); }
    else { if (/\/google\.firestore\.v1\.Firestore\/(Write|Commit)/.test(url.pathname)) writes.push(url.pathname); await route.continue(); }
  });
  await page.goto('http://127.0.0.1:5184/#/register');
  const config = await page.evaluate(async () => { const module = await import('/src/services/firebase.ts'); return { feature: module.isIdentityV2Enabled, emulator: module.useFirebaseEmulators, project: module.db.app.options.projectId }; });
  assert.deepEqual(config, { feature: false, emulator: true, project: 'demo-osatsu-public-serial' });
  await page.locator('#serialInput').fill('QA234112BB');
  assert.equal(await page.locator('#btn-submit-registration').isDisabled(), true);
  await page.evaluate(() => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.waitForTimeout(700);
  assert.equal(writes.length, 0); assert.equal(attempts.length, 0);
  console.log('Feature OFF: disabled button and synthetic submit cause no writes; emulator transport remains selected.');
} finally { await browser.close(); }
