import test from 'node:test';
import assert from 'node:assert/strict';
import { getContainedImageRect, getDisplayedSerialGuide, getSourceCropFromDisplay, getPixelCropRect, getSerialCameraGuide, SERIAL_CAMERA_GUIDE } from '../src/utils/cameraCapture.ts';

test('camera OCR crop uses only the centered serial guide region', () => {
  assert.deepEqual(getPixelCropRect(1920, 1080), {
    x: 96, y: 486, width: 1728, height: 108,
  });
  assert.equal(SERIAL_CAMERA_GUIDE.width / SERIAL_CAMERA_GUIDE.height, 9);
  assert.deepEqual(getPixelCropRect(720, 1280), { x: 36, y: 576, width: 648, height: 128 });
});

test('live camera guide uses the same 1400:214 aspect as the OCR crop on portrait and landscape sensors', () => {
  for (const [width, height] of [[720, 1280], [1920, 1080]]) {
    const guide = getSerialCameraGuide(width, height);
    const crop = getPixelCropRect(width, height, guide);
    assert.ok(Math.abs(crop.width / crop.height - 1400 / 214) < 0.08);
    assert.ok(Math.abs(guide.y + guide.height / 2 - 0.5) < 1e-9);
  }
});

test('camera crop rejects unavailable frames and guides outside the image', () => {
  assert.throws(() => getPixelCropRect(0, 1080), /not ready/);
  assert.throws(() => getPixelCropRect(1920, 1080, { x: 0.8, y: 0.5, width: 0.3, height: 0.2 }), /outside/);
});


test('contain preserves sensor aspect with horizontal and vertical letterboxing', () => {
  assert.deepEqual(getContainedImageRect(1920, 1080, 320, 400), { x: 0, y: 110, width: 320, height: 180 });
  assert.deepEqual(getContainedImageRect(1080, 1920, 400, 320), { x: 110, y: 0, width: 180, height: 320 });
});

test('measured guide maps to the same source pixels at mobile widths and after rotation', () => {
  for (const [sourceWidth, sourceHeight] of [[1920, 1080], [1080, 1920], [1280, 720]]) {
    for (const [displayWidth, displayHeight] of [[320, 420], [375, 360], [390, 400], [430, 400], [620, 280], [280, 620]]) {
      const overlay = getDisplayedSerialGuide(sourceWidth, sourceHeight, displayWidth, displayHeight);
      const expected = getPixelCropRect(sourceWidth, sourceHeight, getSerialCameraGuide(sourceWidth, sourceHeight));
      const actual = getSourceCropFromDisplay(sourceWidth, sourceHeight, displayWidth, displayHeight, overlay);
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) <= 1, key);
    }
  }
});

test('display coordinates exclude letterbox bars and reject guides outside real image', () => {
  assert.deepEqual(getSourceCropFromDisplay(1920, 1080, 320, 400, { x: 80, y: 155, width: 160, height: 90 }),
    { x: 480, y: 270, width: 960, height: 540 });
  assert.throws(() => getSourceCropFromDisplay(1920, 1080, 320, 400, { x: 0, y: 0, width: 160, height: 90 }), /outside/);
  assert.throws(() => getContainedImageRect(0, 1080, 320, 400), /not ready/);
});

test('1400x214 OCR letterboxes every crop with equal horizontal and vertical scale', () => {
  for (const [width, height] of [[950, 268], [1728, 264], [648, 99]]) {
    const fit = getContainedImageRect(width, height, 1400, 214);
    assert.ok(Math.abs(fit.width / width - fit.height / height) < 1e-9);
    assert.ok(fit.x >= 0 && fit.y >= 0);
    assert.ok(fit.width <= 1400 && fit.height <= 214);
  }
});
