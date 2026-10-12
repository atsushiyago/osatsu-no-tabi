import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfigApproval, changeConfig, verifyAdmin, verifyToken, readConfigApproval, bindApproval, inspectConfig, main } from '../scripts/admin/registration-config.mjs';
import { maintenanceLock, endBackupLease } from '../scripts/admin/maintenance-lock.mjs';
const time=Date.parse('2026-10-13T00:00:00Z');
export const approval=()=>({version:2,action:'apply',project:'george-69c3a',database:'(default)',path:'appConfig/billRegistration',projectNumber:'123',region:'asia-northeast1',serviceAccount:'osatsu-config-admin@george-69c3a.iam.gserviceaccount.com',operationId:crypto.randomUUID(),approvedBy:'fixture',iamEvidence:'fixture',maintenanceEvidence:'fixture',rulesEvidence:'fixture',backupInProgress:false,backupVerificationInProgress:false,adminIamReviewed:true,sparkConfirmed:true,validFrom:new Date(time-1000).toISOString(),validUntil:new Date(time+600000).toISOString(),from:'paused',to:'v2',expectedUpdateTime:'2026-10-13T00:00:00Z'});
const base='https://firestore.googleapis.com/v1/projects/george-69c3a/databases/(default)';
const name='projects/george-69c3a/databases/(default)/documents/appConfig/billRegistration';
function mock(a,options={}) {
 let document=a.from===null?null:{name,fields:{mode:{stringValue:a.from},identityVersion:{integerValue:'2'}},updateTime:a.expectedUpdateTime};
 const writes=[];let reads=0;
 return {writes,request:async(url,o={})=>{
  assert.ok(url===base+'/documents/appConfig/billRegistration'||url===base+'/documents:commit');
  if(o.method==='POST'){
   const body=JSON.parse(o.body);writes.push(body);assert.equal(body.writes.length,1);const w=body.writes[0];assert.equal(w.update.name,name);
   assert.deepEqual(w.currentDocument,a.from===null?{exists:false}:{updateTime:a.expectedUpdateTime});
   if(options.reject)return new Response('{}',{status:409});
   if(!options.noChange)document={...w.update,updateTime:'2026-10-13T00:00:01Z'};
   if(options.network)throw new Error('network');return new Response('{}');
  }
  reads++;if(options.readFailure&&reads>1)throw new Error('network');
  const value=options.wrongState&&reads===1?{...document,fields:{mode:{stringValue:'v2'},identityVersion:{integerValue:'2'}}}:document;
  return new Response(value?JSON.stringify(value):'{}',{status:value?200:404});
 }};
}
for(const [from,to]of [[null,'paused'],['paused','v2'],['v2','paused']])test(`allowed transition ${from} -> ${to}`,async()=>{const a={...approval(),from,to,expectedUpdateTime:from===null?null:approval().expectedUpdateTime},m=mock(a);assert.equal((await changeConfig(a,{request:m.request,base,now:()=>time})).status,'verified');assert.equal(m.writes.length,1);});
for(const [key,value]of Object.entries({project:'wrong',database:'other',path:'publicBills/x',serviceAccount:'osatsu-backup-reader@george-69c3a.iam.gserviceaccount.com',backupInProgress:true,backupVerificationInProgress:true,adminIamReviewed:false,approvedBy:'',expectedUpdateTime:null,validUntil:'2026-10-12T00:00:00Z',to:'legacy',from:null}))test('reject approval '+key,()=>assert.throws(()=>validateConfigApproval({...approval(),[key]:value},'apply',time)));
test('stale prior state and wrong endpoint reject without a write',async()=>{const a=approval(),m=mock(a,{wrongState:true});await assert.rejects(changeConfig(a,{request:m.request,base,now:()=>time}));assert.equal(m.writes.length,0);await assert.rejects(changeConfig(a,{request:m.request,base:base.replace('george-69c3a','wrong'),now:()=>time}));});
for(const [option,expected]of [[{network:true},'observed-target-after-uncertainty'],[{network:true,noChange:true},'not-confirmed'],[{network:true,readFailure:true},'unknown'],[{noChange:true},'verification-failed']])test('uncertain result '+expected,async()=>{const a=approval(),m=mock(a,option);assert.equal((await changeConfig(a,{request:m.request,base,now:()=>time})).status,expected);assert.equal(m.writes.length,1);});
test('explicit commit rejection and consumed receipt never resend',async()=>{const a=approval(),m=mock(a,{reject:true});await assert.rejects(changeConfig(a,{request:m.request,base,now:()=>time}));assert.equal(m.writes.length,1);const n=mock(a);await assert.rejects(changeConfig(a,{request:n.request,base,now:()=>time,beforeCommit:()=>{throw Error('EEXIST');}}));assert.equal(n.writes.length,0);});
test('metadata project/database and IAM permissions checked',async()=>{
 for(const mismatch of [null,'project','database','iam']){
 const a=approval();const request=async(url)=>new Response(JSON.stringify(url.endsWith(':testIamPermissions')?{permissions:mismatch==='iam'?['datastore.entities.get']:['datastore.entities.get','datastore.entities.update']}:url.includes('firestore.googleapis.com')?{name:`projects/george-69c3a/databases/(default)`,locationId:mismatch==='database'?'wrong':a.region,type:'FIRESTORE_NATIVE'}:{projectId:mismatch==='project'?'wrong':a.project,projectNumber:a.projectNumber,lifecycleState:'ACTIVE'}));
 if(mismatch)await assert.rejects(verifyAdmin(a,request));else assert.equal(await verifyAdmin(a,request),base);
 }
});
test('shared operation lock and persistent backup lease block config until verified closure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'osatsu-config-lock-test-'));try{
 const b=await maintenanceLock('backup',dir);await assert.rejects(maintenanceLock('config',dir));await b.release();await assert.rejects(maintenanceLock('config',dir),/BACKUP_LEASE_ACTIVE/);
 const lease=JSON.parse(await readFile(join(dir,'backup-lease.json'),'utf8'));await assert.rejects(endBackupLease(crypto.randomUUID(),'fixture',dir));await endBackupLease(lease.id,'backup and isolated restoration verified',dir);
 const c=await maintenanceLock('config',dir);await c.release();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('CLI refuses unspecified project and malformed modes before authentication',async()=>{await assert.rejects(main([]));await assert.rejects(main(['apply','--project','wrong','approval.json']));});

test('token subject, expiry and HTTP failure reject before any document access',async()=>{
 for(const identity of [{email:'wrong',expires_in:300},{email:approval().serviceAccount,expires_in:10},{email:approval().serviceAccount},{email:approval().serviceAccount,expires_in:300}]) {
  const r=()=>Promise.resolve(new Response(JSON.stringify(identity)));
  if(identity.email===approval().serviceAccount&&identity.expires_in===300)await verifyToken(approval(),'mock',r);else await assert.rejects(verifyToken(approval(),'mock',r));
 }
 await assert.rejects(verifyToken(approval(),'mock',async()=>new Response('{}',{status:403})));
});

const inspectApproval=()=>{const {from:_from,to:_to,expectedUpdateTime:_expectedUpdateTime,...a}=approval();return {...a,action:'inspect'};};
const hash=s=>createHash('sha256').update(s).digest('hex');
test('version 1, missing/invalid/mismatched action and unexpected fields fail closed',()=>{
 for(const a of [{...approval(),version:1},{...approval(),action:undefined},{...approval(),action:'unknown'},{...approval(),extra:true}])assert.throws(()=>validateConfigApproval(a,'apply',time));
 assert.throws(()=>validateConfigApproval(inspectApproval(),'apply',time));
 assert.throws(()=>validateConfigApproval(approval(),'inspect',time));
 assert.throws(()=>validateConfigApproval({...inspectApproval(),to:'v2'},'inspect',time));
 assert.doesNotThrow(()=>validateConfigApproval(inspectApproval(),'inspect',time));
});
test('inspect authorization can never reach the mutation transport, even when target is absent',async()=>{
 let requests=0;await assert.rejects(changeConfig(inspectApproval(),{request:()=>{requests++;throw Error('must not request');},base,now:()=>time}),/APPROVAL_ACTION_MISMATCH/);assert.equal(requests,0);
});
test('inspect needs no guessed old state and issues only one GET',async()=>{
 for(const present of [true,false]){let requests=0;const state=await inspectConfig(inspectApproval(),{base,now:()=>time,request:async(u,o)=>{assert.equal(u,base+'/documents/appConfig/billRegistration');assert.equal(o,undefined);requests++;return new Response(present?JSON.stringify({name,fields:{mode:{stringValue:'paused'},identityVersion:{integerValue:'2'}},updateTime:approval().expectedUpdateTime}):'{}',{status:present?200:404});}});assert.equal(requests,1);assert.equal(state?.mode,present?'paused':undefined);}
});
test('inspect IAM check requires get only, never create/update',async()=>{
 const a=inspectApproval();const request=async(url,o)=>{if(url.endsWith(':testIamPermissions')){const permissions=JSON.parse(o.body).permissions;assert.equal(permissions.includes('datastore.entities.create'),false);assert.equal(permissions.includes('datastore.entities.update'),false);return new Response(JSON.stringify({permissions:['datastore.entities.get']}));}return new Response(JSON.stringify(url.includes('firestore.googleapis.com')?{name:'projects/george-69c3a/databases/(default)',locationId:a.region,type:'FIRESTORE_NATIVE'}:{projectId:a.project,projectNumber:a.projectNumber,lifecycleState:'ACTIVE'}));};assert.equal(await verifyAdmin(a,request),base);
});
test('approved digest detects action, target, transition, ID and whitespace edits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'osatsu-action-approval-'));try{
 const file=join(dir,'approval.json'),original=JSON.stringify(inspectApproval()),digest=hash(original);await writeFile(file,original,{mode:0o600});
 assert.equal((await readConfigApproval(file,'inspect',digest,time)).approval.action,'inspect');
 await assert.rejects(readConfigApproval(file,'apply',digest,time),/APPROVAL_ACTION_MISMATCH/);
 for(const edit of [a=>a.action='apply',a=>a.path='publicBills/x',a=>a.to='v2',a=>a.operationId=crypto.randomUUID()]){const changed=JSON.parse(original);edit(changed);await writeFile(file,JSON.stringify(changed));await assert.rejects(readConfigApproval(file,'inspect',digest,time),/APPROVAL_FILE_CHANGED/);}
 await writeFile(file,original+'\n');await assert.rejects(readConfigApproval(file,'inspect',digest,time),/APPROVAL_FILE_CHANGED/);
 await assert.rejects(readConfigApproval(file,'inspect',undefined,time),/APPROVAL_HASH_REQUIRED/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('operation ID cannot be rebound from inspect to apply or to another digest',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'osatsu-action-ledger-'));try{const a=inspectApproval(),digest=hash(JSON.stringify(a));await bindApproval(dir,a,digest);await bindApproval(dir,a,digest);await assert.rejects(bindApproval(dir,{...a,action:'apply'},digest),/APPROVAL_ID_REBOUND/);await assert.rejects(bindApproval(dir,a,'0'.repeat(64)),/APPROVAL_ID_REBOUND/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('CLI mismatch, old format and changed file fail before auth or maintenance lock',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'osatsu-action-cli-'));try{
 const a=inspectApproval();a.validFrom=new Date(Date.now()-1000).toISOString();a.validUntil=new Date(Date.now()+600000).toISOString();
 const file=join(dir,'approval.json'),content=JSON.stringify(a);await writeFile(file,content,{mode:0o600});
 await assert.rejects(main(['apply','--project','george-69c3a',file,'--approval-sha256',hash(content)]),/APPROVAL_ACTION_MISMATCH/);
 const legacy=JSON.stringify({...a,version:1});await writeFile(file,legacy);await assert.rejects(main(['inspect','--project','george-69c3a',file,'--approval-sha256',hash(legacy)]),/APPROVAL_ACTION_MISMATCH/);
 await assert.rejects(main(['inspect','--project','george-69c3a',file,'--approval-sha256',hash(content)]),/APPROVAL_FILE_CHANGED/);
 await assert.rejects(main(['inspect','--project','george-69c3a',file]),/EXPLICIT_TARGET_REQUIRED/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
