import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANKNOTE_VARIANTS, BANKNOTE_VARIANT_LABELS, getAllowedSerialColors,
  isAllowedBanknoteVariant,
} from '../src/data/banknoteVariants.ts';
import {
  createBillIdentityKey, getBillSeriesCandidates, isValidBillIdentityKey,
  parseBillIdentityKey, validateBillIdentity,
} from '../src/utils/billIdentity.ts';
import { normalizeSerialNumber, validateSerialNumber } from '../src/utils/serial.ts';

// Independent expected matrix from the NPB catalog, not from production data.
const expected = [
  ['D', 1000, ['black', 'blue', 'brown', 'darkgreen']],
  ['D', 2000, ['black']],
  ['D', 5000, ['black', 'brown']],
  ['D', 10000, ['black', 'brown']],
  ['E', 1000, ['black', 'brown', 'navy']],
  ['E', 5000, ['black', 'brown']],
  ['E', 10000, ['black', 'brown']],
  ['F', 1000, ['black']],
  ['F', 5000, ['black']],
  ['F', 10000, ['black']],
];
const fixture = { denomination: 1000, series: 'E', serialColor: 'brown', serialNumber: 'AA123456B' };
const canonicalKey = 'v2_JPY_1000_E_brown_AA123456B';
const variantCode = ({ denomination, series, serialColor }) => `${denomination}/${series}/${serialColor}`;
const expectedVariants = expected.flatMap(([series, denomination, colors]) =>
  colors.map((serialColor) => ({ denomination, series, serialColor })),
);

test('NPB catalog contains exactly the 19 distinct supported variants', () => {
  assert.equal(BANKNOTE_VARIANTS.length, 19);
  assert.deepEqual(BANKNOTE_VARIANTS.map(variantCode).sort(), expectedVariants.map(variantCode).sort());
  assert.equal(new Set(BANKNOTE_VARIANTS.map(variantCode)).size, 19);
});

for (const variant of expectedVariants) {
  test(`validates and round-trips ${variantCode(variant)}`, () => {
    const identity = { ...variant, serialNumber: variant.series === 'F' ? 'AA123456BB' : 'AA123456B' };
    assert.deepEqual(validateBillIdentity(identity), { isValid: true, identity });
    const key = createBillIdentityKey(identity);
    assert.equal(key, `v2_JPY_${variant.denomination}_${variant.series}_${variant.serialColor}_${identity.serialNumber}`);
    assert.equal(isValidBillIdentityKey(key), true);
    assert.deepEqual(parseBillIdentityKey(key), identity);
  });
}

test('rejects all unsupported series/denomination/color combinations', () => {
  const allowed = new Set(expectedVariants.map(variantCode));
  for (const series of ['D', 'E', 'F']) {
    for (const denomination of [1000, 2000, 5000, 10000]) {
      for (const serialColor of ['black', 'brown', 'blue', 'darkgreen', 'navy']) {
        const variant = { series, denomination, serialColor };
        const valid = allowed.has(variantCode(variant));
        assert.equal(isAllowedBanknoteVariant(denomination, series, serialColor), valid);
        if (!valid) {
          const input = { ...variant, serialNumber: series === 'F' ? 'AA123456BB' : 'AA123456B' };
          assert.deepEqual(validateBillIdentity(input), { isValid: false, code: 'unsupported-variant' });
          assert.throws(() => createBillIdentityKey(input), TypeError);
        }
      }
    }
  }
});

test('allowed color selection includes only real variants and cannot mutate the catalog', () => {
  assert.deepEqual(getAllowedSerialColors('D', 2000), ['black']);
  assert.deepEqual(getAllowedSerialColors('E', 5000), ['black', 'brown']);
  assert.deepEqual(getAllowedSerialColors('F', 2000), []);
  assert.deepEqual(getAllowedSerialColors('unknown', 1000), []);
  assert.deepEqual(getAllowedSerialColors('D', '2000'), []);
  getAllowedSerialColors('D', 2000).push('navy');
  assert.deepEqual(getAllowedSerialColors('D', 2000), ['black']);
  assert.throws(() => { BANKNOTE_VARIANTS[0].series = 'F'; }, TypeError);
});

test('normalization gives the same key without mutating the caller input', () => {
  const input = { ...fixture, serialNumber: ' ａａ-１２３４５６ ｂ　' };
  const original = structuredClone(input);
  assert.equal(createBillIdentityKey(input), canonicalKey);
  assert.deepEqual(input, original);
  assert.equal(createBillIdentityKey({ ...fixture }), canonicalKey);
  assert.equal(validateSerialNumber(normalizeSerialNumber(input.serialNumber)).isValid, true);
});

test('each of the four identity components independently distinguishes keys', () => {
  const identities = [
    fixture,
    { ...fixture, denomination: 5000 },
    { ...fixture, series: 'D' },
    { ...fixture, serialColor: 'black' },
    { ...fixture, serialNumber: 'AA123457B' },
  ];
  assert.equal(new Set(identities.map(createBillIdentityKey)).size, identities.length);
  assert.equal(new Set(expectedVariants.map((variant) => createBillIdentityKey({
    ...variant, serialNumber: variant.series === 'F' ? 'AA123456BB' : 'AA123456B',
  }))).size, 19);
});

