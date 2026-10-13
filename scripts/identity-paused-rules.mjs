import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** A hard registration barrier independent of appConfig and old client code. */
export function pausedIdentityRules(source) {
  const replacements = [
    [/allow create: if request.auth != null && validIndex\(key\);/, 'allow create: if false;'],
    [/allow create: if request.auth != null && opaque\(id\) && validReverse\(id\);/, 'allow create: if false;'],
    [/allow create: if request.auth != null && opaque\(id\) && validBillCreate\(id\);/, 'allow create: if false;'],
    [/allow update: if request.auth != null && validBillUpdate\(id\);/, 'allow update: if false;'],
    [/allow create: if request.auth != null && validSighting\(id\);/, 'allow create: if false;'],
    [/allow create: if request.auth != null && request.auth.uid == uid\s*&& validRateFields\(request.resource.data\) && initialRate\(request.resource.data\)\s*&& validRateOperation\(request.resource.data\);/, 'allow create: if false;'],
    [/allow update: if request.auth != null && request.auth.uid == uid\s*&& validRateFields\(request.resource.data\) && advanceRate\(resource.data, request.resource.data\)\s*&& validRateOperation\(request.resource.data\);/, 'allow update: if false;'],
    [/allow create: if request.auth != null && request.auth.uid == uid\s*&& \(validTrackedCreate\(id\) \|\| validMergeTrackedCreate\(uid, id\)\);/, 'allow create: if false;'],
    [/&& resource.data.publicBillId == id && validTrackedUpdate\(id\);/, '&& resource.data.publicBillId == id && metadataUpdate(request.resource.data, resource.data, get(/databases/$(database)/documents/publicBills/$(id)).data);'],
  ];
  let paused = source;
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(paused)) throw new Error('Candidate Rules changed: review the pause generator before continuing');
    paused = paused.replace(pattern, replacement);
  }
  return paused.replace('// Local stage-2 candidate. Never deploy without the staged v2 rollout.', '// Hard registration pause. Read access and owner personal settings remain available.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = readFileSync(new URL('../firestore.strict.rules', import.meta.url), 'utf8');
  writeFileSync(new URL('../firestore.identity-paused.rules', import.meta.url), pausedIdentityRules(source));
}
