import test from 'node:test';
import assert from 'node:assert/strict';
import { changeIdentityDesign, selectionIdentity } from '../src/utils/billIdentitySelection.ts';
import { identitySearchKeys, readIdentityCandidates, createRequestVersion } from '../src/utils/identitySearch.ts';
import { identityEmulatorEnabled, identityV2Enabled, validIdentityConnection, validQaFirebaseEnvironment } from '../src/utils/identityEnvironment.ts';
import { translate } from '../src/i18n.ts';

test('D/E need explicit design and color; unknown values remain unresolved', () => {
  assert.deepEqual(changeIdentityDesign(1000, null), { denomination: 1000, series: null, serialColor: null });
  const selected = changeIdentityDesign(1000, 'E');
  assert.equal(selected.serialColor, null);
  assert.equal(selectionIdentity(selected, 'AA123456B').isValid, false);
  assert.equal(selectionIdentity({ ...selected, serialColor: 'brown' }, 'AA123456B').isValid, true);
  assert.equal(selectionIdentity({ ...selected, serialColor: null }, 'AA123456B').isValid, false);
});
test('F has automatic black only after design selection; D2000 is unambiguous', () => {
  assert.deepEqual(changeIdentityDesign(1000, 'F'), { denomination: 1000, series: 'F', serialColor: 'black' });
  assert.deepEqual(changeIdentityDesign(2000, null), { denomination: 2000, series: 'D', serialColor: 'black' });
  assert.equal(selectionIdentity(changeIdentityDesign(2000, null), 'AA123456B').isValid, true);
  assert.equal(selectionIdentity(changeIdentityDesign(2000, null), 'AA123456BB').isValid, false);
});
test('changing design or denomination invalidates previous color', () => {
  assert.equal(changeIdentityDesign(5000, 'E').serialColor, null);
  assert.equal(changeIdentityDesign(1000, 'D').serialColor, null);
});
test('design and OCR/manual serial mismatches are rejected', () => {
  assert.equal(selectionIdentity(changeIdentityDesign(1000, 'F'), 'AA123456B').code, 'serial-series-mismatch');
  assert.equal(selectionIdentity({ denomination: 1000, series: 'E', serialColor: 'black' }, 'AA123456BB').code, 'serial-series-mismatch');
  assert.equal(selectionIdentity(changeIdentityDesign(1000, 'F'), 'ａａ１２３４５６ｂｂ').isValid, true);
});
test('serial-only search enumerates all and only valid composite identities', () => {
  assert.equal(identitySearchKeys('AA123456B').length, 16);
  assert.equal(identitySearchKeys('AA123456BB').length, 3);
  assert.equal(new Set(identitySearchKeys('AA123456B')).size, 16);
  assert.ok(identitySearchKeys('AA123456B').includes('v2_JPY_2000_D_black_AA123456B'));
  assert.deepEqual(identitySearchKeys('ａａ１２３４５６ｂ'), identitySearchKeys('AA123456B'));
  assert.throws(() => identitySearchKeys('invalid'));
});
test('search uses exact gets, includes old index, and preserves multiple candidates', async () => {
  const paths = [];
  const records = await readIdentityCandidates('AA123456B', async (path) => {
    paths.push(path);
    return path.includes('1000_D_black') ? 'D' : path.includes('1000_E_brown') ? 'E' : path.startsWith('serialIndex/') ? 'legacy' : null;
  });
  assert.deepEqual(records, ['D', 'E', 'legacy']);
  assert.equal(paths.length, 17);
  assert.ok(paths.includes('serialIndex/AA123456B'));
});
test('missing candidates are distinct from permission/network errors', async () => {
  assert.deepEqual(await readIdentityCandidates('AA123456BB', async () => null), []);
  for (const code of ['permission-denied', 'unavailable']) {
    await assert.rejects(readIdentityCandidates('AA123456B', async () => { throw Object.assign(new Error(code), { code }); }), { code });
  }
});
test('new requests, edits and unmount invalidate stale search results', () => {
  const requests = createRequestVersion();
  const first = requests.next(); assert.equal(requests.isCurrent(first), true);
  const second = requests.next(); assert.equal(requests.isCurrent(first), false); assert.equal(requests.isCurrent(second), true);
  requests.next(); assert.equal(requests.isCurrent(second), false);
});
test('Emulator is explicit opt-in only in development, never in a production build', () => {
  for (const flag of [undefined, null, '', 'false', true, 'TRUE']) assert.equal(identityEmulatorEnabled(true, flag), false);
  assert.equal(identityEmulatorEnabled(true, 'true'), true);
  assert.equal(identityEmulatorEnabled(false, 'true'), false);
});
test('Japanese and English identity messages exist without changing internal codes', () => {
  for (const language of ['ja', 'en']) {
    for (const key of ['identityLegacyText', 'identityIncomplete', 'identityMismatch', 'identitySearchDenied', 'identitySearchError', 'identityHold', 'identityAutomatic', 'trackedFollowingTitle', 'trackedFollowingDescription']) {
      assert.ok(translate(language, key).length > 5);
    }
  }
  assert.match(translate('ja', 'designD10000'), /キジ/);
  assert.match(translate('en', 'designE10000'), /phoenix/);
});

test('v2 feature and emulator transport are independent and default off', () => {
  assert.equal(identityV2Enabled(undefined), false);
  assert.equal(identityV2Enabled('true'), true);
  assert.equal(identityEmulatorEnabled(false, 'true'), false);
  assert.equal(validIdentityConnection(false, 'production-project', 'production-project'), true);
  assert.equal(validIdentityConnection(false, 'demo-osatsu-public-serial', 'demo-osatsu-public-serial'), false);
  assert.equal(validIdentityConnection(true, 'production-project', 'production-project', '127.0.0.1'), false);
  assert.equal(validIdentityConnection(false, 'production-project', 'other-project'), false);
  assert.equal(validIdentityConnection(true, 'demo-osatsu-public-serial', 'demo-osatsu-public-serial', '127.0.0.1'), true);
});

test('QA mode is pinned to QA project, real services, and v2', () => {
  assert.equal(validQaFirebaseEnvironment('qa', 'osatsu-no-tabi-qa', 'false', 'true'), true);
  assert.equal(validQaFirebaseEnvironment('qa', 'george-69c3a', 'false', 'true'), false);
  assert.equal(validQaFirebaseEnvironment('qa', 'osatsu-no-tabi-qa', 'true', 'true'), false);
  assert.equal(validQaFirebaseEnvironment('qa', 'osatsu-no-tabi-qa', 'false', 'false'), false);
  assert.equal(validQaFirebaseEnvironment('development', 'george-69c3a', 'false', 'false'), true);
});
