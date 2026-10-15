import test from 'node:test';
import assert from 'node:assert/strict';
import { getModalViewportHeight } from '../src/utils/modalViewport.ts';

test('modal follows visible viewport height changes without adding visual viewport offset', () => {
  assert.equal(getModalViewportHeight(640, 800), 640);
  assert.equal(getModalViewportHeight(360, 800), 360);
});

test('modal falls back to the dynamic window height when visual viewport is unavailable', () => {
  assert.equal(getModalViewportHeight(null, 720), 720);
  assert.equal(getModalViewportHeight(undefined, 0), undefined);
});

test('invalid visual viewport measurements do not replace a usable fallback', () => {
  assert.equal(getModalViewportHeight(Number.NaN, 700), 700);
  assert.equal(getModalViewportHeight(0, 700), 700);
});
