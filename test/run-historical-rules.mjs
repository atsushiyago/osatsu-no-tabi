// Archived contracts are executed against their original Rules, not accepted as
// v2 compatibility tests. Both projects and endpoints are emulator-only.
import { readFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadRules, clearDemoProject } from './helpers/identity-emulator.js';
const cases = [
  ['demo-george-rules-test', 'test/rules.test.js', await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')],
  ['demo-george-strict-rate-limit', 'test/strict-rules.test.js', execFileSync('git', ['show', 'c0d492b:firestore.strict.rules'], { encoding: 'utf8' })],
];
for (const [project, script, rules] of cases) {
  await clearDemoProject(project); await loadRules(rules, project);
  console.log(`Archived contract: ${script} on ${project}`);
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
