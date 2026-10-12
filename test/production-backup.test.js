import test from 'node:test';
import assert from 'node:assert/strict';
import {productionBackup,validateApproval,assertRuntime,rawValue,main} from '../scripts/backup/production-backup.mjs';
import {validate,encrypt,decrypt} from '../scripts/backup/firestore-backup.mjs';
const time=Date.parse('2026-10-12T03:00:00Z');
const approval=()=>({version:1,project:'george-69c3a',projectNumber:'937399721739',database:'(default)',region:'asia-northeast1',serviceAccount:'backup-reader@george-69c3a.iam.gserviceaccount.com',approvedBy:'fixture',iamReviewedBy:'fixture',freezeEvidence:'fixture',iamEvidence:'fixture',allWritersStopped:true,writesConverged:true,effectiveIamReadOnly:true,sparkConfirmed:true,privateStorageConfirmed:true,validFrom:new Date(time-1000).toISOString(),validUntil:new Date(time+600000).toISOString(),usageCheckedAt:new Date(time).toISOString(),quotaDay:'2026-10-11',usedReads:1000,otherReadsReserve:1000,marginReads:5000,maxReadUnits:10000,maxBytes:1000000,maxDocuments:100,output:'/private/tmp/fixture.osatsu-backup'});
const args=a=>({project:a.project,database:a.database,serviceAccount:a.serviceAccount,output:a.output});
function mock(a,change={}) {
 const calls=[];let lists=0;
 return {calls,request:async(url,options)=>{
  calls.push({url,method:options.method});
  let data;
  if(url.includes('tokeninfo'))data={email:a.serviceAccount,expires_in:3000,...change.token};
  else if(url.endsWith(':testIamPermissions'))data={permissions:['datastore.entities.get','datastore.entities.list','datastore.databases.getMetadata',...(change.write?['datastore.entities.update']:[])]};
  else if(url.includes('cloudresourcemanager'))data={projectId:a.project,projectNumber:a.projectNumber,lifecycleState:'ACTIVE',...change.project};
  else if(url.endsWith('/databases/(default)'))data={name:`projects/${a.project}/databases/(default)`,locationId:a.region,type:'FIRESTORE_NATIVE',...change.database};
  else if(url.endsWith(':listCollectionIds'))data=url.endsWith('/documents:listCollectionIds')?{collectionIds:['publicBills']}:{};
  else if(url.includes('/publicBills?')){lists++;data={documents:[{name:`projects/${a.project}/databases/(default)/documents/publicBills/uuid`,updateTime:change.changed&&lists===2?'2026-10-12T03:01:00Z':'2026-10-12T03:00:00Z',fields:{denomination:{integerValue:'1000'},createdAt:{timestampValue:'2026-10-12T03:00:00.123456789Z'},ref:{referenceValue:`projects/${a.project}/databases/(default)/documents/publicBills/uuid`}}}]};if(change.twoDocs)data.documents.push({...data.documents[0],name:data.documents[0].name+'2'});}
  else throw new Error('unexpected mock URL');
  if(change.network)throw new Error('simulated network failure');
  return new Response(JSON.stringify(data),{status:change.permission?403:200});
 }};
}
test('production backup REST read-only happy path and encrypted round trip',async()=>{
 const a=approval(),m=mock(a);const result=await productionBackup(a,{token:'fake-short-lived-token',request:m.request,now:()=>time});
 assert.equal(result.manifest.count,1);assert.equal(result.sourceVersions[0].path,'publicBills/uuid');
 validate(result,{doc:path=>({path})},{expectedSource:a.project});assert.throws(()=>validate(result,{doc:path=>({path})}));
 const password=Buffer.from('only-a-test-passphrase-never-real');assert.deepEqual(decrypt(encrypt(result,password),password),result);
 assert.ok(m.calls.every(c=>c.method==='GET'||c.url.endsWith(':listCollectionIds')||c.url.endsWith(':testIamPermissions')));
 assert.ok(!m.calls.some(c=>/commit|batchWrite|:import|:export/.test(c.url)));
});
for(const [name,change]of Object.entries({wrongProject:{project:{projectId:'wrong'}},wrongDatabase:{database:{locationId:'wrong'}},wrongIdentity:{token:{email:'wrong'}},expiredToken:{token:{expires_in:0}},writePermission:{write:true},permissionDenied:{permission:true},networkFailure:{network:true},sourceChanged:{changed:true}}))test('reject '+name,async()=>{const a=approval(),m=mock(a,change);await assert.rejects(productionBackup(a,{token:'fake',request:m.request,now:()=>time}));});
test('approval unknown fields, stale quota, invalid budget and wrong inputs reject',()=>{
 for(const edit of [a=>a.project='wrong',a=>a.serviceAccount='wrong',a=>a.database='other',a=>a.usedReads=49000,a=>a.maxBytes=999999999,a=>a.writesConverged=false,a=>a.usageCheckedAt='invalid',a=>a.quotaDay='wrong',a=>a.validUntil=new Date(time-1).toISOString(),a=>a.iamEvidence='']){const a=approval();edit(a);assert.throws(()=>validateApproval(a,args(a),time));}
 const a=approval();assert.throws(()=>validateApproval(a,{...args(a),output:'/different'},time));
});
test('read byte and document budgets reject before success',async()=>{
 for(const edit of [a=>a.maxReadUnits=10,a=>a.maxBytes=20,a=>a.maxDocuments=1]){
  const a=approval();edit(a);const m=mock(a,{twoDocs:true});
  await assert.rejects(productionBackup(a,{token:'fake',request:m.request,now:()=>time}));
 }
});
test('runtime blocks emulator credentials and debug environment',()=>{
 assert.doesNotThrow(()=>assertRuntime({}));for(const key of ['FIRESTORE_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS','NODE_OPTIONS','GRPC_TRACE'])assert.throws(()=>assertRuntime({[key]:'unsafe'}));
});
test('typed REST fields preserve precision and cross project refs fail',()=>{
 assert.deepEqual(rawValue({integerValue:'9223372036854775807'},'george-69c3a'),['integer','9223372036854775807']);
 assert.deepEqual(rawValue({timestampValue:'2026-10-12T03:00:00.123456789Z'},'george-69c3a').slice(2),[123456789]);
 assert.throws(()=>rawValue({referenceValue:'projects/wrong/databases/(default)/documents/a/b'},'george-69c3a'));
 assert.throws(()=>rawValue({unknownValue:true},'george-69c3a'));
});
test('invalid CLI has no network or authentication side effects',async()=>{await assert.rejects(main([]));});
