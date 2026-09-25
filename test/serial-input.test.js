import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSerialInput } from '../src/utils/serial.ts';
import { prepareSerialSearch, runValidatedSerialSearch } from '../src/utils/serialSearch.ts';

test('full-width lowercase serial input becomes uppercase ASCII', () => {
  assert.equal(normalizeSerialInput('ｔｅ１９５１０１ｃ'), 'TE195101C');
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
  assert.match(result.validationMessage ?? '', /記番号の形式が正しくありません/);
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
