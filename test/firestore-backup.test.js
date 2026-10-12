import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Timestamp, GeoPoint, FieldValue } from 'firebase-admin/firestore';
import { assertEmulator, openEmulator, capture, restore, scan, validate, encrypt, decrypt, saveEncrypted, encode, decode, main } from '../scripts/backup/firestore-backup.mjs';
import { loadRules, clearDemoProject, closeClients, client } from './helpers/identity-emulator.js';
import { getDoc, getDocs, doc, collection, query, where, updateDoc } from 'firebase/firestore';

const project = 'demo-osatsu-backup-source';
const target = 'demo-osatsu-backup-target';
const password = Buffer.from('emulator-only-test-passphrase-not-a-real-secret');

test('reject non-emulator and production identifiers before connecting', () => {
  for (const [p, h] of [['george-69c3a','127.0.0.1:18080'], ['demo-test',undefined], ['demo-test','localhost:18080'], ['demo-test','example.com:443'], ['demo-test','127.0.0.1:0']]) assert.throws(() => assertEmulator(p, h === undefined ? '' : h));
  assert.doesNotThrow(() => assertEmulator('demo-test','127.0.0.1:18080'));
});

test('effective SDK transport and project mismatch are rejected without reads', async()=>{
  const unsafe={projectId:'demo-test',databaseId:'(default)',_settings:{servicePath:'firestore.googleapis.com',port:443,ssl:true,useBigInt:true},listCollections:()=>{throw new Error('must not read');}};
  await assert.rejects(scan(unsafe),/UNSAFE_DATABASE_TRANSPORT/);
  await assert.rejects(capture(unsafe,'demo-other'),/PROJECT_MISMATCH/);
});

