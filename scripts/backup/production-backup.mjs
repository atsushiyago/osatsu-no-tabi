// Production GET/list only. No Firebase App, ADC discovery, Auth SDK, or write API.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { countInventory } from './read-budget.mjs';
import { manifest, saveEncrypted, outsideRepo } from './firestore-backup.mjs';
const project = 'george-69c3a';
const exec = promisify(execFile);
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const reject = code => { throw new Error(code); };
const readPermissions = ['datastore.entities.get','datastore.entities.list','datastore.databases.getMetadata'];
const forbidden = ['datastore.entities.create','datastore.entities.update','datastore.entities.delete','datastore.databases.import','datastore.databases.export','datastore.backups.restoreDatabase','datastore.schemas.create','datastore.schemas.update','datastore.schemas.delete','firebaserules.releases.update','resourcemanager.projects.setIamPolicy'];
export function validateApproval(a, args, now = Date.now()) {
  if (a?.version !== 1 || a.project !== project || args.project !== project || a.database !== '(default)' || args.database !== '(default)' || !/^\d+$/.test(a.projectNumber ?? '') || typeof a.region !== 'string' || !a.region) reject('PROJECT_OR_DATABASE_MISMATCH');
  if (!/^[a-z][a-z0-9-]+@george-69c3a\.iam\.gserviceaccount\.com$/.test(a.serviceAccount ?? '') || args.serviceAccount !== a.serviceAccount) reject('IDENTITY_MISMATCH');
  for (const key of ['approvedBy','iamReviewedBy','freezeEvidence','iamEvidence']) if (typeof a[key] !== 'string' || !a[key].trim()) reject('APPROVAL_INCOMPLETE');
  for (const key of ['allWritersStopped','writesConverged','effectiveIamReadOnly','sparkConfirmed','privateStorageConfirmed']) if (a[key] !== true) reject('APPROVAL_INCOMPLETE');
  const start = Date.parse(a.validFrom), end = Date.parse(a.validUntil), usageTime = Date.parse(a.usageCheckedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end-start > 3600000 || !Number.isFinite(usageTime) || usageTime > now || now-usageTime > 900000) reject('APPROVAL_EXPIRED');
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  if (a.quotaDay !== day || new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(end) !== day) reject('QUOTA_DAY_MISMATCH');
  for (const key of ['usedReads','otherReadsReserve','marginReads','maxReadUnits','maxBytes','maxDocuments']) if (!Number.isSafeInteger(a[key]) || a[key] < (key==='usedReads'?0:1)) reject('BUDGET_INVALID');
  if (a.usedReads+a.otherReadsReserve+a.marginReads+a.maxReadUnits >= 50000 || a.maxBytes > 128*1024*1024 || resolve(a.output)!==resolve(args.output)) reject('BUDGET_OR_OUTPUT_MISMATCH');
  return a;
}
export function assertRuntime(env = process.env) {
  for (const key of ['FIRESTORE_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS','GRPC_TRACE','GRPC_VERBOSITY','NODE_DEBUG','NODE_OPTIONS','GOOGLE_SDK_NODE_LOGGING','NODE_USE_ENV_PROXY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','CLOUDSDK_CORE_LOG_HTTP']) if (env[key]) reject('UNSAFE_RUNTIME_ENVIRONMENT');
}
export function rawValue(v, sourceProject) {
  if ('nullValue' in v) return ['null'];
  if ('stringValue' in v) return ['string',v.stringValue];
  if ('booleanValue' in v) return ['boolean',v.booleanValue];
  if ('integerValue' in v) return ['integer',String(v.integerValue)];
  if ('doubleValue' in v) return ['number',Object.is(v.doubleValue,-0)?'-0':String(v.doubleValue)];
  if ('timestampValue' in v) {
    const match=/^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(v.timestampValue);
    if (!match || !Number.isFinite(Date.parse(match[1]+'Z'))) reject('UNSUPPORTED_TIMESTAMP');
    return ['timestamp',Date.parse(match[1]+'Z')/1000,Number((match[2]??'').padEnd(9,'0'))];
  }
  if ('geoPointValue' in v) return ['geopoint',v.geoPointValue.latitude,v.geoPointValue.longitude];
  if ('bytesValue' in v) return ['bytes',v.bytesValue];
  if ('referenceValue' in v) {
    const prefix=`projects/${sourceProject}/databases/(default)/documents/`;
    if (!v.referenceValue.startsWith(prefix)) reject('CROSS_DATABASE_REFERENCE');
    return ['reference',v.referenceValue.slice(prefix.length)];
  }
  if ('arrayValue' in v) return ['array',(v.arrayValue.values??[]).map(x=>rawValue(x,sourceProject))];
  if (v.mapValue?.fields?.__type__?.stringValue === '__vector__') {
    const values = v.mapValue.fields.value?.arrayValue?.values;
    if (!Array.isArray(values)) reject('UNSUPPORTED_VECTOR');
    return ['vector', values.map(x => { const n = rawValue(x, sourceProject); return n[0] === 'integer' ? ['number', n[1]] : n; })];
  }
  if ('mapValue' in v) return ['map',Object.entries(v.mapValue.fields??{}).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,rawValue(x,sourceProject)])];
  reject('UNSUPPORTED_FIRESTORE_VALUE');
}
export async function productionBackup(a, { token, request = fetch, now = Date.now, inventory = false } = {}) {
  validateApproval(a,{project:a?.project,database:a?.database,serviceAccount:a?.serviceAccount,output:a?.output},now());
  if (!token || /\s/.test(token)) reject('TOKEN_REQUIRED');
  let units=0, bytes=0;
  const base=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`;
  async function rpc(url, method='GET', body, reservation=1) {
    if (now() >= Date.parse(a.validUntil)) reject('APPROVAL_EXPIRED');
    if (units+reservation > a.maxReadUnits) reject('READ_BUDGET_EXHAUSTED');
    units+=reservation;
    const r=await request(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if (!r.ok) reject('REMOTE_REQUEST_FAILED');
    // Limit even malformed/unexpected responses; no retries.
    let text='';const reader=r.body.getReader();const decoder=new TextDecoder();
    for (;;) {const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>a.maxBytes){await reader.cancel();reject('BYTE_BUDGET_EXHAUSTED');}text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();return JSON.parse(text);
  }
  const tokenInfo=await rpc(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (tokenInfo.email!==a.serviceAccount || Number(tokenInfo.expires_in)<120) reject('TOKEN_IDENTITY_OR_EXPIRY_MISMATCH');
  // Metadata is checked before document enumeration.
  const database=await rpc(base);
  if (database.name!==`projects/${project}/databases/(default)` || database.locationId!==a.region || database.type!=='FIRESTORE_NATIVE') reject('DATABASE_METADATA_MISMATCH');
  const info=await rpc(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`);
  if (info.projectId!==project || String(info.projectNumber)!==a.projectNumber || info.lifecycleState!=='ACTIVE') reject('PROJECT_METADATA_MISMATCH');
  const permissions=await rpc(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions`,'POST',{permissions:[...readPermissions,...forbidden]});
  if (!readPermissions.every(p=>permissions.permissions?.includes(p)) || forbidden.some(p=>permissions.permissions?.includes(p))) reject('IAM_NOT_READ_ONLY');
  if(inventory) return countInventory(rpc,base,a);
  async function scan() {
    const documents=[],collections=[],versions=[];
    const root=base+'/documents';
    async function children(parent, depth=0) {
      if(depth>100)reject('DEPTH_LIMIT');
      let pageToken;
      do {
        const result=await rpc(parent+':listCollectionIds','POST',{pageSize:100,...(pageToken?{pageToken}:{})});
        for(const collection of result.collectionIds??[]) {
          if(typeof collection!=='string'||!collection||collection.includes('/'))reject('INVALID_COLLECTION');
          await visit(parent+'/'+encodeURIComponent(collection),depth);
        }
        if(result.nextPageToken && result.nextPageToken===pageToken)reject('PAGINATION_STALLED');
        pageToken=result.nextPageToken;
      } while(pageToken);
    }
    async function visit(url,depth) {
      const path=decodeURIComponent(url.slice(root.length+1));collections.push(path);
      let pageToken;
      do {
        // Reserve full returned page plus missing/empty overhead before sending.
        const result=await rpc(url+'?pageSize=100&showMissing=true'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''),'GET',undefined,101);
        for(const d of result.documents??[]) {
          if(typeof d.name!=='string'||!d.name.startsWith(`projects/${project}/databases/(default)/documents/`))reject('DOCUMENT_PROJECT_MISMATCH');
          const path=d.name.slice(`projects/${project}/databases/(default)/documents/`.length);
          if(path.split('/').length%2!==0 || path.split('/').some(x=>!x||x==='.'||x==='..'))reject('DOCUMENT_PATH_MISMATCH');
          if(path.split('/').slice(0,-1).join('/')!==decodeURIComponent(url.slice(root.length+1)))reject('DOCUMENT_PATH_MISMATCH');
          if(d.fields && !d.updateTime)reject('INCOMPLETE_DOCUMENT');
          if(d.updateTime) {
            const data=rawValue({mapValue:{fields:d.fields??{}}},project);
            documents.push({path,data,sha256:hash(data)});versions.push({path,updateTime:d.updateTime});
            if(documents.length>a.maxDocuments)reject('DOCUMENT_BUDGET_EXHAUSTED');
          }
          await children(root+'/'+path.split('/').map(encodeURIComponent).join('/'),depth+1);
        }
        if(result.nextPageToken && result.nextPageToken===pageToken)reject('PAGINATION_STALLED');
        pageToken=result.nextPageToken;
      } while(pageToken);
    }
    await children(root);
    documents.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);collections.sort();versions.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    return {snapshot:{documents,collections},versions};
  }
  const first=await scan(),second=await scan();
  if(now()>=Date.parse(a.validUntil))reject('APPROVAL_EXPIRED');
  if(JSON.stringify(first)!==JSON.stringify(second))reject('SOURCE_CHANGED_DURING_BACKUP');
  return {format:'osatsu-firestore-backup',version:1,project,database:'(default)',createdAt:new Date(now()).toISOString(),consistency:'two-equal-scans-not-a-snapshot',snapshot:first.snapshot,sourceVersions:first.versions,manifest:{...manifest(first.snapshot),versionsSha256:hash(first.versions)},readBudgetUnits:units};
}
export async function obtainShortToken(a) {
  const {stdout}=await exec('gcloud',['auth','print-access-token',`--impersonate-service-account=${a.serviceAccount}`,'--scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email','--quiet'],{timeout:30000,maxBuffer:16384});
  return stdout.trim();
}
export async function main(args) {
  assertRuntime();
  if(args.length!==12)reject('EXPLICIT_ARGUMENTS_REQUIRED');
  const names=['--project','--database','--service-account','--approval-file','--output','--passphrase-file'];const values={};
  for(let i=0;i<12;i+=2){if(args[i]!==names[i])reject('EXPLICIT_ARGUMENTS_REQUIRED');values[names[i]]=args[i+1];}
  const approvalPath=await outsideRepo(values['--approval-file']);
  if((await stat(approvalPath)).mode&0o077)reject('PRIVATE_APPROVAL_REQUIRED');
  const a=validateApproval(JSON.parse(await readFile(approvalPath,'utf8')),{project:values['--project'],database:values['--database'],serviceAccount:values['--service-account'],output:values['--output']});
  const output=await outsideRepo(a.output);const parent=await stat(resolve(output,'..'));
  if(parent.mode&0o077)reject('PRIVATE_DIRECTORY_REQUIRED');
  try {await lstat(output);reject('OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  const keyPath=await outsideRepo(values['--passphrase-file']);if((await stat(keyPath)).mode&0o077)reject('PRIVATE_KEY_INPUT_REQUIRED');
  const password=await readFile(keyPath);if(password.length<32)reject('STRONG_PASSPHRASE_REQUIRED');
  try {
    // Explicit impersonation only, captured stdout; never use CLI token without this flag.
    const token=await obtainShortToken(a);
    const backup=await productionBackup(a,{token});
    // Validate every typed value before writing; dummy refs never connect to a DB.
    const {validate}=await import('./firestore-backup.mjs');validate(backup,{doc:path=>({path})},{expectedSource:project});
    await saveEncrypted(output,backup,password);
    console.info(`BACKUP_COMPLETE documents=${backup.manifest.count} reservedReadUnits=${backup.readBudgetUnits}`);
  } finally {password.fill(0);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('PRODUCTION_BACKUP_FAILED: no success recorded');process.exitCode=1;});
