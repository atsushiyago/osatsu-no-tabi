import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ required');
const root = fileURLToPath(new URL('../', import.meta.url));
const runner = fileURLToPath(import.meta.url);
const env = { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:28080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:29099', OSATSU_CONFIG_TEST: 'true' };
let result;
if (process.env.OSATSU_CONFIG_PHASE === 'suite') {
  result = spawnSync(process.execPath, ['--test', 'test/registration-config-emulator.test.js'], { cwd: root, env, stdio: 'inherit' });
} else {
  const dir = mkdtempSync(join(tmpdir(), 'osatsu-config-test-'));
  const config = join(dir, 'firebase.json');
  writeFileSync(config, JSON.stringify({ firestore: { rules: join(root, 'firestore.all-writes-paused.rules') }, emulators: { firestore: { host: '127.0.0.1', port: 28080, websocketPort: 29151 }, auth: { host: '127.0.0.1', port: 29099 }, hub: { host: '127.0.0.1', port: 24400 }, logging: { host: '127.0.0.1', port: 24500 }, ui: { enabled: false } } }), { mode: 0o600 });
  const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
  result = spawnSync('firebase', ['--project', 'demo-osatsu-registration-config', '--config', config, 'emulators:exec', '--only', 'firestore,auth', `${quote(process.execPath)} ${quote(runner)}`], { cwd: dir, env: { ...env, OSATSU_CONFIG_PHASE: 'suite' }, stdio: 'inherit' });
}
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
