import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSerialInput } from '../src/utils/serial.ts';

test('full-width lowercase serial input becomes uppercase ASCII', () => {
  assert.equal(normalizeSerialInput('ｔｅ１９５１０１ｃ'), 'TE195101C');
});

test('serial input removes whitespace and non-alphanumeric characters', () => {
  assert.equal(normalizeSerialInput('te 195101 c-!'), 'TE195101C');
});
