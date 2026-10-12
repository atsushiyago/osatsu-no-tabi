import test from 'node:test';
import assert from 'node:assert/strict';
import {roots,groups,countQuery,countInventory,estimateBudget} from '../scripts/backup/read-budget.mjs';
const input=()=>({counts:{roots:Object.fromEntries(roots.map(id=>[id,0])),groups:Object.fromEntries(groups.map(id=>[id,0]))},usedReads:0,otherReadsReserve:1000,marginReads:5000,schemaReviewed:true});
test('covers five current roots, optional v2/MVP and absent user parents via collection groups',()=>{
 for(const id of ['serialIndex','publicBills','sightings','rateLimits','appConfig','users','billIdentityIndex','billIdentities','bills'])assert.ok(roots.includes(id));
 assert.deepEqual(countQuery({id:'trackedBills',group:true}).structuredAggregationQuery.structuredQuery,{from:[{collectionId:'trackedBills',allDescendants:true}],limit:1000});
});
test('count uses bounded aggregation only: no document fetching or list scans',async()=>{
 const calls=[];
 const result=await countInventory(async(url,method,body,reserve)=>{calls.push({url,method,body,reserve});return [{result:{aggregateFields:{total:{integerValue:'12'}}}}];},'https://mock.invalid/base',{project:'george-69c3a',database:'(default)'});
 assert.equal(calls.length,11);assert.ok(calls.every(c=>c.method==='POST'&&c.url.endsWith(':runAggregationQuery')&&c.reserve===2&&c.body.structuredAggregationQuery.structuredQuery.limit===1000));
 assert.equal(result.counts.groups.trackedBills,12);assert.equal(result.inventoryReservedReadUnits,26);
});
test('limit hit is ambiguous and rejected, malformed or failed aggregation rejects',async()=>{
 for(const n of ['1000','999999999999999999999','bad','-1'])await assert.rejects(countInventory(async()=>[{result:{aggregateFields:{total:{integerValue:n}}}}],'mock',{}));
 await assert.rejects(countInventory(async()=>{throw new Error('network');},'mock',{}));
 await assert.rejects(countInventory(async()=>[{result:{aggregateFields:{}}}],'mock',{}));
});
test('unknown schema, missing count and exhausted Spark quota do not authorize backup',()=>{
 const a=input();a.schemaReviewed=false;assert.equal(estimateBudget(a).ready,false);
 const b=input();delete b.counts.groups.trackedBills;assert.throws(()=>estimateBudget(b));
 const c=input();c.usedReads=49000;assert.equal(estimateBudget(c).ready,false);
 const d=input();d.counts.roots.unknown=1;assert.throws(()=>estimateBudget(d));
});
test('missing user documents do not imply empty tracked subcollections',()=>{
 const a=input();a.counts.groups.trackedBills=100;const r=estimateBudget(a);
 assert.equal(r.totalDocuments,100);assert.equal(r.missingUserUpper,100);assert.ok(r.backupReservedReadUnits>40000);
});
test('global tracked count is not rounded to one global 20/100-document page',()=>{
 const a=input();a.counts.groups.trackedBills=200;const r=estimateBudget(a);
 assert.ok(r.documentPagesUpper>=400);assert.equal(r.quotaFits,false);
});
test('count budgets include empty queries; preview fits require reviewed upper bounds',()=>{
 const a=input(),r=estimateBudget(a);assert.equal(r.inventoryReservedReadUnits,26);assert.equal(r.backupReservedReadUnits,6);assert.equal(r.ready,true);
 a.counts.roots.publicBills=100;assert.equal(estimateBudget(a).backupReservedReadUnits,610);
});
