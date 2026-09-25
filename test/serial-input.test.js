import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSerialInput } from '../src/utils/serial.ts';
import { prepareSerialSearch } from '../src/utils/serialSearch.ts';

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
  });
});

test('search normalizes full-width lowercase input before document lookup', () => {
  assert.deepEqual(prepareSerialSearch('ｍ２６０７０６ｍ'), {
    rawInput: 'ｍ２６０７０６ｍ',
    serial: 'M260706M',
    documentId: 'M260706M',
  });
});
