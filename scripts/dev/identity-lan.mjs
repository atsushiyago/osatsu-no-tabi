import {spawn} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import {mkdtemp,writeFile,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {isIdentityLanAddress} from '../../src/utils/identityEnvironment.ts';
const root=resolve(new URL('../../',import.meta.url).pathname);
const host=process.argv[2]==='--host'&&process.argv.length===4?process.argv[3]:undefined;
if(!isIdentityLanAddress(host)||!Object.values(networkInterfaces()).flat().some(i=>i?.address===host&&!i.internal))throw new Error('Use --host with a private IPv4 address assigned to this Mac');
for(const [address,port]of [[host,5174],['127.0.0.1',18080],['127.0.0.1',19099],['127.0.0.1',14400],['127.0.0.1',14500]]) {
 await new Promise((yes,no)=>{const s=createServer();s.once('error',no);s.listen(port,address,()=>s.close(yes));});
}
const dir=await mkdtemp(join(tmpdir(),'osatsu-lan-'));
const config={firestore:{rules:join(root,'firestore.strict.rules'),indexes:join(root,'firestore.indexes.json')},emulators:{firestore:{host:'127.0.0.1',port:18080},auth:{host:'127.0.0.1',port:19099},hub:{host:'127.0.0.1',port:14400},logging:{host:'127.0.0.1',port:14500},ui:{enabled:false}}};
await writeFile(join(dir,'firebase.json'),JSON.stringify(config),{mode:0o600});
const emulatorLog=await open(join(dir,'emulators.log'),'w',0o600),viteLog=await open(join(dir,'vite.log'),'w',0o600);
const children=[];let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const c of children){try{process.kill(-c.pid,'SIGTERM');}catch{}}}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
function start(cmd,args,env,log){const c=spawn(cmd,args,{cwd:root,env,detached:true,stdio:['ignore',log.fd,log.fd]});children.push(c);c.on('error',()=>{process.exitCode=1;stop();});c.on('exit',code=>{if(!stopping){process.exitCode=code||1;stop();}});return c;}
const env={...process.env};delete env.GOOGLE_APPLICATION_CREDENTIALS;
start('firebase',['--project','demo-osatsu-public-serial','--config',join(dir,'firebase.json'),'emulators:start','--only','firestore,auth'],env,emulatorLog);
async function waitFor(url){for(let n=0;n<120;n++){if(stopping)throw new Error('Development server stopped');try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw new Error('Emulator did not become available');}
try{
 await waitFor('http://127.0.0.1:19099/emulator/v1/projects/demo-osatsu-public-serial/config');
 const base='http://127.0.0.1:18080/v1/projects/demo-osatsu-public-serial/databases/(default)/documents/';
 async function seed(path,fields){const r=await fetch(base+path,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields}),signal:AbortSignal.timeout(3000)});if(!r.ok)throw new Error('Demo seed failed');}
 const text=x=>({stringValue:x}),integer=x=>({integerValue:String(x)});
 const id='11111111-1111-4111-8111-111111111111',sighting='lan-legacy-sighting';const now=new Date(Date.now()-3600000).toISOString();
 await seed('appConfig/billRegistration',{mode:text('v2'),identityVersion:integer(2)});
 await seed('serialIndex/QA654321B',{publicBillId:text(id),createdAt:{timestampValue:now}});
 await seed('publicBills/'+id,{id:text(id),denomination:integer(1000),createdAt:text(now),updatedAt:text(now),firstSightedAt:text(now),lastSightedAt:text(now),lastSightedAtServer:{timestampValue:now},lastMunicipality:text('千代田区'),lastSightingId:text(sighting),sightingsCount:integer(1),totalDistanceKm:integer(0)});
 await seed('sightings/'+sighting,{id:text(sighting),publicBillId:text(id),step:integer(1),prefecture:text('東京都'),municipality:text('千代田区'),createdAt:text(now),distanceFromPrevKm:integer(0),daysFromPrev:integer(0)});
 const devEnv={...env,VITE_USE_FIREBASE_EMULATORS:'true',VITE_BILL_IDENTITY_V2:'true',VITE_IDENTITY_LAN_HOST:host,VITE_RECAPTCHA_ENTERPRISE_SITE_KEY:'',VITE_FIREBASE_APPCHECK_DEBUG:''};
 for(const key of ['API_KEY','AUTH_DOMAIN','PROJECT_ID','STORAGE_BUCKET','MESSAGING_SENDER_ID','APP_ID'])devEnv['VITE_FIREBASE_'+key]='';
 start(process.execPath,[join(root,'node_modules/vite/bin/vite.js')],devEnv,viteLog);
 await waitFor(`http://${host}:5174`);
 console.info(`LAN demo ready: http://${host}:5174/#/register`);
 console.info('Project: demo-osatsu-public-serial; App Check off; Auth + Firestore via LAN Vite proxy to loopback emulators.');
 console.info(`Private logs: ${dir}`);
 console.info('Synthetic v1 search fixture: QA654321B (1000 yen). Stop with Ctrl+C. No router forwarding/tunnel.');
}catch{console.error(`LAN startup failed. Inspect private logs: ${dir}`);process.exitCode=1;stop();}
