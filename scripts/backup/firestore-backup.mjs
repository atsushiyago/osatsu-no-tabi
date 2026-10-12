import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint, DocumentReference, FieldValue } from 'firebase-admin/firestore';
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, stat, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { maintenanceLock } from '../admin/maintenance-lock.mjs';

const VectorValue = FieldValue.vector([]).constructor;
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value);
const fail = () => { throw new Error('BACKUP_VALIDATION_FAILED'); };
export function assertEmulator(project, host = process.env.FIRESTORE_EMULATOR_HOST) {
  if (!/^demo-[a-z0-9-]+$/.test(project ?? '') || !/^127\.0\.0\.1:([0-9]+)$/.test(host ?? '') || Number(host.split(':')[1]) < 1 || Number(host.split(':')[1]) > 65535) throw new Error('EXPLICIT_LOOPBACK_DEMO_EMULATOR_REQUIRED');
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('CREDENTIAL_ENV_NOT_ALLOWED');
}
export async function openEmulator(project) {
  assertEmulator(project);
  const app = initializeApp({ projectId: project }, `backup-${randomBytes(8).toString('hex')}`);
  const db = getFirestore(app);
  // Both env and effective SDK transport must remain loopback; no production fallback.
  db.settings({ host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false, useBigInt: true, universeDomain: 'googleapis.com' });
  return { db, close: async () => { await db.terminate(); await deleteApp(app); } };
}
export function encode(value, db) {
  if (value === null) return ['null'];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'bigint') return ['integer', value.toString()];
  if (value instanceof VectorValue) return ['vector', value.toArray().map((n) => encode(n, db))];
  if (typeof value === 'number') {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('UNSAFE_INTEGER_NOT_SUPPORTED');
    return ['number', Object.is(value, -0) ? '-0' : String(value)];
  }
  if (value instanceof Timestamp) return ['timestamp', value.seconds, value.nanoseconds];
  if (value instanceof Date) return encode(Timestamp.fromDate(value), db);
  if (value instanceof GeoPoint) return ['geopoint', value.latitude, value.longitude];
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return ['bytes', Buffer.from(value).toString('base64')];
  if (value instanceof DocumentReference) {
    if (value.firestore !== db) throw new Error('CROSS_DATABASE_REFERENCE_NOT_SUPPORTED');
    return ['reference', value.path];
  }
  if (Array.isArray(value)) return ['array', value.map((v) => encode(v, db))];
  if (value && Object.getPrototypeOf(value) === Object.prototype) return ['map', Object.keys(value).sort().map((key) => [key, encode(value[key], db)])];
  throw new Error('UNSUPPORTED_FIRESTORE_TYPE');
}
function pathValid(path, document = true) {
  return typeof path === 'string' && path.length > 0 && path.split('/').every((s) => s && s !== '.' && s !== '..') && path.split('/').length % 2 === (document ? 0 : 1);
}
export function decode(v, db) {
  if (!Array.isArray(v)) fail();
  const [type, a, b] = v;
  switch (type) {
    case 'null': if (v.length !== 1) fail(); return null;
    case 'string': if (v.length !== 2 || typeof a !== 'string') fail(); return a;
    case 'boolean': if (v.length !== 2 || typeof a !== 'boolean') fail(); return a;
    case 'number': {
      if (v.length !== 2 || typeof a !== 'string' || !/^(?:NaN|Infinity|-Infinity|-0|-?(?:\d+\.?\d*|\d*\.\d+)(?:e[+-]?\d+)?)$/i.test(a)) fail();
      const n = Number(a); if (Number.isInteger(n) && !Number.isSafeInteger(n)) fail(); return n;
    }
    case 'integer': if (v.length !== 2 || typeof a !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(a) || BigInt(a) < -(2n ** 63n) || BigInt(a) > 2n ** 63n - 1n) fail(); return BigInt(a);
    case 'vector': if (v.length !== 2 || !Array.isArray(a)) fail(); return FieldValue.vector(a.map((n) => { const x = decode(n, db); if (typeof x !== 'number' || !Number.isFinite(x)) fail(); return x; }));
    case 'timestamp': if (v.length !== 3 || !Number.isInteger(a) || !Number.isInteger(b)) fail(); return new Timestamp(a, b);
    case 'geopoint': if (v.length !== 3 || !Number.isFinite(a) || !Number.isFinite(b)) fail(); return new GeoPoint(a, b);
    case 'bytes': if (v.length !== 2 || typeof a !== 'string' || Buffer.from(a, 'base64').toString('base64') !== a) fail(); return Buffer.from(a, 'base64');
    case 'reference': if (v.length !== 2 || !pathValid(a)) fail(); return db.doc(a);
    case 'array': if (v.length !== 2 || !Array.isArray(a)) fail(); return a.map((entry) => decode(entry, db));
    case 'map': {
      if (v.length !== 2 || !Array.isArray(a)) fail();
      const out = {}; const seen = new Set();
      for (const entry of a) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || seen.has(entry[0])) fail();
        seen.add(entry[0]); Object.defineProperty(out, entry[0], { value: decode(entry[1], db), enumerable: true, writable: true });
      }
      return out;
    }
    default: fail();
  }
}
export async function scan(db) {
  assertEmulator(db.projectId);
  if (`${db._settings.servicePath}:${db._settings.port}` !== process.env.FIRESTORE_EMULATOR_HOST || db._settings.ssl !== false || db._settings.useBigInt !== true || db.databaseId !== '(default)') throw new Error('UNSAFE_DATABASE_TRANSPORT');
  const documents = []; const collections = [];
  async function visit(collection) {
    collections.push(collection.path);
    // listDocuments includes missing ancestor document references; query().get() does not.
    const refs = await collection.listDocuments();
    for (const ref of refs) {
      const snap = await ref.get();
      if (snap.exists) {
        const data = encode(snap.data(), db);
        documents.push({ path: ref.path, data, sha256: sha(json(data)) });
      }
      for (const child of await ref.listCollections()) await visit(child);
    }
  }
  for (const col of await db.listCollections()) await visit(col);
  documents.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  collections.sort();
  return { documents, collections };
}
export function manifest(snapshot) {
  const counts = Object.fromEntries(snapshot.collections.map((path) => [path, 0]));
  for (const doc of snapshot.documents) counts[doc.path.split('/').slice(0, -1).join('/')]++;
  return { count: snapshot.documents.length, collections: counts, sha256: sha(json(snapshot)) };
}
export async function capture(db, project) {
  assertEmulator(project);
  if (db.projectId !== project) throw new Error('PROJECT_MISMATCH');
  const first = await scan(db); const second = await scan(db);
  if (json(first) !== json(second)) throw new Error('SOURCE_CHANGED_DURING_BACKUP');
  return { format: 'osatsu-firestore-backup', version: 1, project, database: '(default)', createdAt: new Date().toISOString(), consistency: 'two-equal-scans-not-a-snapshot', snapshot: first, manifest: manifest(first) };
}
export function validate(backup, db, { expectedSource } = {}) {
  const sourceAllowed = /^demo-[a-z0-9-]+$/.test(backup?.project ?? '') || (expectedSource === 'george-69c3a' && backup?.project === expectedSource);
  if (!backup || backup.format !== 'osatsu-firestore-backup' || backup.version !== 1 || !sourceAllowed || backup.database !== '(default)' || !Array.isArray(backup.snapshot?.documents) || !Array.isArray(backup.snapshot?.collections)) fail();
  const paths = new Set();
  for (const col of backup.snapshot.collections) if (!pathValid(col, false)) fail();
  if (new Set(backup.snapshot.collections).size !== backup.snapshot.collections.length) fail();
  for (const doc of backup.snapshot.documents) {
    if (!pathValid(doc.path) || paths.has(doc.path) || sha(json(doc.data)) !== doc.sha256 || doc.data?.[0] !== 'map' || !backup.snapshot.collections.includes(doc.path.split('/').slice(0, -1).join('/'))) fail();
    paths.add(doc.path); decode(doc.data, db);
  }
  const calculated = manifest(backup.snapshot);
  if (backup.sourceVersions !== undefined) {
    if (!Array.isArray(backup.sourceVersions) || backup.sourceVersions.length !== paths.size || backup.sourceVersions.some((v, i) => v.path !== backup.snapshot.documents[i]?.path || typeof v.updateTime !== 'string')) fail();
    calculated.versionsSha256 = sha(json(backup.sourceVersions));
  }
  if (json(calculated) !== json(backup.manifest)) fail();
}
export async function restore(db, project, backup, options = {}) {
  assertEmulator(project);
  if (db.projectId !== project) throw new Error('PROJECT_MISMATCH');
  validate(backup, db, options);
  const before = await scan(db);
  if (before.documents.length || before.collections.length) throw new Error('EMPTY_TARGET_REQUIRED');
  // create() rather than set(): concurrent/unexpected target data cannot be overwritten.
  for (let i = 0; i < backup.snapshot.documents.length; i += 200) {
    const batch = db.batch();
    for (const doc of backup.snapshot.documents.slice(i, i + 200)) batch.create(db.doc(doc.path), decode(doc.data, db));
    await batch.commit();
  }
  const actual = await scan(db);
  if (json(actual) !== json(backup.snapshot)) throw new Error('RESTORE_VERIFICATION_FAILED');
  return manifest(actual);
}
export function encrypt(backup, password) {
  if (!Buffer.isBuffer(password) || password.length < 16) throw new Error('STRONG_PASSPHRASE_REQUIRED');
  const salt = randomBytes(16); const iv = randomBytes(12); const key = scryptSync(password, salt, 32);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(json(backup), 'utf8'), cipher.final()]);
    return json({ format: 'osatsu-encrypted-backup', version: 1, kdf: 'scrypt-N16384-r8-p1', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
  } finally { key.fill(0); }
}
export function decrypt(text, password) {
  if (!Buffer.isBuffer(password) || password.length < 16) throw new Error('STRONG_PASSPHRASE_REQUIRED');
  const e = JSON.parse(text);
  if (e.format !== 'osatsu-encrypted-backup' || e.version !== 1 || e.kdf !== 'scrypt-N16384-r8-p1') fail();
  const salt = Buffer.from(e.salt, 'base64'); const iv = Buffer.from(e.iv, 'base64'); const tag = Buffer.from(e.tag, 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) fail();
  const key = scryptSync(password, salt, 32);
  try { const d = createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag); return JSON.parse(Buffer.concat([d.update(Buffer.from(e.ciphertext, 'base64')), d.final()]).toString('utf8')); } finally { key.fill(0); }
}
export async function outsideRepo(path) {
  const absolute = resolve(path); const parent = await realpath(resolve(absolute, '..'));
  const rel = relative(await realpath(root), parent);
  if (rel === '' || (!rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel))) throw new Error('STORE_OUTSIDE_REPOSITORY');
  try { if ((await lstat(absolute)).isSymbolicLink()) throw new Error('SYMLINK_FILE_NOT_ALLOWED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return absolute;
}
export async function saveEncrypted(path, backup, password) {
  const target = await outsideRepo(path);
  await writeFile(target, encrypt(backup, password), { flag: 'wx', mode: 0o600 });
  if (json(decrypt(await readFile(target, 'utf8'), password)) !== json(backup)) throw new Error('SAVED_FILE_VERIFICATION_FAILED');
}
export async function main(args) {
  if (![4, 6].includes(args.length) || (args.length === 6 && (args[4] !== '--source-project' || args[5] !== 'george-69c3a')) || !['backup', 'restore', 'verify'].includes(args[0])) throw new Error('USAGE: backup|restore|verify demo-project output.osatsu-backup passphrase-file');
  const [command, project, file, keyFile] = args;
  const options = { expectedSource: args[5] };
  if (command === 'backup' && args.length !== 4) throw new Error('SOURCE_OPTION_RESTORE_VERIFY_ONLY');
  assertEmulator(project);
  const secretPath = await outsideRepo(keyFile); const s = await stat(secretPath);
  if (!s.isFile() || (s.mode & 0o077)) throw new Error('PASSPHRASE_FILE_MUST_BE_PRIVATE');
  const password = await readFile(secretPath);
  let connection, maintenance;
  try {
    if (options.expectedSource === 'george-69c3a') maintenance = await maintenanceLock('backup');
    connection = await openEmulator(project);
    if (command === 'backup') {
      const backup = await capture(connection.db, project); await saveEncrypted(file, backup, password);
      console.info(`BACKUP_COMPLETE documents=${backup.manifest.count}`);
    } else {
      const backup = decrypt(await readFile(await outsideRepo(file), 'utf8'), password); validate(backup, connection.db, options);
      if (command === 'restore') { const result = await restore(connection.db, project, backup, options); console.info(`RESTORE_VERIFIED documents=${result.count}`); }
      else console.info(`BACKUP_VALID documents=${backup.manifest.count}`);
    }
  } finally { password.fill(0); if (connection) await connection.close(); if (maintenance) await maintenance.release(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { console.error('BACKUP_OPERATION_FAILED: no success recorded; inspect isolated target before retry.'); process.exitCode = 1; });
}
