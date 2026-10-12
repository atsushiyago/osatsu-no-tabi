import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { changeConfig } from '../scripts/admin/registration-config.mjs';
import { clearDemoProject, loadRules, adminSet, client, closeClients } from './helpers/identity-emulator.js';
import { doc, updateDoc } from 'firebase/firestore';
if(process.env.OSATSU_CONFIG_TEST!=='true'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:28080')throw Error('Use isolated config test runner');
const project='demo-osatsu-registration-config',base=`http://127.0.0.1:28080/v1/projects/${project}/databases/(default)`;
const url=base+'/documents/appConfig/billRegistration';
const request=(url,options={})=>fetch(url,{...options,headers:{Authorization:'Bearer owner','Content-Type':'application/json'}});
const approval=(from,to,time)=>({version:2,action:'apply',project:'george-69c3a',database:'(default)',path:'appConfig/billRegistration',projectNumber:'123',region:'asia-northeast1',serviceAccount:'osatsu-config-admin@george-69c3a.iam.gserviceaccount.com',operationId:crypto.randomUUID(),approvedBy:'fixture',iamEvidence:'fixture',maintenanceEvidence:'fixture',rulesEvidence:'fixture',backupInProgress:false,backupVerificationInProgress:false,adminIamReviewed:true,sparkConfirmed:true,validFrom:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+600000).toISOString(),from,to,expectedUpdateTime:time});
test('fixed config update on demo emulator under full write freeze',async t=>{
 t.after(closeClients);await clearDemoProject(project);await loadRules(await readFile(new URL('../firestore.all-writes-paused.rules',import.meta.url),'utf8'),project);
 await t.test('absent -> paused uses exists=false and verifies readback',async()=>assert.equal((await changeConfig(approval(null,'paused',null),{request,base})).status,'verified'));
 for(const [from,to]of [['paused','v2'],['v2','paused']])await t.test(`${from} -> ${to} uses updateTime`,async()=>{const before=await (await request(url)).json();assert.equal((await changeConfig(approval(from,to,before.updateTime),{request,base})).status,'verified');});
 await t.test('concurrent administrator mutation rejects old precondition',async()=>{
 const before=await (await request(url)).json();
 await assert.rejects(changeConfig(approval('paused','v2',before.updateTime),{request,base,beforeCommit:async()=>{await adminSet('appConfig/billRegistration',{mode:'v2',identityVersion:2},project);await adminSet('appConfig/billRegistration',{mode:'paused',identityVersion:2},project);}}),/CONFIG_COMMIT_REJECTED/);
 assert.equal((await (await request(url)).json()).fields.mode.stringValue,'paused');
 });
 await t.test('lost response after commit only reads state and does not resend',async()=>{
 const before=await (await request(url)).json();let writes=0;
 const transport=async(u,o)=>{const r=await request(u,o);if(o?.method==='POST'){writes++;throw Error('lost response');}return r;};
 const result=await changeConfig(approval('paused','v2',before.updateTime),{request:transport,base});assert.equal(result.status,'observed-target-after-uncertainty');assert.equal(writes,1);
 });
 await t.test('duplicate initial creation refuses to overwrite existing config',async()=>await assert.rejects(changeConfig(approval(null,'paused',null),{request,base}),/PREVIOUS_STATE_MISMATCH/));
 await t.test('unknown fields refuse update and normal authenticated client remains denied',async()=>{
 await adminSet('appConfig/billRegistration',{mode:'v2',identityVersion:2,unexpected:true},project);
 const before=await (await request(url)).json();await assert.rejects(changeConfig(approval('v2','paused',before.updateTime),{request,base}),/CONFIG_INVALID/);
 const c=await client('config-normal-client',true,project);await assert.rejects(updateDoc(doc(c.db,'appConfig','billRegistration'),{mode:'paused'}),e=>e.code==='permission-denied');
 });
});
