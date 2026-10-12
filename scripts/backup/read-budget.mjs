// Pure estimation / bounded count queries; no credential discovery or full scan.
export const roots = ['serialIndex','publicBills','sightings','rateLimits','appConfig','users','billIdentityIndex','billIdentities','bills'];
export const groups = ['trackedBills','settings'];
export const countSpecs = [...roots.map(id=>({id,group:false})),...groups.map(id=>({id,group:true}))];
export function countQuery(spec, limit=1000) {
  return {structuredAggregationQuery:{structuredQuery:{from:[{collectionId:spec.id,allDescendants:spec.group}],limit},aggregations:[{alias:'total',count:{}}]}};
}
export async function countInventory(rpc,base,a) {
  const counts={roots:{},groups:{}};
  // 1000 simple index entries max per query; reserve 2 reads rather than 1.
  // No filters/orderBy requiring extra scans; not a universal Query Explain substitute.
  for(const spec of countSpecs) {
    const result=await rpc(base+'/documents:runAggregationQuery','POST',countQuery(spec),2);
    if(!Array.isArray(result))throw new Error('COUNT_RESULT_INVALID');
    const records=result.filter(x=>x.result?.aggregateFields?.total);
    if(records.length!==1)throw new Error('COUNT_RESULT_INVALID');
    const value=records[0].result.aggregateFields.total.integerValue;
    if(typeof value!=='string'||!/^\d+$/.test(value))throw new Error('COUNT_RESULT_INVALID');
    const count=Number(value);
    if(!Number.isSafeInteger(count)||count>=1000)throw new Error('COUNT_LIMIT_REACHED: do not treat bounded result as exact total');
    counts[spec.group?'groups':'roots'][spec.id]=count;
  }
  return {kind:'bounded-count-inventory',project:a.project,database:a.database,counts,inventoryReservedReadUnits:4+countSpecs.length*2,coverage:'known-schema-only-not-complete-enumeration'};
}
export function estimateBudget(input) {
  const {counts,usedReads,otherReadsReserve,marginReads}=input;
  for(const n of [usedReads,otherReadsReserve,marginReads])if(!Number.isSafeInteger(n)||n<0)throw new Error('QUOTA_INPUT_UNKNOWN');
  for(const [type,ids]of [['roots',roots],['groups',groups]]) {
    if(!counts?.[type]||Object.keys(counts[type]).some(k=>!ids.includes(k)))throw new Error('SCHEMA_COUNTS_UNKNOWN');
    for(const id of ids)if(!Number.isSafeInteger(counts[type][id])||counts[type][id]<0)throw new Error('COUNT_UNKNOWN');
  }
  // All non-root records must be immediate subcollections under users, no deeper or other collections.
  // A missing user parent is bounded by the number of child documents, not by count(users).
  const childDocs=groups.reduce((n,id)=>n+counts.groups[id],0);
  const missingUserUpper=childDocs;
  const maxUserRefs=counts.roots.users+missingUserUpper;
  const rootDocumentTotal=roots.reduce((n,id)=>n+counts.roots[id],0);
  const totalDocuments=rootDocumentTotal+childDocs;
  let documentPages=0,collectionIdPages=1;
  const pageBound=n=>n===0?0:Math.ceil(n/100)+1; // includes a possible empty terminal page
  for(const id of roots) documentPages+=pageBound(counts.roots[id]+(id==='users'?missingUserUpper:0));
  // Each nonempty user subcollection can contain only one document in the worst distribution.
  // Sum per-collection page counts is <= ceil(T/100)+A; reserve an extra terminal page for every A.
  for(const id of groups) {
    const t=counts.groups[id],a=Math.min(t,maxUserRefs);
    if(t) documentPages+=Math.ceil(t/100)+2*a;
  }
  collectionIdPages+=rootDocumentTotal+missingUserUpper+childDocs;
  // count/listCollectionIds responses may page even when all schema identifiers are known.
  // Under this reviewed schema roots <=9, each user has <=2 subcollections and children have none.
  const backupReservedReadUnits=4+2*(101*documentPages+collectionIdPages);
  const inventoryReservedReadUnits=4+countSpecs.length*2;
  const projectedReads=usedReads+otherReadsReserve+marginReads+inventoryReservedReadUnits+backupReservedReadUnits;
  return {totalDocuments,missingUserUpper,documentPagesUpper:documentPages,collectionIdPagesUpper:collectionIdPages,inventoryReservedReadUnits,backupReservedReadUnits,projectedReads,quotaFits:projectedReads<50000,ready:input.schemaReviewed===true&&projectedReads<50000,reason:input.schemaReviewed!==true?'SCHEMA_COVERAGE_UNCONFIRMED':projectedReads>=50000?'SPARK_BUDGET_EXCEEDED':'ELIGIBLE_ONLY_IF_BOUNDS_AND_CURRENT_USAGE_VERIFIED'};
}
