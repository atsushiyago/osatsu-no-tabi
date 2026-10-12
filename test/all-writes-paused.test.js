import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, serverTimestamp } from 'firebase/firestore';
import { allWritesPausedRules, reviewedV1Rules } from '../scripts/all-writes-paused-rules.mjs';
import { registerBillIdentityV2InEmulator } from '../src/services/billIdentityRegistry.ts';
import { client, adminSet, adminGet, loadRules, clearDemoProject, closeClients, opaque, plan, commit, ageBill, firestoreHost } from './helpers/identity-emulator.js';
if (process.env.OSATSU_FREEZE_TEST !== 'true' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:28080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:29099') throw new Error('Use the isolated freeze test runner');
const project = 'demo-osatsu-all-writes-paused';
const v1 = reviewedV1Rules();
const frozen = await readFile(new URL('../firestore.all-writes-paused.rules', import.meta.url), 'utf8');
const v2 = await readFile(new URL('../firestore.strict.rules', import.meta.url), 'utf8');
const denied = promise => assert.rejects(promise, e => e.code === 'permission-denied');
function grants(source) { return [...source.matchAll(/allow\s+([a-z,\s]+):\s*if\s+([\s\S]*?);/g)]; }

test('artifact matches pinned production source, preserves each read grant, and has no write grant', () => {
  assert.equal(frozen, allWritesPausedRules(v1));
  assert.throws(() => allWritesPausedRules(v1 + '\n'));
  const reads = source => grants(source).filter(m => m[1].split(',').some(op => ['read','get','list'].includes(op.trim()))).map(m => [m[1].split(',').map(op => op.trim()).filter(op => ['read','get','list'].includes(op)).join(','), m[2].trim()]);
  assert.deepEqual(reads(frozen), reads(v1));
  for (const m of grants(frozen)) if (m[1].split(',').some(op => ['write','create','update','delete'].includes(op.trim()))) assert.equal(m[2].trim(), 'false');
});
async function oldRegistration(c, id = opaque(), serial = 'PA123456B', prior = null) {
  const sightingId = opaque(), now = new Date().toISOString(), batch = writeBatch(c.db);
  const priorRate = (await getDoc(doc(c.db, 'rateLimits', c.uid))).data();
  const rate = {shortWindowStartedAt: priorRate?.shortWindowStartedAt ?? serverTimestamp(),dailyWindowStartedAt:priorRate?.dailyWindowStartedAt ?? serverTimestamp(),shortCount:(priorRate?.shortCount ?? 0)+1,dailyCount:(priorRate?.dailyCount ?? 0)+1,updatedAt:serverTimestamp(),lastOperationPublicBillId:id,lastOperationSightingId:sightingId};
  if (!prior) batch.set(doc(c.db,'serialIndex',serial),{publicBillId:id,createdAt:serverTimestamp()});
  const bill = {id,denomination:1000,createdAt:prior?.createdAt ?? now,updatedAt:now,firstSightedAt:prior?.firstSightedAt ?? now,lastSightedAt:now,lastSightedAtServer:serverTimestamp(),sightingsCount:prior ? prior.sightingsCount+1 : 1,totalDistanceKm:0,lastSightingId:sightingId,lastMunicipality:'千代田区'};
  batch.set(doc(c.db,'publicBills',id),bill);
  batch.set(doc(c.db,'sightings',sightingId),{id:sightingId,publicBillId:id,step:bill.sightingsCount,createdAt:now,prefecture:'東京都',municipality:'千代田区',distanceFromPrevKm:0,daysFromPrev:0});
  const trackedRef=doc(c.db,'users',c.uid,'trackedBills',id);
  if(prior) batch.update(trackedRef,{lastSeenSightingsCount:bill.sightingsCount,lastSeenAt:serverTimestamp(),lastSeenMunicipality:'千代田区'});
  else batch.set(trackedRef,{publicBillId:id,serialNumber:serial,denomination:1000,createdAt:serverTimestamp(),firstRegisteredByMe:true,notifyOnRediscovery:false,lastSeenSightingsCount:1,lastSeenAt:serverTimestamp(),lastSeenMunicipality:'千代田区'});
  batch.set(doc(c.db,'rateLimits',c.uid),rate);await batch.commit();return {id,sightingId};
}

test('full backup freeze on isolated Firestore/Auth emulators', async t => {
  t.after(closeClients);
  await clearDemoProject(project);await loadRules(v1,project);
  const owner=await client('freeze-owner',true,project),other=await client('freeze-other',true,project),publicClient=await client('freeze-public',false,project);
  const legacy=await oldRegistration(owner);
  await loadRules(v2,project);await adminSet('appConfig/billRegistration',{mode:'v2',identityVersion:2},project);
  const identity={denomination:1000,series:'E',serialColor:'black',serialNumber:'PB123456B',prefecture:'東京都',municipality:'千代田区'};
  const registered=await registerBillIdentityV2InEmulator(owner.db,owner.auth,identity);
  const pending=await plan(owner,{...identity,serialNumber:'PC123456B'});
  await ageBill(legacy.id,project);await ageBill(registered.publicBillId,project);
  const pendingRediscovery=await plan(owner,identity);
  const tracked=`users/${owner.uid}/trackedBills/${legacy.id}`;
  const baseline=`users/${owner.uid}/trackedBills/${opaque()}`;
  await adminSet(baseline,{publicBillId:legacy.id,serialNumber:'PA123456B',denomination:1000,createdAt:new Date(),firstRegisteredByMe:true,notifyOnRediscovery:false},project);
  await adminSet(`users/${owner.uid}`,{displayName:'Synthetic'},project);
  const paths=[`serialIndex/PA123456B`,`publicBills/${legacy.id}`,`sightings/${legacy.sightingId}`,tracked,baseline,`users/${owner.uid}`,`rateLimits/${owner.uid}`,`publicBills/${registered.publicBillId}`,'appConfig/billRegistration'];
  const before=await Promise.all(paths.map(p=>adminGet(p,project)));
  await loadRules(frozen,project);
  await t.test('cached v1 new registration and rediscovery are denied', async()=>{
    await denied(oldRegistration(owner,opaque(),'PD123456B'));
    await denied(oldRegistration(owner,legacy.id,'PA123456B',await adminGet(`publicBills/${legacy.id}`,project)));
  });
  await t.test('v2 new registration, rediscovery and pre-planned six-document batch are denied',async()=>{
    await denied(commit(owner,pending));
    await denied(commit(owner,pendingRediscovery));
    // v1 read boundaries intentionally do not expose v2 indexes; actual service fails closed.
    await denied(registerBillIdentityV2InEmulator(owner.db,owner.auth,{...identity,serialNumber:'PE123456B'}));
    await denied(registerBillIdentityV2InEmulator(owner.db,owner.auth,identity));
  });
  for(const [field,value]of Object.entries({lastSeenSightingsCount:2,lastSeenAt:serverTimestamp(),lastSeenMunicipality:'世田谷区',notifyOnRediscovery:true})) await t.test(`tracked settings deny ${field}`,()=>denied(updateDoc(doc(owner.db,tracked),{[field]:value})));
  await t.test('missing baseline and user profile changes are denied',async()=>{
    await denied(updateDoc(doc(owner.db,baseline),{lastSeenSightingsCount:1}));
    await denied(updateDoc(doc(owner.db,'users',owner.uid),{displayName:'Changed'}));
  });
  const targets=['serialIndex','billIdentityIndex','billIdentities','publicBills','sightings',`users/${owner.uid}/trackedBills`,'rateLimits','appConfig','unknown/deep/children'];
  for(const target of targets)await t.test(`all CRUD denied: ${target}`,async()=>{
    const p=`${target}/${opaque()}`;await denied(setDoc(doc(owner.db,p),{value:1}));await adminSet(p,{value:1},project);
    await denied(updateDoc(doc(owner.db,p),{value:2}));await denied(deleteDoc(doc(owner.db,p)));assert.deepEqual(await adminGet(p,project),{value:1});
  });
  await t.test('owner tracked deletion, appConfig mutation and batch/transaction denied atomically',async()=>{
    await denied(deleteDoc(doc(owner.db,tracked)));
    await denied(setDoc(doc(owner.db,'appConfig','billRegistration'),{mode:'paused',identityVersion:2}));
    await denied(updateDoc(doc(owner.db,'appConfig','billRegistration'),{mode:'paused'}));
    await denied(deleteDoc(doc(owner.db,'appConfig','billRegistration')));
    const b=writeBatch(owner.db);b.update(doc(owner.db,tracked),{notifyOnRediscovery:true});b.update(doc(owner.db,'publicBills',legacy.id),{sightingsCount:2});await denied(b.commit());
    await denied(runTransaction(owner.db,async tx=>{const ref=doc(owner.db,tracked);await tx.get(ref);const billRef=doc(owner.db,'publicBills',legacy.id);await tx.get(billRef);tx.update(ref,{notifyOnRediscovery:true});tx.update(billRef,{sightingsCount:2});}));
  });
  await t.test('public list/detail/history reads and owner tracking preserved; private reads denied',async()=>{
    for(const c of [owner,publicClient]){
      assert.ok((await getDocs(collection(c.db,'publicBills'))).size>=2);
      assert.equal((await getDoc(doc(c.db,'publicBills',legacy.id))).exists(),true);
      assert.equal((await getDoc(doc(c.db,'sightings',legacy.sightingId))).exists(),true);
      assert.equal((await getDocs(query(collection(c.db,'sightings'),where('publicBillId','==',legacy.id)))).size,1);
    }
    assert.ok((await getDocs(collection(owner.db,'users',owner.uid,'trackedBills'))).size>=2);
    assert.equal((await getDoc(doc(owner.db,'serialIndex','PA123456B'))).exists(),true);
    assert.equal((await getDoc(doc(owner.db,'rateLimits',owner.uid))).exists(),true);
    for(const c of [other,publicClient]){await denied(getDoc(doc(c.db,tracked)));await denied(getDocs(collection(c.db,'users',owner.uid,'trackedBills')));await denied(getDoc(doc(c.db,'rateLimits',owner.uid)));await denied(setDoc(doc(c.db,'publicBills',opaque()),{value:1}));}
    await denied(getDoc(doc(owner.db,'bills','retired')));
    await denied(getDocs(collection(owner.db,'serialIndex')));
    await denied(getDoc(doc(publicClient.db,'serialIndex','PA123456B')));
    await denied(getDoc(doc(owner.db,'billIdentities',registered.publicBillId)));
    await denied(getDoc(doc(owner.db,'appConfig','billRegistration')));
  });
  await t.test('all protected fixture values remain unchanged after denied operations',async()=>assert.deepEqual(await Promise.all(paths.map(p=>adminGet(p,project))),before));
  await t.test('emulator admin conditional config Commit rejects stale updateTime without changing the gate',async()=>{
    const url=`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/appConfig/billRegistration`;
    const headers={Authorization:'Bearer owner','Content-Type':'application/json'};
    const current=await (await fetch(url,{headers})).json();
    assert.equal(current.fields.mode.stringValue,'v2');assert.equal(current.fields.identityVersion.integerValue,'2');
    const target=`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents:commit`;
    const body=mode=>JSON.stringify({writes:[{update:{name:current.name,fields:{mode:{stringValue:mode},identityVersion:{integerValue:'2'}}},updateMask:{fieldPaths:['mode','identityVersion']},currentDocument:{updateTime:current.updateTime}}]});
    const changed=await fetch(target,{method:'POST',headers,body:body('paused')});assert.equal(changed.ok,true,await changed.text());
    const stale=await fetch(target,{method:'POST',headers,body:body('v2')});assert.equal(stale.ok,false);
    assert.equal((await adminGet('appConfig/billRegistration',project)).mode,'paused');
    await denied(updateDoc(doc(owner.db,'appConfig','billRegistration'),{mode:'v2'}));
  });
  await t.test('separate emulator administrator can change gate; client writes remain denied in paused and v2',async()=>{
    for(const mode of ['paused','v2']){
      await adminSet('appConfig/billRegistration',{mode,identityVersion:2},project);
      assert.equal((await adminGet('appConfig/billRegistration',project)).mode,mode);
      await denied(oldRegistration(owner,opaque(),'PF123456B'));
      await denied(updateDoc(doc(owner.db,tracked),{notifyOnRediscovery:true}));
    }
  });
});
