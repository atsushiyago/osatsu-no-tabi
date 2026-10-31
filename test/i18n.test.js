import test from 'node:test';
import assert from 'node:assert/strict';
import { dictionaries, detectLanguage, formatGoogleMergeConfirmation, formatDate, formatYen, getInitialLanguage, LANGUAGE_STORAGE_KEY, saveLanguagePreference, translate } from '../src/i18n.ts';
import { JAPAN_CITIES, PREFECTURES, getLocalizedLocationLabel, getLocalizedPlaceName } from '../src/utils/geo.ts';
import { validateSerialNumber } from '../src/utils/serial.ts';
import { getGoogleSyncErrorMessage } from '../src/services/googleAccountSync.js';

test('Japanese and English dictionaries have matching translation keys', () => {
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.ja).sort());
  for (const value of Object.values(dictionaries.en)) assert.equal(typeof value, 'string');
});

test('browser language selects Japanese only for Japanese locales', () => {
  assert.equal(detectLanguage('ja'), 'ja');
  assert.equal(detectLanguage('ja-JP'), 'ja');
  assert.equal(detectLanguage('en-US'), 'en');
  assert.equal(detectLanguage(null), 'en');
});

test('stored language preference takes precedence and can be persisted', () => {
  assert.equal(getInitialLanguage('ja', 'en-US'), 'ja');
  assert.equal(getInitialLanguage('en', 'ja-JP'), 'en');
  assert.equal(getInitialLanguage(null, 'ja-JP'), 'ja');
  const stored = new Map();
  saveLanguagePreference({ setItem: (key, value) => stored.set(key, value) }, 'en');
  assert.equal(stored.get(LANGUAGE_STORAGE_KEY), 'en');
});

test('English place labels do not change Japanese geo lookup keys', () => {
  assert.equal(PREFECTURES.length, 47);
  for (const place of [...PREFECTURES, '札幌市', '千代田区', '横浜市', '箱根町']) {
    assert.notEqual(getLocalizedPlaceName(place, 'en'), place, `Missing English place translation for ${place}`);
  }
  assert.equal(getLocalizedPlaceName('札幌市 中央区', 'en'), '札幌市 中央区');
  assert.equal(getLocalizedPlaceName('未知の自治体', 'en'), '未知の自治体');
  assert.equal(JAPAN_CITIES[0].pref, '北海道');
  assert.equal(JAPAN_CITIES[0].city, '札幌市');
  assert.equal(getLocalizedLocationLabel('東京都', '千代田区', 'ja'), '東京都 千代田区');
  assert.equal(getLocalizedLocationLabel('東京都', '千代田区', 'en'), 'Chiyoda, Tokyo');
  assert.equal(getLocalizedLocationLabel('京都府', '京都市', 'en'), 'Kyoto City, Kyoto');
});

test('English sample journeys display translated municipality names', () => {
  for (const municipality of ['弘前市', '会津若松市']) {
    assert.notEqual(getLocalizedPlaceName(municipality, 'en'), municipality, `Missing sample place translation for ${municipality}`);
  }
});

test('date and yen formatters use the selected locale', () => {
  assert.match(formatYen('ja', 10000), /10,000/);
  assert.match(formatYen('en', 10000), /10,000/);
  assert.notEqual(formatDate('ja', '2024-01-02', { year: 'numeric', month: 'long', day: 'numeric' }), formatDate('en', '2024-01-02', { year: 'numeric', month: 'long', day: 'numeric' }));
  assert.equal(translate('en', 'historyTitle', { count: 3 }), 'Discovery history (3 locations)');
  assert.match(validateSerialNumber('', 'en').message, /Enter a serial number/);
  assert.match(validateSerialNumber('', 'ja').message, /記番号を入力/);
  assert.match(validateSerialNumber('AI123456BB', 'en').message, /letters I and O/);
});

test('Google authentication errors are translated in the active language', () => {
  assert.match(getGoogleSyncErrorMessage({ code: 'auth/popup-blocked' }, 'ja'), /ポップアップ/);
  assert.match(getGoogleSyncErrorMessage({ code: 'auth/popup-blocked' }, 'en'), /pop-ups/);
  assert.equal(getGoogleSyncErrorMessage({ code: 'auth/popup-closed-by-user' }, 'en'), null);
});


test('OCR camera review actions are localized in Japanese and English', () => {
  for (const language of ['ja', 'en']) {
    assert.ok(translate(language, 'ocrCameraButton').length > 0);
    assert.ok(translate(language, 'orEnterManually').length > 0);
    assert.ok(translate(language, 'ocrCameraReviewTitle').length > 0);
    assert.ok(translate(language, 'ocrCameraUseCandidate').length > 0);
    assert.ok(translate(language, 'ocrCameraRescan').length > 0);
    assert.ok(translate(language, 'ocrCameraManualEntry').length > 0);
    assert.ok(translate(language, 'ocrCameraPrivacy').length > 0);
    assert.ok(translate(language, 'ocrCameraGuide').length > 0);
  }
});

test('serial confirmation copy distinguishes input confirmation from final registration', () => {
  assert.match(translate('ja', 'identityConfirmHelp'), /お札の登録は.*最後の登録ボタン/);
  assert.match(translate('en', 'identityConfirmHelp'), /serial number only.*not registered until.*final registration button/i);
});


test('Google merge confirmation is concise and omits zero-count breakdowns in both languages', () => {
  const counts = { copyCount: 1, duplicateCount: 0, alreadyCopiedCount: 0 };
  assert.equal(formatGoogleMergeConfirmation('ja', counts), [
    '登録したお札の情報をGoogleアカウントにコピーします。元の情報もそのまま残ります。',
    '新たにコピーするお札：1枚',
    '続行しますか？',
  ].join('\n\n'));
  assert.equal(formatGoogleMergeConfirmation('en', counts), [
    'Your banknote information will be copied to your Google Account. The original information will remain.',
    'Banknotes to copy: 1',
    'Continue?',
  ].join('\n\n'));
  assert.deepEqual(counts, { copyCount: 1, duplicateCount: 0, alreadyCopiedCount: 0 });
});

test('Google merge confirmation preserves nonzero duplicate and resume information', () => {
  for (const language of ['ja', 'en']) {
    const message = formatGoogleMergeConfirmation(language, { copyCount: 12, duplicateCount: 2, alreadyCopiedCount: 3 });
    for (const [key, count] of [['mergeConfirmCopyCount', 12], ['mergeConfirmDuplicateCount', 2], ['mergeConfirmAlreadyCopiedCount', 3]]) {
      assert.ok(message.includes(translate(language, key, { count })));
    }
    assert.ok(!message.includes('一時的'));
    assert.ok(!message.includes('paused'));
    const duplicatesOnly = formatGoogleMergeConfirmation(language, { copyCount: 0, duplicateCount: 2, alreadyCopiedCount: 0 });
    assert.ok(!duplicatesOnly.includes(translate(language, 'mergeConfirmCopyCount', { count: 0 })));
    assert.ok(!duplicatesOnly.includes(translate(language, 'mergeConfirmAlreadyCopiedCount', { count: 0 })));
    assert.ok(duplicatesOnly.includes(translate(language, 'mergeConfirmDuplicateCount', { count: 2 })));
    const resumed = formatGoogleMergeConfirmation(language, { copyCount: 0, duplicateCount: 0, alreadyCopiedCount: 4 });
    assert.ok(resumed.includes(translate(language, 'mergeConfirmAlreadyCopiedCount', { count: 4 })));
    assert.ok(!resumed.includes(translate(language, 'mergeConfirmDuplicateCount', { count: 0 })));
  }
});
