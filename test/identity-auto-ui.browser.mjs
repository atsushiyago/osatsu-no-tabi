import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.OSATSU_PLAYWRIGHT_MODULE).href);
const origin='http://192.168.1.13:5174';const out='/tmp/osatsu-auto-f-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.OSATSU_CHROMIUM_EXECUTABLE,args:['--disable-background-networking']});
const results=[],violations=[];
try{
 for(const language of ['ja','en'])for(const width of [320,375,390,430]){
  const context=await browser.newContext({viewport:{width,height:900},locale:language==='ja'?'ja-JP':'en-US'});
  await context.addInitScript(language=>localStorage.setItem('osatsu-no-tabi-language',language),language);
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(/googleapis\.com$|firebaseapp\.com$|recaptcha/.test(u.hostname)){violations.push(u.hostname);return route.abort();}return u.origin===origin?route.continue():route.abort();});
  const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(origin+'/#/register');
  await page.locator('#serialInput').fill('AA123456B');await page.locator('#serialInput').blur();await page.locator('#identity-design-E').click();await page.locator('#identity-color-brown').click();
  const textSize=await page.locator('.identity-options .identity-option > span').evaluateAll(elements=>elements.map(el=>parseFloat(getComputedStyle(el).fontSize)));
  assert.ok(textSize.every(n=>n>=16));await page.screenshot({path:`${out}/${language}-${width}-old-design.png`,fullPage:true});
  for(const denom of [1000,5000,10000]){
   await page.locator('#denom-'+denom).click();await page.locator('#serialInput').fill('AA123456BB');await page.locator('#serialInput').blur();
   await page.locator('.identity-auto-design').waitFor();assert.equal(await page.locator('.identity-options button').count(),0);assert.equal(await page.locator('.identity-colors button').count(),0);
   await page.waitForFunction(()=>!document.getElementById('btn-submit-registration').disabled);
  }
  await page.screenshot({path:`${out}/${language}-${width}-automatic-F.png`,fullPage:true});
  await page.locator('#serialInput').fill('AA000000BB');assert.equal(await page.locator('#identity-design-E').count(),0);assert.equal(await page.locator('.identity-auto-design').count(),0);assert.equal(await page.locator('#btn-submit-registration').isDisabled(),true);
  await page.locator('#serialInput').fill('AA12345BB');assert.equal(await page.locator('.identity-auto-design').count(),0);
  await page.locator('#denom-2000').click();await page.locator('#serialInput').fill('AA123456B');await page.locator('#serialInput').blur();await page.locator('.identity-auto-design').waitFor();await page.waitForFunction(()=>!document.getElementById('btn-submit-registration').disabled);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`${out}/${language}-${width}-automatic-D2000.png`,fullPage:true});
  results.push({language,width,minDesignFont:Math.min(...textSize),status:'passed'});await context.close();
 }
 const context=await browser.newContext();await context.route('**/*',r=>{const u=new URL(r.request().url());if(/googleapis\.com$|firebaseapp\.com$/.test(u.hostname)){violations.push(u.hostname);return r.abort();}return u.origin===origin?r.continue():r.abort();});
 const page=await context.newPage();await page.goto(origin+'/#/register');const serial='AA'+String(100000+Math.floor(Math.random()*700000))+'BB';
 await page.locator('#serialInput').fill(serial);await page.locator('#serialInput').blur();await page.waitForFunction(()=>!document.getElementById('btn-submit-registration').disabled);await page.locator('#btn-submit-registration').click();await page.waitForURL(/#\/bill\//);
 const id=page.url().split('/').at(-1);const data=await page.evaluate(async serial=>{const s=await import('/src/services/billIdentityUiService.ts');return s.findExactBillIdentity({denomination:1000,series:'F',serialColor:'black',serialNumber:serial});},serial);
 assert.equal(data.series,'F');assert.equal(data.serialColor,'black');assert.equal(data.id,id);await context.close();
 assert.equal(violations.length,0);await writeFile(`${out}/results.json`,JSON.stringify({results,FRegistration:'passed',productionFirebaseAttempts:0},null,2));console.info('Automatic F / readable D/E / D2000: JA/EN x 4 widths passed; 24 screenshots; F UI registration passed; production Firebase attempts 0.');
}finally{await browser.close();}
