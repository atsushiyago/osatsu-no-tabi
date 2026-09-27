import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSerialInput, validateSerialNumber } from '../src/utils/serial.ts';
import { prepareSerialSearch, runValidatedSerialSearch } from '../src/utils/serialSearch.ts';
import {
  createSerialInputState,
  endSerialComposition,
  getSerialInputValidation,
  startSerialComposition,
  updateSerialInput,
} from '../src/utils/serialInputState.ts';

test('full-width lowercase serial input becomes uppercase ASCII', () => {
  assert.equal(normalizeSerialInput('ｔｅ１９５１０１ｃ'), 'TE195101C');
});

test('日本銀行券の従来券・新紙幣形式と数字範囲を検証する', () => {
  const valid = ['A123456B', 'AA123456B', 'AA123456BB', 'CD777777EF', 'AA000001AA', 'AA900000BB'];
  const invalid = [
    'A123456BB', 'A000000B', 'AA000000BB', 'AA900001BB', 'AI123456BB',
    'AO123456BB', 'AA123456BI', 'AA123456BO', '123456', 'AA123456',
  ];

  for (const serial of valid) assert.equal(validateSerialNumber(serial).isValid, true, serial);
  for (const serial of invalid) assert.equal(validateSerialNumber(serial).isValid, false, serial);
  assert.match(validateSerialNumber('AI123456BB').message ?? '', /I（アイ）と O（オー）は使われません/);
});

test('lowercase/full-width input normalizes before validating the official format', () => {
  assert.equal(validateSerialNumber(normalizeSerialInput('ａａ９０００００ｂｂ')).isValid, true);
});

test('serial input removes whitespace and non-alphanumeric characters', () => {
  assert.equal(normalizeSerialInput('te 195101 c-!'), 'TE195101C');
});

test('search uses the latest raw form value as the normalized serial and exact bill document ID', () => {
  assert.deepEqual(prepareSerialSearch('M260706M'), {
    rawInput: 'M260706M',
    serial: 'M260706M',
    documentId: 'M260706M',
    isValid: true,
    validationMessage: undefined,
  });
});

test('search normalizes full-width lowercase input before document lookup', () => {
  assert.deepEqual(prepareSerialSearch('ｍ２６０７０６ｍ'), {
    rawInput: 'ｍ２６０７０６ｍ',
    serial: 'M260706M',
    documentId: 'M260706M',
    isValid: true,
    validationMessage: undefined,
  });
});

test('search validation rejects a serial that ends in a digit', () => {
  const result = prepareSerialSearch('M2607067');
  assert.equal(result.serial, 'M2607067');
  assert.equal(result.isValid, false);
  assert.equal(result.validationMessage, '記番号の形式を確認してください。');
});

test('generic serial format errors omit examples while I/O errors stay specific', () => {
  assert.equal(validateSerialNumber('A').message, '記番号の形式を確認してください。');
  assert.equal(validateSerialNumber('AI123456BB').message, '記番号の英字には I（アイ）と O（オー）は使われません');
});

test('search validates after NFKC normalization', () => {
  const result = prepareSerialSearch('ｍ２６０７０６ｍ');
  assert.equal(result.isValid, true);
});

test('invalid search input never calls the Firestore lookup', async (t) => {
  const inputs = [
    ['single letter', 'A'],
    ['digits only', '123'],
    ['clearly too short', 'AB12'],
    ['invalid final character', 'M2607061'],
    ['old prefix with two suffix letters', 'A123456BB'],
    ['zero numeric range', 'AA000000BB'],
    ['excluded letter I', 'AI123456BB'],
    ['numeric range above maximum', 'AA900001BB'],
  ];

  for (const [label, input] of inputs) {
    await t.test(label, async () => {
      let calls = 0;
      const result = await runValidatedSerialSearch(input, async () => {
        calls += 1;
        return { id: 'unexpected' };
      });

      assert.equal(result.status, 'invalid');
      assert.equal(calls, 0);
    });
  }
});

test('valid serial calls the Firestore lookup once with the exact document ID', async () => {
  const calls = [];
  const result = await runValidatedSerialSearch('ｍ２６０７０６ｍ', async (documentId) => {
    calls.push(documentId);
    return { id: documentId };
  });

  assert.equal(result.status, 'valid');
  assert.deepEqual(calls, ['M260706M']);
  assert.deepEqual(result.result, { id: 'M260706M' });
});

test('shared registration and search input validation reports errors as each invalid value is entered', () => {
  for (const value of ['A', '123', 'AB12', 'M2607061']) {
    const state = updateSerialInput(createSerialInputState(), value);
    assert.equal(getSerialInputValidation(state)?.isValid, false, value);
    assert.ok(getSerialInputValidation(state)?.message, value);
  }
});

test('shared live validation clears as soon as the serial is corrected', () => {
  const invalidState = updateSerialInput(createSerialInputState(), 'M2607061');
  assert.equal(getSerialInputValidation(invalidState)?.isValid, false);

  const correctedState = updateSerialInput(invalidState, 'M260706M');
  assert.equal(getSerialInputValidation(correctedState)?.isValid, true);
});

test('full-width lowercase input is normalized before live validation', () => {
  const state = updateSerialInput(createSerialInputState(), 'ｍ２６０７０６ｍ');
  assert.equal(state.value, 'M260706M');
  assert.equal(getSerialInputValidation(state)?.isValid, true);
});

test('IME composition defers validation until composition ends', () => {
  const composing = startSerialComposition(createSerialInputState());
  const intermediate = updateSerialInput(composing, 'Ａ');
  assert.equal(intermediate.value, 'Ａ');
  assert.equal(getSerialInputValidation(intermediate), null);

  const completed = endSerialComposition('ｍ２６０７０６ｍ');
  assert.equal(completed.value, 'M260706M');
  assert.equal(getSerialInputValidation(completed)?.isValid, true);
});
