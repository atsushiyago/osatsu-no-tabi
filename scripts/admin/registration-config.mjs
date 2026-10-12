import { readFile, lstat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertRuntime, obtainShortToken } from '../backup/production-backup.mjs';
import { outsideRepo } from '../backup/firestore-backup.mjs';
import { maintenanceLock } from './maintenance-lock.mjs';
export const project = 'george-69c3a';
export const configPath = 'appConfig/billRegistration';
const fail = code => { throw new Error(code); };
export function validateConfigApproval(a, action, now = Date.now()) {
  if (a?.version !== 2 || !['inspect','apply'].includes(action) || a.action !== action) fail('APPROVAL_ACTION_MISMATCH');
  const common = ['version','action','project','database','path','projectNumber','region','serviceAccount','operationId','approvedBy','iamEvidence','maintenanceEvidence','rulesEvidence','backupInProgress','backupVerificationInProgress','adminIamReviewed','sparkConfirmed','validFrom','validUntil'];
  const allowed = action === 'apply' ? [...common, 'from','to','expectedUpdateTime'] : common;
  if (Object.keys(a).some(key => !allowed.includes(key))) fail('APPROVAL_FIELDS_INVALID');
  if (a.project !== project || a.database !== '(default)' || a.path !== configPath || !/^\d+$/.test(a.projectNumber ?? '') || !a.region) fail('TARGET_MISMATCH');
  if (!/^[a-z][a-z0-9-]+@george-69c3a\.iam\.gserviceaccount\.com$/.test(a.serviceAccount ?? '') || /backup|reader/i.test(a.serviceAccount)) fail('ADMIN_IDENTITY_REQUIRED');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a.operationId ?? '')) fail('OPERATION_ID_REQUIRED');
  for (const k of ['approvedBy', 'iamEvidence', 'maintenanceEvidence', 'rulesEvidence']) if (typeof a[k] !== 'string' || !a[k].trim()) fail('APPROVAL_REQUIRED');
  if (a.backupInProgress !== false || a.backupVerificationInProgress !== false || a.adminIamReviewed !== true || a.sparkConfirmed !== true) fail('BACKUP_OR_APPROVAL_BLOCKED');
  const start = Date.parse(a.validFrom), end = Date.parse(a.validUntil);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end - start > 900000) fail('APPROVAL_EXPIRED');
  if (action === 'inspect') return a;
  if (!['paused', 'v2'].includes(a.to) || ![null, 'paused', 'v2'].includes(a.from) || a.to === a.from || (a.from === null && a.to !== 'paused')) fail('TRANSITION_NOT_ALLOWED');
  if (a.from === null ? a.expectedUpdateTime !== null : typeof a.expectedUpdateTime !== 'string' || !Number.isFinite(Date.parse(a.expectedUpdateTime))) fail('PRECONDITION_REQUIRED');
  return a;
}
export function configState(data, name) {
  if (data === null) return null;
  if (data.name !== name || !data.updateTime || Object.keys(data.fields ?? {}).sort().join(',') !== 'identityVersion,mode' || data.fields.identityVersion?.integerValue !== '2' || !['paused','v2'].includes(data.fields.mode?.stringValue)) fail('CONFIG_INVALID');
  return { mode: data.fields.mode.stringValue, updateTime: data.updateTime };
}
/** Fixed-path mutation core; injectable transport is for offline mocks/Emulator only. */
export async function changeConfig(a, { request, base, now = Date.now, beforeCommit = async () => {} }) {
  validateConfigApproval(a, 'apply', now());
  if (base !== `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)` && !/^http:\/\/127\.0\.0\.1:[0-9]+\/v1\/projects\/demo-[a-z0-9-]+\/databases\/\(default\)$/.test(base)) fail('TRANSPORT_TARGET_MISMATCH');
  const name = base.slice(base.indexOf('/projects/') + 1) + '/documents/' + configPath;
  const url = base + '/documents/' + configPath;
  const read = async () => { const r = await request(url); if (r.status === 404) return null; if (!r.ok) fail('CONFIG_READ_FAILED'); return configState(await r.json(), name); };
  const previous = await read();
  if (previous?.mode !== (a.from ?? undefined) || (previous?.updateTime ?? null) !== a.expectedUpdateTime) fail('PREVIOUS_STATE_MISMATCH');
  validateConfigApproval(a, 'apply', now());
  await beforeCommit(); // Persist single-use receipt before sending; ambiguous outcomes cannot reapply.
  validateConfigApproval(a, 'apply', now());
  const body = { writes: [{ update: { name, fields: { mode: { stringValue: a.to }, identityVersion: { integerValue: '2' } } }, updateMask: { fieldPaths: ['mode', 'identityVersion'] }, currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false } }] };
  let ambiguous = false;
  try { const r = await request(base + '/documents:commit', { method: 'POST', body: JSON.stringify(body) }); if (!r.ok) { if (r.status < 500 && r.status !== 408) fail('CONFIG_COMMIT_REJECTED'); ambiguous = true; } }
  catch (e) { if (e.message === 'CONFIG_COMMIT_REJECTED') throw e; ambiguous = true; }
  let after;
  try { after = await read(); } catch { return { status: 'unknown', from: a.from, to: a.to }; }
  if (after?.mode === a.to && after.updateTime !== previous?.updateTime) return { status: ambiguous ? 'observed-target-after-uncertainty' : 'verified', from: a.from, to: a.to };
  return { status: ambiguous ? 'not-confirmed' : 'verification-failed', from: a.from, to: a.to };
}
export async function verifyAdmin(a, request) {
  const info = await request('https://cloudresourcemanager.googleapis.com/v1/projects/' + project);
  if (!info.ok) fail('PROJECT_METADATA_FAILED');const p = await info.json();
  if (p.projectId !== project || String(p.projectNumber) !== a.projectNumber || p.lifecycleState !== 'ACTIVE') fail('PROJECT_METADATA_MISMATCH');
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`;
  const r = await request(base);if (!r.ok) fail('DATABASE_METADATA_FAILED');const db = await r.json();
  if (db.name !== `projects/${project}/databases/(default)` || db.locationId !== a.region || db.type !== 'FIRESTORE_NATIVE') fail('DATABASE_METADATA_MISMATCH');
  const permissions = ['datastore.entities.get', ...(a.action === 'apply' ? [a.from === null ? 'datastore.entities.create' : 'datastore.entities.update'] : [])];
  const denied = ['datastore.entities.delete','datastore.databases.import','datastore.databases.export','firebaserules.releases.update','resourcemanager.projects.setIamPolicy'];
  const result = await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions`, { method: 'POST', body: JSON.stringify({ permissions: [...permissions, ...denied] }) });
  if (!result.ok) fail('IAM_CHECK_FAILED');const actual = (await result.json()).permissions ?? [];
  if (!permissions.every(x => actual.includes(x)) || denied.some(x => actual.includes(x))) fail('ADMIN_IAM_MISMATCH');
  return base;
}
export async function verifyToken(a, token, request) {
  const r = await request('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
  if (!r.ok) fail('TOKEN_CHECK_FAILED');const identity = await r.json();
  if (identity.email !== a.serviceAccount || !Number.isFinite(Number(identity.expires_in)) || Number(identity.expires_in) < 120) fail('TOKEN_IDENTITY_MISMATCH');
}
export async function readConfigApproval(file, action, expectedSha256, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) fail('APPROVAL_HASH_REQUIRED');
  const path = await outsideRepo(file);const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077)) fail('PRIVATE_APPROVAL_REQUIRED');
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedSha256) fail('APPROVAL_FILE_CHANGED');
  return { approval: validateConfigApproval(JSON.parse(bytes.toString('utf8')), action, now), sha256 };
}
export async function bindApproval(directory, a, sha256) {
  const path = join(directory, `approval-${a.operationId}.json`);
  const content = JSON.stringify({ action: a.action, sha256 });
  try { await writeFile(path, content, { flag: 'wx', mode: 0o600 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) || await readFile(path, 'utf8') !== content) fail('APPROVAL_ID_REBOUND');
  }
}
export async function inspectConfig(a, { request, base, now = Date.now }) {
  validateConfigApproval(a, 'inspect', now());
  if (base !== `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)` && !/^http:\/\/127\.0\.0\.1:[0-9]+\/v1\/projects\/demo-[a-z0-9-]+\/databases\/\(default\)$/.test(base)) fail('TRANSPORT_TARGET_MISMATCH');
  const r = await request(base + '/documents/' + configPath);
  if (r.status === 404) return null;
  if (!r.ok) fail('CONFIG_READ_FAILED');
  return configState(await r.json(), base.slice(base.indexOf('/projects/') + 1) + '/documents/' + configPath);
}
export async function main(args) {
  assertRuntime();
  if (args.length !== 6 || args[4] !== '--approval-sha256' || !['apply','inspect'].includes(args[0]) || args[1] !== '--project' || args[2] !== project) fail('EXPLICIT_TARGET_REQUIRED');
  const { approval: a, sha256 } = await readConfigApproval(args[3], args[0], args[5]);
  const lock = await maintenanceLock('config');
  try {
    await bindApproval(lock.directory, a, sha256);
    const token = await obtainShortToken(a);
    const request = (url, options = {}) => fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    await verifyToken(a, token, request);
    const base = await verifyAdmin(a, request);
    if (args[0] === 'inspect') {
      const state = await inspectConfig(a, { request, base });console.info(state === null ? 'CONFIG_ABSENT' : JSON.stringify(state));return;
    }
    const result = await changeConfig(a, { request, base, beforeCommit: () => writeFile(join(lock.directory, `operation-${a.operationId}.json`), JSON.stringify({ operationId: a.operationId, from: a.from, to: a.to, attemptedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }) });
    console.info(JSON.stringify(result));if (result.status !== 'verified') process.exitCode = 2;
  } finally { await lock.release(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => { console.error('CONFIG_OPERATION_FAILED: no automatic retry; inspect state and retain pause');process.exitCode = 1; });
