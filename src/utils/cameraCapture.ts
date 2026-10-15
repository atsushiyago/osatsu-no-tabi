export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Default guide used before camera metadata is available. */
export const SERIAL_CAMERA_GUIDE: NormalizedCropRect = {
  x: 0.05,
  y: 0.45,
  width: 0.90,
  height: 0.10,
};

/** Match the live guide/crop aspect to the realtime OCR input (1400×214). */
export function getSerialCameraGuide(sourceWidth: number, sourceHeight: number): NormalizedCropRect {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
    throw new RangeError('Camera frame is not ready');
  }
  const width = 0.90;
  const height = width * (sourceWidth / sourceHeight) / (1400 / 214);
  if (height <= 0 || height >= 1) throw new RangeError('Camera aspect ratio is not supported');
  return { x: 0.05, y: (1 - height) / 2, width, height };
}

export interface PixelCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getPixelCropRect(
  sourceWidth: number,
  sourceHeight: number,
  guide: NormalizedCropRect = SERIAL_CAMERA_GUIDE
): PixelCropRect {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
    throw new RangeError('Camera frame is not ready');
  }
  const values = [guide.x, guide.y, guide.width, guide.height];
  if (values.some((value) => !Number.isFinite(value)) || guide.x < 0 || guide.y < 0
    || guide.width <= 0 || guide.height <= 0 || guide.x + guide.width > 1 || guide.y + guide.height > 1) {
    throw new RangeError('Camera guide is outside the frame');
  }

  const x = Math.round(sourceWidth * guide.x);
  const y = Math.round(sourceHeight * guide.y);
  const right = Math.min(sourceWidth, Math.round(sourceWidth * (guide.x + guide.width)));
  const bottom = Math.min(sourceHeight, Math.round(sourceHeight * (guide.y + guide.height)));
  return { x, y, width: right - x, height: bottom - y };
}

/** Centered object-fit: contain geometry, also used for undistorted OCR padding. */
export function getContainedImageRect(sourceWidth: number, sourceHeight: number, displayWidth: number, displayHeight: number): PixelCropRect {
  if ([sourceWidth, sourceHeight, displayWidth, displayHeight].some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError('Camera dimensions are not ready');
  }
  const scale = Math.min(displayWidth / sourceWidth, displayHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (displayWidth - width) / 2, y: (displayHeight - height) / 2, width, height };
}

/** Convert a measured guide relative to the video element into source pixels.
 * CSS must use centered contain with no additional transforms or digital zoom.
 * Camera hardware zoom is already reflected in the video frames.
 */
export function getSourceCropFromDisplay(sourceWidth: number, sourceHeight: number, displayWidth: number, displayHeight: number, guide: PixelCropRect): PixelCropRect {
  const image = getContainedImageRect(sourceWidth, sourceHeight, displayWidth, displayHeight);
  const epsilon = 0.1; // Fractional CSS pixel rounding at layout boundaries.
  if ([guide.x, guide.y, guide.width, guide.height].some((value) => !Number.isFinite(value))
    || guide.width <= 0 || guide.height <= 0 || guide.x < image.x - epsilon || guide.y < image.y - epsilon
    || guide.x + guide.width > image.x + image.width + epsilon || guide.y + guide.height > image.y + image.height + epsilon) {
    throw new RangeError('Camera guide is outside the rendered image');
  }
  return getPixelCropRect(sourceWidth, sourceHeight, {
    x: Math.max(0, (guide.x - image.x) / image.width),
    y: Math.max(0, (guide.y - image.y) / image.height),
    width: Math.min(guide.width / image.width, 1 - Math.max(0, (guide.x - image.x) / image.width)),
    height: Math.min(guide.height / image.height, 1 - Math.max(0, (guide.y - image.y) / image.height)),
  });
}

/** Screen guide is positioned inside the actual contained video, excluding bars. */
export function getDisplayedSerialGuide(sourceWidth: number, sourceHeight: number, displayWidth: number, displayHeight: number): PixelCropRect {
  const image = getContainedImageRect(sourceWidth, sourceHeight, displayWidth, displayHeight);
  const guide = getSerialCameraGuide(sourceWidth, sourceHeight);
  return { x: image.x + image.width * guide.x, y: image.y + image.height * guide.y,
    width: image.width * guide.width, height: image.height * guide.height };
}
