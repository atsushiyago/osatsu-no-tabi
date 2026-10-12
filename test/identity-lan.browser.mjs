import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const host=process.env.OSATSU_LAN_HOST;
if(!/^192\.168\.\d+\.\d+$/.test(host??''))throw new Error('Explicit LAN fixture host required');
const {chromium}=await import(pathToFileURL(process.env.OSATSU_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.OSATSU_CHROMIUM_EXECUTABLE,args:['--disable-background-networking']});
const violations=[],results=[];
const origin=`http://${host}:5174`;
try{
 for(const language of ['ja','en'])for(const width of [320,375,390,430]){
  const context=await browser.newContext({viewport:{width,height:900},locale:language==='ja'?'ja-JP':'en-US'});
  await context.addInitScript(language=>localStorage.setItem('osatsu-no-tabi-language',language),language);
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(/googleapis\.com$|firebaseapp\.com$|recaptcha/.test(url.hostname)){violations.push(url.hostname);await route.abort();return;}
   if(url.origin!==origin){await route.abort();return;}
   await route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  await page.goto(origin+'/#/register');
  const config=await page.evaluate(async()=>{const m=await import('/src/services/firebase.ts');await m.ensureAnonymousUser();return {emulator:m.useFirebaseEmulators,feature:m.isIdentityV2Enabled,project:m.db.app.options.projectId,endpoint:m.emulatorEndpoint,authHost:m.auth.emulatorConfig.host,appCheck:m.isAppCheckConfigured,uuid:crypto.randomUUID()};});
  assert.equal(config.emulator,true);assert.equal(config.feature,true);assert.equal(config.project,'demo-osatsu-public-serial');assert.equal(config.endpoint.host,host);assert.equal(config.authHost,host);assert.equal(config.appCheck,false);assert.match(config.uuid,/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  for(const denomination of [1000,2000,5000,10000]){await page.locator('#denom-'+denomination).click();await page.locator('#serialInput').fill(denomination===2000?'LA123456B':'LA123456BB');if(denomination!==2000)assert.equal(await page.locator('#identity-design-F').count(),0);}
  await page.locator('#denom-1000').click();await page.locator('#serialInput').fill('QA654321B');await page.locator('#serialInput').blur();await page.locator('#identity-design-E').click();await page.locator('#identity-color-brown').click();
  await page.waitForFunction(()=>!document.getElementById('btn-submit-registration').disabled);
  await page.locator('#btn-submit-registration').click();await page.locator('#identity-confirm-legacy').waitFor();
  await page.locator('[role="alertdialog"] button').last().click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.goto(origin+'/#/search');await page.locator('#searchSerialInput').fill('QA654321B');await page.locator('#btn-execute-search').click();await page.locator('.identity-candidate').first().waitFor();
  results.push({language,width,config:'demo LAN',status:'passed'});
  await context.close();
 }
 const context=await browser.newContext();
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(/googleapis\.com$|firebaseapp\.com$/.test(url.hostname)){violations.push(url.hostname);await route.abort();}else if(url.origin!==origin)await route.abort();else await route.continue();});
 const page=await context.newPage();await page.goto(origin+'/#/register');
 const freshSerial='LA'+String(100000+Math.floor(Math.random()*700000))+'B';
 const operation=await page.evaluate(async(freshSerial)=>{const s=await import('/src/services/billIdentityUiService.ts');return s.registerIdentityForUi({denomination:1000,series:'E',serialColor:'black',serialNumber:freshSerial,prefecture:'東京都',municipality:'千代田区'});},freshSerial);
 assert.equal(operation.status,'complete');
 const unavailable=await page.evaluate(async()=>{
  const original=window.fetch;window.fetch=async(input,options)=>{if(String(input).includes('/emulator/v1/')||String(input).includes('/documents/appConfig'))throw new Error('simulated unavailable');return original(input,options);};
  try{const s=await import('/src/services/billIdentityUiService.ts');await s.registerIdentityForUi({denomination:1000,series:'E',serialColor:'brown',serialNumber:'LA654322B',prefecture:'東京都',municipality:'千代田区'});return 'unexpected success';}catch(e){return e.code;}finally{window.fetch=original;}
 });
 assert.equal(unavailable,'emulator-unavailable');await context.close();
 assert.equal(violations.length,0,'Production Firebase request attempted');
 await mkdir('/tmp/osatsu-lan-verification',{recursive:true});await writeFile('/tmp/osatsu-lan-verification/results.json',JSON.stringify({results,registration:'passed',emulatorUnavailable:'blocked',productionFirebaseAttempts:violations.length},null,2));
 console.info('LAN proxy: anonymous Auth, Firestore reads/registration, unavailable guard and 8 JA/EN widths passed. Production Firebase attempts: 0.');
}finally{await browser.close();}
