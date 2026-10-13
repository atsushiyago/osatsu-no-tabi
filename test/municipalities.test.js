import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_LOCATION_SELECTION,
  JAPAN_CITIES,
  PREFECTURES,
  getCitiesByPrefecture,
  getLocalizedPlaceName,
  isMunicipalitySelectionValid,
  selectPrefecture,
} from '../src/utils/geo.ts';
import { JAPAN_MUNICIPALITY_ROWS } from '../src/data/japanMunicipalities.ts';
import { translate } from '../src/i18n.ts';

test('bundled municipality data covers every prefecture, municipality, and designated-city ward', () => {
  assert.equal(PREFECTURES.length, 47);
  assert.equal(JAPAN_CITIES.length, 1916);
  assert.equal(JAPAN_MUNICIPALITY_ROWS.length, 1916);
  assert.equal(new Set(JAPAN_MUNICIPALITY_ROWS.map((row) => row[4])).size, 1916);
  assert.ok(JAPAN_CITIES.every(({ lat, lng, city, pref }) => Number.isFinite(lat) && Number.isFinite(lng) && city && pref));

  const kanagawa = getCitiesByPrefecture('神奈川県');
  assert.equal(kanagawa.length, 61);
  assert.equal(kanagawa.filter(({ city }) => !city.includes(' ')).length, 33);
  assert.equal(kanagawa.filter(({ city }) => city.includes(' ')).length, 28);
  assert.ok(kanagawa.some(({ city }) => city === '横浜市 中区'));
  assert.ok(kanagawa.some(({ city }) => city === '清川村'));

  const tokyo = getCitiesByPrefecture('東京都');
  assert.equal(tokyo.filter(({ city }) => city.endsWith('区') && !city.includes(' ')).length, 23);
  assert.ok(getCitiesByPrefecture('北海道').some(({ city }) => city === '稚内市'));
  assert.ok(getCitiesByPrefecture('沖縄県').some(({ city }) => city === '与那国町'));
});

test('prefecture filtering changes candidates without selecting a municipality', () => {
  assert.ok(getCitiesByPrefecture('神奈川県').some(({ city }) => city === '横浜市'));
  assert.ok(getCitiesByPrefecture('神奈川県').some(({ city }) => city === '横浜市 中区'));
  assert.equal(getCitiesByPrefecture('東京都').some(({ city }) => city === '横浜市'), false);
  assert.deepEqual(selectPrefecture('神奈川県'), { prefecture: '神奈川県', municipality: '' });
});

test('registration starts without a location and cannot silently register as Yokohama', () => {
  assert.deepEqual(EMPTY_LOCATION_SELECTION, { prefecture: '', municipality: '' });
  assert.equal(isMunicipalitySelectionValid(EMPTY_LOCATION_SELECTION.prefecture, EMPTY_LOCATION_SELECTION.municipality), false);
  assert.equal(isMunicipalitySelectionValid('神奈川県', ''), false);
  assert.equal(isMunicipalitySelectionValid('神奈川県', '横浜市'), true);
  assert.equal(isMunicipalitySelectionValid('東京都', '横浜市'), false);
  assert.match(translate('ja', 'locationRequired'), /都道府県と市区町村を選択/);
  assert.match(translate('en', 'locationRequired'), /Select a prefecture and municipality/);
});

test('English display falls back to Japanese where no verified label exists', () => {
  assert.equal(getLocalizedPlaceName('神奈川県', 'en'), 'Kanagawa');
  assert.equal(getLocalizedPlaceName('横浜市', 'en'), 'Yokohama');
  assert.equal(getLocalizedPlaceName('横浜市 中区', 'en'), '横浜市 中区');
  assert.equal(getLocalizedPlaceName('横浜市 中区', 'ja'), '横浜市 中区');
});
