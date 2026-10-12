import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Capture real Node before standalone Firebase CLI prepends its node shim to PATH.
// The suite uses built-in TypeScript support and the real node:test runner.
if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('Identity Emulator tests require Node.js 24 or newer');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const runner = fileURLToPath(import.meta.url);
const env = {
  ...process.env,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099',
};

function run(command, args, childEnv = env) {
  const result = spawnSync(command, args, { cwd: root, env: childEnv, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.env.OSATSU_IDENTITY_EMULATOR_PHASE === 'suite') {
  run(process.execPath, ['test/strict-rules.runner.cjs']);
  run(process.execPath, ['--test', 'test/bill-identity-rules.test.js']);
  run(process.execPath, ['--test', 'test/rules-access-budget.test.js']);
  run(process.execPath, ['--test', 'test/identity-rollout.test.js']);
  run(process.execPath, ['test/run-historical-rules.mjs']);
} else {
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  run('firebase', [
    '--project', 'demo-osatsu-public-serial', '--config', 'firebase.identity-v2.json',
    'emulators:exec', '--only', 'firestore,auth', `${quote(process.execPath)} ${quote(runner)}`,
  ], { ...env, OSATSU_IDENTITY_EMULATOR_PHASE: 'suite' });
}
