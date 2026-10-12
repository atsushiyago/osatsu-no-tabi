import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.OSATSU_PLAYWRIGHT_MODULE).href);
const origin='http://192.168.1.13:5174',out='/tmp/osatsu-staged-registration';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.OSATSU_CHROMIUM_EXECUTABLE,args:['--disable-background-networking']});
const results=[],violations=[];
try{
 for(const language of ['ja','en'])for(const width of [320,375,390,430]){
  const context=await browser.newContext({viewport:{width,height:900},locale:language==='ja'?'ja-JP':'en-US'});
  await context.addInitScript(l=>localStorage.setItem('osatsu-no-tabi-language',l),language);
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(/googleapis\.com$|firebaseapp\.com$|recaptcha/.test(u.hostname)){violations.push(u.hostname);return r.abort();}return u.origin===origin?r.continue():r.abort();});
  const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(origin+'/#/register');const input=page.locator('#serialInput');
  assert.equal(await page.locator('.identity-fields').count(),0);await page.screenshot({path:`${out}/${language}-${width}-initial.png`,fullPage:true});
  await input.pressSequentially('AA123456B');assert.equal(await page.locator('.identity-fields').count(),0);
  await input.pressSequentially('B');assert.equal(await page.locator('.identity-fields').count(),0);
  await input.press('Enter');await page.locator('.identity-auto-design').waitFor();assert.equal(await page.locator('.identity-options').count(),0);assert.equal(await page.locator('.identity-colors').count(),0);
  await page.screenshot({path:`${out}/${language}-${width}-F-confirmed.png`,fullPage:true});
  await input.fill('AA123456B');assert.equal(await page.locator('.identity-fields').count(),0);await input.blur();
  await page.locator('#identity-design-E').waitFor();assert.equal(await page.locator('.identity-colors').count(),0);
  await page.screenshot({path:`${out}/${language}-${width}-design-only.png`,fullPage:true});
  await page.locator('#identity-design-E').click();await page.locator('#identity-color-brown').waitFor();assert.equal(await page.locator('.identity-colors [aria-pressed="true"]').count(),0);assert.equal(await page.locator('#btn-submit-registration').isDisabled(),true);
  const fonts=await page.locator('.identity-options .identity-option > span').evaluateAll(es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize)));assert.ok(fonts.every(n=>n>=16));
  await page.locator('#identity-color-brown').click();await page.waitForFunction(()=>!document.getElementById('btn-submit-registration').disabled);
  await page.screenshot({path:`${out}/${language}-${width}-color-selected.png`,fullPage:true});
  await input.fill('AA000000B');await input.blur();assert.equal(await page.locator('.identity-fields').count(),0);assert.equal(await page.locator('#btn-submit-registration').isDisabled(),true);
  await input.fill('AA123457B');await input.blur();await page.locator('#identity-design-E').waitFor();assert.equal(await page.locator('.identity-options [aria-pressed="true"]').count(),0);assert.equal(await page.locator('.identity-colors').count(),0);
  await page.locator('#denom-2000').click();await page.locator('.identity-auto-design').waitFor();assert.equal(await page.locator('.identity-options').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  results.push({language,width,status:'passed'});await context.close();
 }
 const context=await browser.newContext();await context.route('**/*',r=>{const u=new URL(r.request().url());if(/googleapis\.com$|firebaseapp\.com$/.test(u.hostname)){violations.push(u.hostname);return r.abort();}return u.origin===origin?r.continue():r.abort();});
 const page=await context.newPage();await page.goto(origin+'/#/register');await page.locator('#serialInput').fill('AA'+String(100000+Math.floor(Math.random()*700000))+'BB');await page.locator('#identity-confirm-input').click();await page.waitForFunction(()=>!document.getElementById('btn-submit-registration').disabled);await page.locator('#btn-submit-registration').click();await page.waitForURL(/#\/bill\//);
 await page.goto(origin+'/#/register');await page.locator('#serialInput').fill('EA'+String(100000+Math.floor(Math.random()*700000))+'B');await page.locator('#serialInput').blur();await page.locator('#identity-design-E').click();await page.locator('#identity-color-brown').click();await page.waitForFunction(()=>!document.getElementById('btn-submit-registration').disabled);await page.locator('#btn-submit-registration').click();await page.waitForURL(/#\/bill\//);await context.close();
 assert.equal(violations.length,0);await writeFile(out+'/results.json',JSON.stringify({results,stagedFRegistration:'passed',stagedERegistration:'passed',productionFirebaseAttempts:0},null,2));console.info('Staged UI: JA/EN x 4 widths, no 9-to-10 flicker, confirmation/selection resets, F/E form registration passed. 32 screenshots; production Firebase attempts 0.');
}finally{await browser.close();}