test('encrypted recursive round trip with mixed legacy/v2 and restored Rules boundaries', async (t) => {
  assertEmulator(project); await clearDemoProject(project); await clearDemoProject(target);
  const source = await openEmulator(project); const destination = await openEmulator(target);
  const dir = await mkdtemp(join(tmpdir(), 'osatsu-backup-'));
  try {
    const id1 = '11111111-1111-4111-8111-111111111111';
    const id2 = '22222222-2222-4222-8222-222222222222';
    const id3 = '33333333-3333-4333-8333-333333333333';
    const serial = 'AA123456B'; const stamp = new Timestamp(1700000000, 123456789);
    const db = source.db; const batch = db.batch();
    batch.set(db.doc('serialIndex/'+serial), { publicBillId: id1, createdAt: stamp });
    for (const [id,color] of [[id2,'black'],[id3,'brown']]) {
      const key = `v2_JPY_1000_E_${color}_${serial}`;
      const identity = { identityVersion: 2, publicBillId:id, denomination:1000, series:'E', serialColor:color, serialNumber:serial, createdAt:stamp };
      batch.set(db.doc('billIdentityIndex/'+key), identity);
      batch.set(db.doc('billIdentities/'+id), {...identity, identityKey:key});
    }
    for (const [id, count, distance] of [[id1,2,10],[id2,1,0],[id3,1,0]]) {
      batch.set(db.doc('publicBills/'+id), { id, denomination:1000, sightingsCount:count, totalDistanceKm:distance, createdAt:'2023-11-14T00:00:00Z', lastMunicipality:'千代田区', ...(id===id1?{}:{identityVersion:2,series:'E',serialColor:id===id2?'black':'brown'}) });
      for (let step=1;step<=count;step++) batch.set(db.doc(`sightings/${id}-${step}`), {id:`${id}-${step}`,publicBillId:id,step, prefecture:'東京都',municipality:'千代田区',createdAt:'2023-11-14T00:00:00Z'});
    }
    for (const uid of ['anonymous-fixture','google-linked-fixture']) {
      batch.set(db.doc(`users/${uid}/trackedBills/${id1}`),{ publicBillId:id1,serialNumber:serial,denomination:1000,firstRegisteredByMe:true,createdAt:stamp,lastSeenSightingsCount:2,notifyOnRediscovery:true });
      batch.set(db.doc(`users/${uid}/settings/ui`),{language:'en'});
    }
    batch.set(db.doc('rateLimits/anonymous-fixture'),{shortCount:1,updatedAt:stamp});
    batch.set(db.doc('appConfig/billRegistration'),{mode:'paused',identityVersion:2});
    batch.set(db.doc('bills/legacy-mvp'),{serialNumber:serial});
    batch.set(db.doc('orphan/missing/deep/missing/leaf/entry'),{nested:true});
    batch.set(db.doc('types/all'), { stamp, geo:new GeoPoint(35.5,139.5), bytes:Buffer.from([0,255,42]), ref:db.doc('publicBills/'+id1), missingRef:db.doc('orphan/missing'), vector:FieldValue.vector([1.25,2.5]), maxInt:9223372036854775807n, minInt:-9223372036854775808n, nan:NaN, infinity:Infinity, negativeInfinity:-Infinity, nested:{'__proto__safe':'value',array:[null,true,'日本語',stamp]}, emptyMap:{}, emptyArray:[] });
    // Firestore has no persistent empty collection: an unused reference creates nothing.
    db.collection('empty-never-written');
    await batch.commit();
    const backup = await capture(db,project);
    await t.test('all collections and missing ancestors included', () => {
      assert.equal(backup.manifest.count,21);
      assert.ok(backup.snapshot.documents.some(d=>d.path==='orphan/missing/deep/missing/leaf/entry'));
      assert.ok(!backup.snapshot.documents.some(d=>d.path==='users/anonymous-fixture'));
      assert.ok(!backup.snapshot.collections.includes('empty-never-written'));
      assert.equal(backup.manifest.collections['users/google-linked-fixture/trackedBills'],1);
    });
    await t.test('private encrypted file and authenticated corruption detection', async () => {
      const file=join(dir,'snapshot.osatsu-backup'); await saveEncrypted(file,backup,password);
      const contents=await readFile(file,'utf8'); assert.ok(!contents.includes(serial));
      assert.equal((await stat(file)).mode & 0o777,0o600);
      assert.deepEqual(decrypt(contents,password),backup);
      assert.throws(()=>decrypt(contents,Buffer.from('wrong-passphrase')));
      const damaged=JSON.parse(contents); damaged.ciphertext=Buffer.from('broken').toString('base64'); assert.throws(()=>decrypt(JSON.stringify(damaged),password));
      await assert.rejects(saveEncrypted(file,backup,password));
      await assert.rejects(saveEncrypted('bad.osatsu-backup',backup,password));
    });
    await t.test('damaged content and manifest rejected before any writes',async()=>{
      for (const change of [b=>b.snapshot.documents[0].sha256='bad',b=>b.manifest.count++,b=>b.snapshot.documents.push(b.snapshot.documents[0])]) {
        const bad=structuredClone(backup);change(bad);await assert.rejects(restore(destination.db,target,bad));
        assert.equal((await scan(destination.db)).documents.length,0);
      }
    });
    await t.test('restore to empty demo, full field/type/path equality',async()=>{
      const result=await restore(destination.db,target,decrypt(encrypt(backup,password),password));
      assert.equal(result.count,backup.manifest.count);
      assert.deepEqual(await scan(destination.db),backup.snapshot);
      assert.equal((await destination.db.doc('types/all').get()).get('maxInt'),9223372036854775807n);
      assert.equal((await destination.db.doc('types/all').get()).get('ref').firestore,destination.db);
      await assert.rejects(restore(destination.db,target,backup),/EMPTY_TARGET/);
    });
    await t.test('restored public histories, owner tracking and private reverse Rules',async()=>{
      await loadRules(await readFile(new URL('../firestore.strict.rules',import.meta.url),'utf8'),target);
      const c=await client('backup-owner',true,target);
      // Auth is separate: create target tracking copy under actual Emulator UID for owner checks.
      await destination.db.doc(`users/${c.uid}/trackedBills/${id1}`).set((await destination.db.doc('users/google-linked-fixture/trackedBills/'+id1).get()).data());
      assert.equal((await getDocs(collection(c.db,'publicBills'))).size,3);
      assert.equal((await getDocs(query(collection(c.db,'sightings'),where('publicBillId','==',id1)))).size,2);
      assert.equal((await getDoc(doc(c.db,'users',c.uid,'trackedBills',id1))).get('serialNumber'),serial);
      await assert.rejects(getDoc(doc(c.db,'billIdentities',id2)),e=>e.code==='permission-denied');
      await assert.rejects(getDoc(doc(c.db,'users','google-linked-fixture','trackedBills',id1)),e=>e.code==='permission-denied');
      await updateDoc(doc(c.db,'users',c.uid,'trackedBills',id1),{notifyOnRediscovery:false});
      await assert.rejects(updateDoc(doc(c.db,'publicBills',id1),{sightingsCount:3}),e=>e.code==='permission-denied');
    });
    await t.test('CLI backup verify restore all use encrypted files and count-only logs',async()=>{
      const key=join(dir,'cli.passphrase');await writeFile(key,password,{mode:0o600});
      const file=join(dir,'cli.osatsu-backup');const cliTarget='demo-osatsu-backup-cli';await clearDemoProject(cliTarget);
      const messages=[];const original=console.info;console.info=(message)=>messages.push(message);
      try {
        await main(['backup',project,file,key]);await main(['verify',project,file,key]);await main(['restore',cliTarget,file,key]);
      } finally {console.info=original;}
      assert.deepEqual(messages,['BACKUP_COMPLETE documents=21','BACKUP_VALID documents=21','RESTORE_VERIFIED documents=21']);
      const cli=await openEmulator(cliTarget);try {assert.deepEqual(await scan(cli.db),backup.snapshot);}finally {await cli.close();}
    });
    await t.test('source failure and concurrent changes never produce success',async()=>{
      const original=db.listCollections.bind(db);
      db.listCollections=async()=>{throw new Error('simulated failure');};await assert.rejects(capture(db,project));db.listCollections=original;
      let calls=0;db.listCollections=async()=>{if(++calls===2) await db.doc('mutation/new').set({x:true});return original();};
      await assert.rejects(capture(db,project),/SOURCE_CHANGED/);db.listCollections=original;
    });
    await t.test('partial restore failure remains failure and blocks unsafe retry',async()=>{
      const partialProject='demo-osatsu-backup-partial';await clearDemoProject(partialProject);
      const partial=await openEmulator(partialProject);
      try {
        const realBatch=partial.db.batch.bind(partial.db);
        partial.db.batch=()=>{const b=realBatch();b.commit=async()=>{await partial.db.doc('partial/marker').create({partial:true});throw new Error('simulated interruption');};return b;};
        await assert.rejects(restore(partial.db,partialProject,backup),/interruption/);
        partial.db.batch=realBatch;
        assert.equal((await scan(partial.db)).documents.length,1);
        await assert.rejects(restore(partial.db,partialProject,backup),/EMPTY_TARGET/);
      } finally {await partial.close();}
    });
    await t.test('CLI private password requirement and no success after failure',async()=>{
      const key=join(dir,'bad.passphrase');await writeFile(key,password,{mode:0o644});
      await assert.rejects(main(['verify',project,join(dir,'snapshot.osatsu-backup'),key]),/PRIVATE/);
    });
    await t.test('malformed field types and unsafe numbers rejected',()=>{
      assert.throws(()=>decode(['timestamp',0,1e10],db)); assert.throws(()=>encode(new Set(),db)); assert.throws(()=>encode(2**60,db));
      assert.throws(()=>decode(['integer','9223372036854775808'],db));
      assert.throws(()=>decode(['reference','bad'],db));
      const bad=structuredClone(backup);bad.version=2;assert.throws(()=>validate(bad,db));
    });
  } finally {await closeClients();await source.close();await destination.close();await rm(dir,{recursive:true,force:true});}
});
