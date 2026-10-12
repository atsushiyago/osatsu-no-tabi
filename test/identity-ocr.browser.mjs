// UI contract test only: recognition output is a stub. Not a camera/worker test.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.OSATSU_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.OSATSU_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OSATSU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OSATSU_CHROMIUM_EXECUTABLE } : {}) });
const folder = '/tmp/osatsu-v4-ocr-ui'; await mkdir(folder, { recursive: true });
const records = []; const blocked = [];
try {
  for (const language of ['ja', 'en']) for (const width of [320, 375, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript((language) => localStorage.setItem('osatsu-no-tabi-language', language), language);
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (/(firestore|identitytoolkit|securetoken|firebaseappcheck|firebaseinstallations)\.googleapis\.com$|firebaseapp\.com$/.test(url.hostname)) { blocked.push(url.hostname); await route.abort(); }
      else if (url.pathname === '/src/utils/ocr.ts') await route.fulfill({ contentType: 'application/javascript', body: `
        export async function analyzeBlobStats() { return { width: 640, height: 120, meanBrightness: 200, darkPixelRatio: .2 }; }
        export async function recognizeBanknoteSerialFromImage() { return [{ serial: 'QA234111BB', confidence: 99, sourcePass: 'UI stub', correctionCount: 0 }]; }
      ` });
      else await route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.goto('http://127.0.0.1:5174/?debug=timing#/register');
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 120;
      const c = canvas.getContext('2d'); c.fillStyle = 'white'; c.fillRect(0, 0, 640, 120); c.fillStyle = 'black'; c.font = '48px monospace'; c.fillText('QA234111BB', 20, 75); return canvas.toDataURL('image/png').split(',')[1]; });
    await page.locator('#ocr-file-input').setInputFiles({ name: 'synthetic-serial.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.locator('#btn-apply-crop').click();
    const candidate = page.getByRole('button', { name: /QA234111BB/ });
    await candidate.waitFor();
    assert.equal(await page.locator('#serialInput').inputValue(), '', 'OCR must not auto-confirm identity');
    await candidate.click();
    assert.equal(await page.locator('#serialInput').inputValue(), 'QA234111BB');
    assert.equal(await page.locator('#btn-submit-registration').isDisabled(), true, 'design must remain unknown');
    await page.locator('#identity-design-F').click();
    await page.waitForFunction(() => !document.getElementById('btn-submit-registration').disabled);
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    records.push({ language, width, candidateInput: 'passed', debugDocumentWidth: documentWidth, recognition: 'stubbed' });
    await page.screenshot({ path: `${folder}/${language}-${width}-ocr-input.png`, fullPage: true, style: 'aside[aria-label="Firestore 計測ログ"] { visibility:hidden !important; }' });
    await context.close();
  }
  assert.equal(blocked.length, 0);
} finally { await browser.close(); await writeFile(`${folder}/results.json`, JSON.stringify({ records, productionFirebaseAttempts: blocked }, null, 2)); }
console.log(JSON.stringify({ records, folder, productionFirebaseAttempts: blocked.length }));
