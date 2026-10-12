import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../',import.meta.url));
const env = {...process.env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:18080',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:19099'};
// Admin backup has no need for production credentials. Never inherit a key file.
delete env.GOOGLE_APPLICATION_CREDENTIALS;
function run(command,args,childEnv=env) {
  const result=spawnSync(command,args,{cwd:root,env:childEnv,stdio:'inherit'});
  if(result.error) throw result.error;
  if(result.status!==0) process.exit(result.status??1);
}
if(process.env.OSATSU_BACKUP_EMULATOR_PHASE==='suite') {
  run(process.execPath,['--test','test/firestore-backup.test.js']);
  run(process.execPath,['test/run-identity-emulators.mjs'],{...env,OSATSU_IDENTITY_EMULATOR_PHASE:'suite'});
} else {
  const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
  run('firebase',['--project','demo-osatsu-backup-source','--config','firebase.identity-v2.json','emulators:exec','--only','firestore,auth',`${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))}`],{...env,OSATSU_BACKUP_EMULATOR_PHASE:'suite'});
}
