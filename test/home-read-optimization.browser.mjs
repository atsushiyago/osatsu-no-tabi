// Emulator-only browser regression. All fixture transforms live in the temporary Vite server.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { Timestamp } from 'firebase/firestore';
import { adminSet, adminGet, clearDemoProject, loadRules, opaque, firestoreHost, authHost } from './helpers/identity-emulator.js';

const { chromium } = await import(pathToFileURL(process.env.OSATSU_PLAYWRIGHT_MODULE).href);
const project = 'demo-osatsu-home-browser';
const root = fileURLToPath(new URL('../', import.meta.url));
const envDir = await mkdtemp(join(tmpdir(), 'osatsu-home-browser-'));
const env = { VITE_USE_FIREBASE_EMULATORS: process.env.VITE_USE_FIREBASE_EMULATORS, VITE_BILL_IDENTITY_V2: process.env.VITE_BILL_IDENTITY_V2, VITE_IDENTITY_LAN_HOST: process.env.VITE_IDENTITY_LAN_HOST };
process.env.VITE_USE_FIREBASE_EMULATORS = 'true';
process.env.VITE_BILL_IDENTITY_V2 = 'true';
process.env.VITE_IDENTITY_LAN_HOST = '';
const firestorePort = Number(firestoreHost.split(':')[1]);
const authPort = Number(authHost.split(':')[1]);
const server = await createServer({
  configFile: false, root, envDir, mode: 'development',
  server: { host: '127.0.0.1', port: 25174, strictPort: true },
  plugins: [{
    name: 'home-emulator-test-fixtures', enforce: 'pre',
    transform(source, id) {
      if (id.endsWith('/src/utils/identityEnvironment.ts')) return source
        .replaceAll('demo-osatsu-public-serial', project)
        .replace('IDENTITY_FIRESTORE_PORT = 18080', `IDENTITY_FIRESTORE_PORT = ${firestorePort}`)
        .replace('IDENTITY_AUTH_PORT = 19099', `IDENTITY_AUTH_PORT = ${authPort}`);
      // Exercise production mount semantics; StrictMode's development probe intentionally repeats effects.
      if (id.endsWith('/src/main.tsx')) return source.replace('<StrictMode>', '<>').replace('</StrictMode>', '</>');
      if (id.endsWith('/src/App.tsx')) return source.replace('setAuthUid(user?.uid ?? null);', 'window.__homeTestUid = user?.uid; setAuthUid(user?.uid ?? null);');
      if (id.endsWith('/src/services/trackedBills.ts')) return source
        .replace('return loadHomeTrackedBills(db, uid);', 'window.__homeReads.notices++; return loadHomeTrackedBills(db, uid);')
        .replace("const trackedRef = collection(firestore, 'users', uid, 'trackedBills');", "if (!firstRegisteredByMe) window.__homeReads.followingPages++; const trackedRef = collection(firestore, 'users', uid, 'trackedBills');");
      if (id.endsWith('/src/services/billService.ts')) return source.replace('const [stats, journeys] = await Promise.all', 'window.__homeReads.public++; const [stats, journeys] = await Promise.all');
    },
  }, react()],
});
let browser;
const violations = [];
try {
  await clearDemoProject(project);
  await loadRules(await readFile(new URL('../firestore.strict.rules', import.meta.url), 'utf8'), project);
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.OSATSU_CHROMIUM_EXECUTABLE, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    window.__homeReads = { notices: 0, public: 0, followingPages: 0 };
    window.__clockOffset = 0;
    const realNow = Date.now;
    Date.now = () => realNow() + window.__clockOffset;
    localStorage.setItem('osatsu-no-tabi-language', 'ja');
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (/googleapis\.com$|firebaseapp\.com$|recaptcha/.test(url.hostname)) violations.push(url.hostname);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto('http://127.0.0.1:25174/');
  const uid = await (await page.waitForFunction(() => window.__homeTestUid && !document.querySelector('.home-refresh button')?.disabled ? window.__homeTestUid : null)).jsonValue();
  const ids = Array.from({ length: 45 }, opaque);
  const stamp = '2026-10-31T00:00:00Z';
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    await adminSet(`publicBills/${id}`, {
      id, identityVersion: 2, denomination: 1000, series: 'F', serialColor: 'black', createdAt: stamp, updatedAt: stamp,
      sightingsCount: index === 0 ? 2 : 1, totalDistanceKm: 0, firstSightedAt: stamp, lastSightedAt: stamp, lastMunicipality: '藤沢市',
    }, project);
    await adminSet(`users/${uid}/trackedBills/${id}`, {
      publicBillId: id, serialNumber: 'AA123456BB', firstRegisteredByMe: index < 10,
      createdAt: Timestamp.fromMillis(Date.parse(stamp) + index), lastSeenSightingsCount: 1, notifyOnRediscovery: true,
    }, project);
    await adminSet(`sightings/browser-${index}`, { publicBillId: id, step: 1, municipality: '藤沢市', prefecture: '神奈川県', createdAt: stamp }, project);
  }
  await adminSet('sightings/browser-new', { publicBillId: ids[0], step: 2, municipality: '横浜市', prefecture: '神奈川県', createdAt: stamp }, project);
  const ready = async () => page.waitForFunction(() => !document.querySelector('.home-refresh button')?.disabled);
  const counters = () => page.evaluate(() => ({ ...window.__homeReads }));
  const home = async () => { await page.evaluate(() => { location.hash = '#/'; }); await page.locator('.home-refresh').waitFor(); await ready(); };
  await page.locator('.home-refresh button').click();
  await page.locator('.home-new-discovery').waitFor();
  await ready();
  const initial = await counters();
  await page.evaluate(() => { location.hash = '#/search'; });
  await page.locator('#searchSerialInput').waitFor();
  await home();
  assert.deepEqual(await counters(), initial, 'Home revisit must hit both short caches');
  await page.evaluate(() => { window.__clockOffset += 31_000; window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction((before) => window.__homeReads.notices > before.notices && window.__homeReads.public > before.public, initial);
  await ready();
  const expired = await counters();
  await page.locator('.home-refresh button').click();
  await page.waitForFunction((before) => window.__homeReads.notices > before.notices && window.__homeReads.public > before.public, expired);
  await ready();
  await page.evaluate((id) => { location.hash = '#/bill/' + id; }, ids[0]);
  await page.waitForFunction(() => document.querySelector('.bill-detail-hero'));
  for (let i = 0; i < 40; i++) {
    if ((await adminGet(`users/${uid}/trackedBills/${ids[0]}`, project)).lastSeenSightingsCount === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal((await adminGet(`users/${uid}/trackedBills/${ids[0]}`, project)).lastSeenSightingsCount, 2);
  await home();
  await page.locator('.home-new-discovery').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.home-new-discovery').count(), 0, 'Seen update invalidates notification cache');
  for (const language of ['English', '日本語']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('.home-refresh').evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth;
      }), true, 'Refresh controls and explanation fit the viewport');
    }
  }
  await page.evaluate(() => { location.hash = '#/my-bills'; });
  await page.locator('.tracked-bills-list').first().waitFor();
  await page.getByRole('button', { name: 'もっと見る', exact: true }).click();
  await page.locator(`[data-public-bill-id="${ids[10]}"]`).waitFor();
  await page.locator(`[data-public-bill-id="${ids[10]}"]`).click();
  await page.locator('.bill-detail-hero').waitFor();
  const beforeRestore = await counters();
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await page.locator(`[data-public-bill-id="${ids[10]}"]`).waitFor();
  await page.waitForTimeout(300);
  assert.equal((await counters()).followingPages - beforeRestore.followingPages, 2, 'Restoration loads two pages, without a third reset request');
  assert.equal(await page.locator('[data-public-bill-id]').count(), 45, 'Restoration retains all loaded rows');
  assert.equal(violations.length, 0);
  console.log('PASS: Home cache hit/expiry/manual refresh, seen invalidation, following-list restore, JA/EN 320–430px; external Firebase attempts: 0');
} finally {
  await browser?.close();
  await server.close();
  await rm(envDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
