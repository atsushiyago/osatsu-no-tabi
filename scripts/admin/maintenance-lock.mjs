import { mkdir, lstat, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const maintenanceDirectory = join(homedir(), '.osatsu-maintenance', 'george-69c3a');
export async function maintenanceLock(kind, directory = maintenanceDirectory) {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const s = await lstat(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) || s.uid !== process.getuid()) throw new Error('UNSAFE_MAINTENANCE_DIRECTORY');
  const lock = join(directory, 'operation.lock');
  try { await mkdir(lock, { mode: 0o700 }); } catch { throw new Error('MAINTENANCE_OPERATION_ACTIVE'); }
  const lease = join(directory, 'backup-lease.json');
  try {
    if (kind === 'config') {
      try { await lstat(lease); throw new Error('BACKUP_LEASE_ACTIVE'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (kind === 'backup') {
      try { await lstat(lease); } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        await writeFile(lease, JSON.stringify({ id: randomUUID(), startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
      }
    }
    return { directory, release: () => rm(lock, { recursive: true }) };
  } catch (e) { await rm(lock, { recursive: true }); throw e; }
}
export async function endBackupLease(id, evidence, directory = maintenanceDirectory) {
  if (!/^[a-f0-9-]{36}$/.test(id ?? '') || !evidence?.trim()) throw new Error('BACKUP_VERIFICATION_EVIDENCE_REQUIRED');
  const lock = await maintenanceLock('finish-backup', directory);
  try {
    const file = join(directory, 'backup-lease.json');
    const lease = JSON.parse(await readFile(file, 'utf8'));
    if (lease.id !== id) throw new Error('BACKUP_LEASE_MISMATCH');
    await writeFile(join(directory, `verified-${id}.json`), JSON.stringify({ id, evidence, verifiedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    await rm(file);
  } finally { await lock.release(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, id, evidence, ...rest] = process.argv.slice(2);
  if (command !== 'finish-backup' || rest.length) throw new Error('USAGE_FINISH_BACKUP_LEASE_ID_VERIFICATION_EVIDENCE');
  endBackupLease(id, evidence).then(() => console.info('BACKUP_LEASE_CLOSED')).catch(() => { console.error('BACKUP_LEASE_CLOSE_FAILED'); process.exitCode = 1; });
}