test('unknown, missing or localized codes never acquire defaults', () => {
  for (const series of [undefined, null, '', 'unknown', 'C', 'e', 'E券', 'Series E', 1]) {
    assert.deepEqual(validateBillIdentity({ ...fixture, series }), { isValid: false, code: 'unknown-series' });
  }
  for (const serialColor of [undefined, null, '', 'unknown', '紺色', 'Brown', 'navy_blue', 1]) {
    assert.deepEqual(validateBillIdentity({ ...fixture, serialColor }), { isValid: false, code: 'unknown-color' });
    assert.throws(() => createBillIdentityKey({ ...fixture, serialColor }), TypeError);
  }
  for (const denomination of [undefined, null, 500, 1001, '1000', NaN, Infinity]) {
    assert.deepEqual(validateBillIdentity({ ...fixture, denomination }), { isValid: false, code: 'unknown-denomination' });
  }
  for (const input of [null, undefined, 'identity', 1000, []]) {
    assert.deepEqual(validateBillIdentity(input), { isValid: false, code: 'invalid-input' });
  }
});

test('invalid serials are rejected instead of repaired by dropping punctuation', () => {
  for (const serialNumber of [
    '', 'A', '123456', 'A123456BB', 'AAA123456B', 'AA000000B', 'AA900001B',
    'AI123456B', 'AO123456B', 'AA123456I', 'AA123456O', 'AA123456B!',
    'AA123456B/other', 'AA123456\u200bB', undefined, null, 123456,
  ]) {
    assert.deepEqual(validateBillIdentity({ ...fixture, serialNumber }), { isValid: false, code: 'invalid-serial' });
    assert.throws(() => createBillIdentityKey({ ...fixture, serialNumber }), TypeError);
  }
});

test('old/new serial formats and numeric boundaries remain compatible with existing validation', () => {
  for (const serialNumber of ['A000001B', 'AA900000B']) {
    assert.equal(validateSerialNumber(serialNumber).isValid, true);
    for (const series of ['D', 'E']) {
      assert.equal(validateBillIdentity({ ...fixture, series, serialNumber }).isValid, true);
    }
  }
  for (const serialNumber of ['AA000001BB', 'AA900000BB']) {
    assert.equal(validateSerialNumber(serialNumber).isValid, true);
    assert.equal(validateBillIdentity({ ...fixture, series: 'F', serialColor: 'black', serialNumber }).isValid, true);
  }
  assert.deepEqual(validateBillIdentity({ ...fixture, serialNumber: 'AA123456BB' }), {
    isValid: false, code: 'serial-series-mismatch',
  });
  assert.deepEqual(validateBillIdentity({ ...fixture, series: 'F', serialColor: 'black' }), {
    isValid: false, code: 'serial-series-mismatch',
  });
});

test('series candidates preserve D/E ambiguity and do not supply missing identity fields', () => {
  assert.deepEqual(getBillSeriesCandidates('ＡＡ１２３４５６Ｂ'), ['D', 'E']);
  assert.deepEqual(getBillSeriesCandidates('A123456B', 1000), ['D', 'E']);
  assert.deepEqual(getBillSeriesCandidates('A123456B', 2000), ['D']);
  assert.deepEqual(getBillSeriesCandidates('AA123456BB'), ['F']);
  assert.deepEqual(getBillSeriesCandidates('AA123456BB', 2000), []);
  assert.deepEqual(getBillSeriesCandidates('invalid'), []);
  assert.deepEqual(getBillSeriesCandidates(null), []);
  assert.deepEqual(getBillSeriesCandidates('AA123456B', null), []);
  assert.equal(validateBillIdentity({ denomination: 1000, serialNumber: 'AA123456BB' }).isValid, false);
});

test('parser rejects malformed, unsupported and noncanonical keys', () => {
  for (const key of [
    null, undefined, 123, '', 'v1_JPY_1000_E_brown_AA123456B',
    'v2_USD_1000_E_brown_AA123456B', 'v2_JPY_01000_E_brown_AA123456B',
    'v2_JPY_2000_E_black_AA123456B', 'v2_JPY_2000_F_black_AA123456BB',
    'v2_JPY_5000_E_navy_AA123456B', 'v2_JPY_1000_E_unknown_AA123456B',
    'v2_JPY_1000_X_brown_AA123456B', 'v2_JPY_1000_E_brown_AA123456BB',
    'v2_JPY_1000_E_brown_AA000000B', 'v2_JPY_1000_E_brown_AA900001B',
    'v2_JPY_1000_E_brown_aa123456b', 'v2_JPY_1000_E_brown_AA-123456-B',
    `${canonicalKey}\n`, `${canonicalKey}_extra`, ` ${canonicalKey}`,
  ]) {
    assert.equal(parseBillIdentityKey(key), null, String(key));
    assert.equal(isValidBillIdentityKey(key), false, String(key));
  }
});

test('Japanese/English labels cover identical internal codes without changing identity', () => {
  for (const group of ['series', 'colors', 'denominations']) {
    assert.deepEqual(Object.keys(BANKNOTE_VARIANT_LABELS.ja[group]).sort(),
      Object.keys(BANKNOTE_VARIANT_LABELS.en[group]).sort());
    for (const language of ['ja', 'en']) {
      for (const label of Object.values(BANKNOTE_VARIANT_LABELS[language][group])) {
        assert.equal(typeof label, 'string');
        assert.notEqual(label, '');
      }
    }
  }
  for (const { denomination, series, serialColor } of expectedVariants) {
    for (const language of ['ja', 'en']) {
      const labels = BANKNOTE_VARIANT_LABELS[language];
      assert.ok(labels.denominations[denomination]);
      assert.ok(labels.series[series]);
      assert.ok(labels.colors[serialColor]);
    }
  }
  assert.equal(BANKNOTE_VARIANT_LABELS.en.colors.navy, 'Navy blue');
  assert.equal(BANKNOTE_VARIANT_LABELS.ja.denominations[2000], '二千円札');
  assert.equal(createBillIdentityKey(fixture), canonicalKey);
});
