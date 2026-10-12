import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const V1_RULES_SHA256 = 'b48b4884ae3e8a92bd72d1ab0ee7864aeaa902be15e59f4aaf3d8bb01d198107';
export function allWritesPausedRules(source) {
  if (createHash('sha256').update(source).digest('hex') !== V1_RULES_SHA256) throw new Error('Reviewed production v1 Rules source mismatch');
  // Replace every write grant in place. A catch-all deny cannot override another grant.
  const result = source.replace(/allow\s+([a-z,\s]+):\s*if\s+([\s\S]*?);/g, (original, operations, condition) => {
    const ops = operations.split(',').map(s => s.trim());
    if (!ops.some(op => ['write', 'create', 'update', 'delete'].includes(op))) return original;
    const reads = ops.filter(op => ['read', 'get', 'list'].includes(op));
    if (reads.length && condition.trim() !== 'false') throw new Error('Mixed read/write grant requires manual review');
    return `${reads.length ? `allow ${reads.join(', ')}: if ${condition};\n      ` : ''}allow ${ops.filter(op => !reads.includes(op)).join(', ')}: if false;`;
  });
  return '// Backup freeze: derived from reviewed production v1; all client writes denied.\n' + result;
}
export function reviewedV1Rules() {
  return execFileSync('git', ['show', 'f2e5f26:firestore.strict.rules'], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8' });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../firestore.all-writes-paused.rules', import.meta.url), allWritesPausedRules(reviewedV1Rules()));
}
