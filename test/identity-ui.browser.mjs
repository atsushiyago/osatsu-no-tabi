// Optional browser verification. Start firebase.identity-v2.json and npm run dev:identity first.
// Supply OSATSU_PLAYWRIGHT_MODULE if Playwright is provided outside this repository.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { adminSet, adminGet, client, ageBill, opaque, closeClients, loadRules, rawKey, clearDemoProject } from './helpers/identity-emulator.js';
import { readFile } from 'node:fs/promises';
import { registerBillIdentityV2InEmulator } from '../src/services/billIdentityRegistry.ts';
const moduleName = process.env.OSATSU_PLAYWRIGHT_MODULE ?? 'playwright';
const { chromium } = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
const url = 'http://127.0.0.1:5174';
const output = resolve(process.env.OSATSU_UI_SCREENSHOTS ?? '/tmp/osatsu-v4-ui');
await mkdir(output, { recursive: true });
await clearDemoProject('demo-osatsu-public-serial');
await loadRules(await readFile(new URL('../firestore.strict.rules', import.meta.url), 'utf8'), 'demo-osatsu-public-serial');
await adminSet('appConfig/billRegistration', { mode: 'v2', identityVersion: 2 });
const seed = await client('ui-seed');
const serial = 'QA654321B';
const identity = (series, serialColor, denomination = 1000, serialNumber = serial) => ({ series, serialColor, denomination, serialNumber });
const location = { prefecture: '東京都', municipality: '千代田区' };
const ids = [];
for (const data of [identity('D', 'black'), identity('E', 'black'), identity('E', 'brown')]) {
  const result = await registerBillIdentityV2InEmulator(seed.db, seed.auth, { ...data, ...location });
  ids.push(result.publicBillId);
}
const legacyId = opaque();
const now = new Date().toISOString();
await adminSet(`serialIndex/${serial}`, { publicBillId: legacyId, denomination: 1000, createdAt: new Date() });
await adminSet(`publicBills/${legacyId}`, { id: legacyId, denomination: 1000, createdAt: now, updatedAt: now, firstSightedAt: now, lastSightedAt: now, sightingsCount: 1, totalDistanceKm: 0, lastMunicipality: '千代田区' });
const legacySightingId = opaque();
await adminSet(`sightings/${legacySightingId}`, { id: legacySightingId, publicBillId: legacyId, step: 1, prefecture: '東京都', municipality: '千代田区', createdAt: now, distanceFromPrevKm: 0, daysFromPrev: 0 });
const legacyBefore = await adminGet(`publicBills/${legacyId}`);
const browser = await chromium.launch({ headless: true, ...(process.env.OSATSU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OSATSU_CHROMIUM_EXECUTABLE } : {}) });
const results = [];
const violations = [];
let screenshots = 0;
async function pageFor(language, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
  await context.addInitScript((language) => { if (!localStorage.getItem('osatsu-no-tabi-language')) localStorage.setItem('osatsu-no-tabi-language', language); }, language);
  await context.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (/(firestore|identitytoolkit|securetoken|firebaseappcheck|firebaseinstallations)\.googleapis\.com$|firebaseapp\.com$/.test(requestUrl.hostname)) {
      violations.push(requestUrl.hostname); await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  return { page, context };
}
async function check(page, name, capture = true) {
  await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready; });
  await page.waitForTimeout(300);
  if (name.includes('modal')) {
    const bounds = await page.locator('.celebration-message-heading').locator('..').boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 900, `${name}: modal outside viewport`);
  }
  const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.width + 1, `${name}: horizontal overflow ${JSON.stringify(dimensions)}`);
  const clipped = await page.locator('.identity-option,.identity-candidate,.identity-notice').evaluateAll((elements) => elements.filter((el) => el.scrollWidth > el.clientWidth + 1).length);
  assert.equal(clipped, 0, `${name}: clipped identity text`);
  if (capture) { await page.screenshot({ path: `${output}/${name}.png`, fullPage: !name.includes('modal'), style: 'aside[aria-label="Firestore 計測ログ"] { visibility: hidden !important; }' }); screenshots++; }
}
async function registration(page, data) {
  await page.goto(`${url}/#/register`);
  await page.locator(`#denom-${data.denomination}`).click();
  await page.locator('#serialInput').fill(data.serialNumber);
  if (data.denomination !== 2000) await page.locator(`#identity-design-${data.series}`).click();
  if (data.series !== 'F' && data.denomination !== 2000) await page.locator(`#identity-color-${data.serialColor}`).click();
  await page.locator('#btn-submit-registration').waitFor();
  await assertEnabled(page.locator('#btn-submit-registration'));
}
async function assertEnabled(locator) {
  await locator.page().waitForFunction((id) => !document.getElementById(id)?.disabled, await locator.getAttribute('id'));
}
try {
  for (const language of ['ja', 'en']) for (const width of [320, 375, 390, 430, 1280]) {
    const { page, context } = await pageFor(language, width);
    const name = `${language}-${width}`;
    await registration(page, identity('E', 'navy'));
    await check(page, `${name}-design-color`);
    await page.locator('#identity-color-unknown').click();
    assert.equal(await page.locator('#btn-submit-registration').isDisabled(), true);
    await check(page, `${name}-hold`);
    await page.locator('#identity-color-navy').click();
    await assertEnabled(page.locator('#btn-submit-registration'));
    await page.locator('#btn-submit-registration').click();
    await page.locator('[role="alertdialog"]').waitFor();
    await check(page, `${name}-legacy-confirmation`);
    await page.locator('[role="alertdialog"] button').last().click();
    assert.equal(await page.locator('[role="alertdialog"]').count(), 0);
    await registration(page, identity('F', 'black', 1000, 'QA654321BB'));
    assert.equal(await page.locator('.identity-colors button').count(), 0);
    await check(page, `${name}-F`);
    await page.locator('#serialInput').fill('QA654321B');
    assert.equal(await page.locator('#btn-submit-registration').isDisabled(), true);
    await page.locator('[role="alert"]').filter({ hasText: language === 'ja' ? '形式が一致' : 'do not match' }).waitFor();
    await check(page, `${name}-mismatch`);
    await registration(page, identity('D', 'black', 2000));
    assert.equal(await page.locator('.identity-colors button').count(), 0);
    await check(page, `${name}-2000`);
    await page.goto(`${url}/#/search`);
    await page.locator('#searchSerialInput').fill(serial);
    await page.locator('#btn-execute-search').click();
    await page.locator('.identity-candidate').first().waitFor();
    assert.equal(await page.locator('.identity-candidate').count(), 4);
    await check(page, `${name}-search`);
    // Language changes are immediate and do not drop candidate records.
    await page.getByRole('button', { name: language === 'ja' ? 'English' : '日本語', exact: true }).click();
    assert.equal(await page.locator('.identity-candidate').count(), 4);
    await check(page, `${name}-switched-search`);
    // Editing input clears stale results rather than allowing old records to win.
    await page.locator('#searchSerialInput').fill('QA654322B');
    assert.equal(await page.locator('.identity-candidate').count(), 0);
    results.push({ language, width, status: 'passed' });
    await context.close();
  }
  assert.equal(await adminGet(`billIdentityIndex/${rawKey(identity('E', 'navy'))}`), null, 'cancel/hold must not register');
  assert.deepEqual(await adminGet(`publicBills/${legacyId}`), legacyBefore);

  const { page, context } = await pageFor('ja', 390);
  await registration(page, identity('E', 'navy'));
  await page.locator('#btn-submit-registration').click();
  await page.locator('#identity-confirm-legacy').waitFor();
  await page.locator('#identity-confirm-legacy').click();
  await page.waitForURL(/#\/bill\//);
  const independentId = (await adminGet(`billIdentityIndex/${rawKey(identity('E', 'navy'))}`)).publicBillId;
  assert.notEqual(independentId, legacyId);
  assert.deepEqual(await adminGet(`publicBills/${legacyId}`), legacyBefore);
  await check(page, 'ja-390-independent-detail');

  const linkedUid = await page.evaluate(async () => {
    const { auth, useFirebaseEmulators } = await import('/src/services/firebase.ts');
    if (!useFirebaseEmulators || auth.app.options.projectId !== 'demo-osatsu-public-serial') throw new Error('emulator required');
    const { GoogleAuthProvider, linkWithCredential } = await import('/node_modules/.vite/deps/firebase_auth.js');
    const before = auth.currentUser.uid;
    const encode = (data) => btoa(JSON.stringify(data)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ iss: 'https://accounts.google.com', aud: auth.app.options.projectId,
      sub: `browser-${before}`, email: `${before}@example.invalid`, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
    const linked = await linkWithCredential(auth.currentUser, GoogleAuthProvider.credential(token));
    if (linked.user.uid !== before) throw new Error('UID changed');
    return before;
  });
  const trackedBefore = await adminGet(`users/${linkedUid}/trackedBills/${independentId}`);
  for (const language of ['ja', 'en']) for (const width of [320, 375, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((language) => localStorage.setItem('osatsu-no-tabi-language', language), language);
    await page.goto(`${url}/#/my-bills`);
    await page.reload();
    await page.getByRole('heading', { name: language === 'ja' ? 'Googleと同期しています' : 'Synced with Google', exact: true }).waitFor();
    await page.locator('.tracked-bill-card').first().waitFor();
    await check(page, `${language}-${width}-google-linked-tracked`);
    for (const [kind, id] of [['legacy', legacyId], ['v2', independentId]]) {
      await page.goto(`${url}/#/bill/${id}`);
      await page.locator('.leaflet-container').waitFor();
      await check(page, `${language}-${width}-${kind}-detail-map`);
      assert.equal(page.url().includes(serial), false);
    }
  }
  const trackedAfter = await adminGet(`users/${linkedUid}/trackedBills/${independentId}`);
  for (const field of ['publicBillId', 'serialNumber', 'denomination', 'createdAt', 'firstRegisteredByMe', 'notifyOnRediscovery', 'series', 'serialColor']) assert.deepEqual(trackedAfter[field], trackedBefore[field]);
  await context.close();
  // Exact rediscovery keeps the UUID and opens the existing modal at every width.
  for (const language of ['ja', 'en']) for (const width of [320, 375, 390, 430, 1280]) {
    const modal = await pageFor(language, width);
    await ageBill(ids[1]);
    await registration(modal.page, identity('E', 'black'));
    await modal.page.locator('#btn-submit-registration').click();
    await modal.page.getByRole('button', { name: language === 'ja' ? '閉じる' : 'Close', exact: true }).waitFor();
    await check(modal.page, `${language}-${width}-rediscovery-modal`);
    const index = await adminGet(`billIdentityIndex/${rawKey(identity('E', 'black'))}`);
    assert.equal(index.publicBillId, ids[1]);
    await modal.context.close();
  }
  for (const data of [identity('F', 'black', 1000, 'QA654322BB'), identity('D', 'black', 2000, 'QA654322B')]) {
    const fresh = await pageFor('en', 375);
    await registration(fresh.page, data);
    await fresh.page.locator('#btn-submit-registration').click();
    await fresh.page.waitForURL(/#\/bill\//);
    const record = await adminGet(`billIdentityIndex/${rawKey(data)}`);
    assert.equal((await adminGet(`publicBills/${record.publicBillId}`)).sightingsCount, 1);
    await fresh.context.close();
  }
  const paused = await pageFor('ja', 375);
  await adminSet('appConfig/billRegistration', { mode: 'paused', identityVersion: 2 });
  await registration(paused.page, identity('F', 'black', 1000, 'QA654326BB'));
  await paused.page.locator('#btn-submit-registration').click();
  await paused.page.getByText('現在、登録を停止しています。', { exact: false }).waitFor();
  assert.equal(await adminGet('billIdentityIndex/v2_JPY_1000_F_black_QA654326BB'), null);
  await paused.page.goto(`${url}/#/search`);
  await paused.page.locator('#searchSerialInput').fill(serial);
  await paused.page.locator('#btn-execute-search').click();
  await paused.page.locator('.identity-candidate').first().waitFor();
  await check(paused.page, 'ja-375-paused-search');
  await paused.context.close();
  await adminSet('appConfig/billRegistration', { mode: 'v2', identityVersion: 2 });

  // Edits made while a search is pending invalidate its late response.
  const stale = await pageFor('en', 320);
  await stale.page.goto(`${url}/#/search`);
  await stale.page.locator('#searchSerialInput').fill(serial);
  await stale.page.locator('#btn-execute-search').click();
  await stale.page.locator('#searchSerialInput').fill('QA654323B');
  await stale.page.waitForTimeout(1200);
  assert.equal(await stale.page.locator('.identity-candidate').count(), 0);
  assert.equal(await stale.page.locator('#searchSerialInput').inputValue(), 'QA654323B');
  await stale.page.locator('#btn-execute-search').click();
  await stale.page.locator('#btn-register-not-found').waitFor();
  assert.equal(await stale.page.getByRole('alert').count(), 0);
  await check(stale.page, 'en-320-not-found');
  await stale.context.close();

  // A stopped emulator/connection never falls back to production or "not found".
  const offline = await pageFor('en', 390);
  await offline.page.goto(`${url}/#/search`);
  await offline.page.route('http://127.0.0.1:18080/v1/**', (route) => route.abort());
  await offline.page.locator('#searchSerialInput').fill(serial);
  await offline.page.locator('#btn-execute-search').click();
  await offline.page.getByRole('alert').waitFor();
  assert.match(await offline.page.getByRole('alert').innerText(), /emulators are unavailable/);
  assert.equal(await offline.page.locator('#btn-register-not-found').count(), 0);
  await check(offline.page, 'en-390-offline-search');
  await offline.page.goto(`${url}/#/register`);
  await offline.page.locator('#serialInput').fill('QA654324BB');
  await offline.page.locator('#identity-design-F').click();
  await offline.page.getByText('The test emulators are unavailable.', { exact: false }).waitFor();
  assert.equal(await offline.page.locator('#btn-submit-registration').isDisabled(), true);
  assert.equal(await adminGet('billIdentityIndex/v2_JPY_1000_F_black_QA654324BB'), null);
  await check(offline.page, 'en-390-offline-register');
  await offline.context.close();
  const rules = await readFile(new URL('../firestore.strict.rules', import.meta.url), 'utf8');
  const deniedRules = rules.replace('match /billIdentityIndex/{key} {\n      allow get: if request.auth != null;', 'match /billIdentityIndex/{key} {\n      allow get: if false;');
  assert.notEqual(deniedRules, rules, 'permission test must actually restrict an index get');
  try {
    await loadRules(deniedRules, 'demo-osatsu-public-serial');
    const forbidden = await pageFor('ja', 375);
    await forbidden.page.goto(`${url}/#/search`);
    await forbidden.page.locator('#searchSerialInput').fill(serial);
    await forbidden.page.locator('#btn-execute-search').click();
    await forbidden.page.getByRole('alert').waitFor();
    assert.match(await forbidden.page.getByRole('alert').innerText(), /検索が許可されません/);
    assert.equal(await forbidden.page.locator('#btn-register-not-found').count(), 0);
    await check(forbidden.page, 'ja-375-permission-search');
    await forbidden.context.close();
  } finally { await loadRules(rules, 'demo-osatsu-public-serial'); }

  const racers = await Promise.all([pageFor('ja', 390), pageFor('en', 390)]);
  const racingIdentity = identity('F', 'black', 1000, 'QA654325BB');
  await Promise.all(racers.map(({ page }) => registration(page, racingIdentity)));
  await Promise.all(racers.map(({ page }) => page.locator('#btn-submit-registration').click()));
  await Promise.all(racers.map(async ({ page }) => {
    await page.waitForFunction(() => location.hash.startsWith('#/bill/') || document.querySelector('.identity-notice[role="status"]'));
  }));
  const racingIndex = await adminGet(`billIdentityIndex/${rawKey(racingIdentity)}`);
  assert.equal((await adminGet(`publicBills/${racingIndex.publicBillId}`)).sightingsCount, 1);
  await Promise.all(racers.map(({ context }) => context.close()));
  assert.equal(violations.length, 0, 'No production Firebase request is permitted');
} finally {
  await browser.close();
  await closeClients();
  await writeFile(`${output}/results.json`, JSON.stringify({ results, screenshots, productionFirebaseRequests: violations }, null, 2));
}
console.log(JSON.stringify({ results, screenshots, output, productionFirebaseRequests: violations.length }));
