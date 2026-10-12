import test from 'node:test';
import assert from 'node:assert/strict';
import { dictionaries, detectLanguage, formatDate, formatYen, getInitialLanguage, LANGUAGE_STORAGE_KEY, saveLanguagePreference, translate } from '../src/i18n.ts';
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
  for (const place of [...PREFECTURES, ...JAPAN_CITIES.map(({ city }) => city)]) {
    assert.notEqual(getLocalizedPlaceName(place, 'en'), place, `Missing English place translation for ${place}`);
  }
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
