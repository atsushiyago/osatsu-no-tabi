import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('Google account merge Emulator PoC requires Node.js 24 or newer');
}

const root = fileURLToPath(new URL('../', import.meta.url));
const testFile = fileURLToPath(new URL('./google-account-merge-emulator.test.js', import.meta.url));
const env = {
  ...process.env,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099',
};
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const result = spawnSync('firebase', [
  '--project', 'demo-osatsu-account-merge-poc',
  '--config', 'firebase.identity-v2.json',
  'emulators:exec', '--only', 'firestore,auth',
  `${quote(process.execPath)} --test ${quote(testFile)}`,
], { cwd: root, env, stdio: 'inherit' });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
