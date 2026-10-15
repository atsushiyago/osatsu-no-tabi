import { getContainedImageRect } from './cameraCapture.ts';
import { normalizeSerialInput, validateSerialNumber } from './serial.ts';
import { isDebugTiming } from './debug.ts';

/** OCRで混同されやすい文字。候補生成時は期待される位置の文字種だけを使う。 */
export const OCR_CONFUSION_MAP = {
  letterToDigit: {
    O: ['0'], Q: ['0'], D: ['0'],
    I: ['1'], L: ['1'],
    Z: ['2'], S: ['5'], G: ['6'], T: ['7'], B: ['8'],
  },
  digitToLetter: {
    '0': ['O', 'Q'], '1': ['I', 'L'], '2': ['Z'], '5': ['S'],
    '6': ['G'], '7': ['T'], '8': ['B'],
  },
} as const;

const MAX_OCR_CORRECTIONS = 2;
/** OCR sees the full alphanumeric alphabet so positional correction can resolve I/O confusions. */
export const OCR_ALLOWED_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SERIAL_LAYOUTS = [
  { prefixLength: 1, suffixLength: 1 },
  { prefixLength: 2, suffixLength: 1 },
  { prefixLength: 1, suffixLength: 2 },
  { prefixLength: 2, suffixLength: 2 },
] as const;

export interface ValidOcrSerialCandidate {
  serial: string;
  correctionCount: number;
}

export interface OcrSerialCorrectionResult {
  rawText: string;
  normalizedText: string;
  generatedCandidateCount: number;
  validCandidates: ValidOcrSerialCandidate[];
  selectedCandidate: string | null;
  correctionCount: number | null;
  ambiguous: boolean;
  ambiguityReason?: 'multiple-valid-candidates' | 'possible-truncated-suffix';
  status: 'raw-valid' | 'corrected' | 'ambiguous' | 'no-valid-candidate';
}

/**
 * OCR文字列を既存の記番号入力と同じNFKC・大文字化・英数字正規化に通し、
 * validatorが受理する記番号構造に沿って最大2文字までの置換候補を作る。
 */
export function correctOcrSerial(rawText: string): OcrSerialCorrectionResult {
  const normalizedText = normalizeSerialInput(rawText);
  const rawValidation = validateSerialNumber(normalizedText);

  if (rawValidation.isValid) {
    return {
      rawText,
      normalizedText,
      generatedCandidateCount: 1,
      validCandidates: [{ serial: normalizedText, correctionCount: 0 }],
      selectedCandidate: normalizedText,
      correctionCount: 0,
      ambiguous: false,
      status: 'raw-valid',
    };
  }

  if (normalizedText.length < 8 || normalizedText.length > 10) {
    return {
      rawText,
      normalizedText,
      generatedCandidateCount: 0,
      validCandidates: [],
      selectedCandidate: null,
      correctionCount: null,
      ambiguous: false,
      status: 'no-valid-candidate',
    };
  }

  type GeneratedCandidate = ValidOcrSerialCandidate & {
    changedFinalCharacter: boolean;
    prefixLength: number;
    suffixLength: number;
  };
  const generated = new Set<string>();
  const valid = new Map<string, GeneratedCandidate>();

  for (const { prefixLength, suffixLength } of SERIAL_LAYOUTS) {
    if (normalizedText.length !== prefixLength + 6 + suffixLength) continue;

    const choices: string[][] = [];
    let layoutPossible = true;
    for (let index = 0; index < normalizedText.length; index++) {
      const char = normalizedText[index];
      const expectsLetter = index < prefixLength || index >= prefixLength + 6;
      const isLetter = char >= 'A' && char <= 'Z';
      const isDigit = char >= '0' && char <= '9';

      if (expectsLetter && isLetter || !expectsLetter && isDigit) {
        choices.push([char]);
      } else {
        const replacements = expectsLetter
          ? OCR_CONFUSION_MAP.digitToLetter[char as keyof typeof OCR_CONFUSION_MAP.digitToLetter]
          : OCR_CONFUSION_MAP.letterToDigit[char as keyof typeof OCR_CONFUSION_MAP.letterToDigit];
        if (!replacements?.length) {
          layoutPossible = false;
          break;
        }
        choices.push([...replacements]);
      }
    }
    if (!layoutPossible) continue;

    const characters: string[] = [];
    const visit = (index: number, correctionCount: number) => {
      if (correctionCount > MAX_OCR_CORRECTIONS) return;
      if (index === choices.length) {
        const serial = characters.join('');
        generated.add(serial);
        if (!validateSerialNumber(serial).isValid) return;
        const candidate: GeneratedCandidate = {
          serial,
          correctionCount,
          changedFinalCharacter: serial.at(-1) !== normalizedText.at(-1),
          prefixLength,
          suffixLength,
        };
        const existing = valid.get(serial);
        if (!existing || candidate.correctionCount < existing.correctionCount) valid.set(serial, candidate);
        return;
      }

      const original = normalizedText[index];
      for (const option of choices[index]) {
        characters.push(option);
        visit(index + 1, correctionCount + Number(option !== original));
        characters.pop();
      }
    };
    visit(0, 0);
  }

  const validCandidates = [...valid.values()]
    .sort((a, b) => a.correctionCount - b.correctionCount || a.serial.localeCompare(b.serial))
    .map(({ serial, correctionCount }) => ({ serial, correctionCount }));
  const fewestCorrections = validCandidates[0]?.correctionCount;
  const bestCandidates = validCandidates.filter((candidate) => candidate.correctionCount === fewestCorrections);
  const bestGenerated = [...valid.values()].filter((candidate) => candidate.correctionCount === fewestCorrections);
  const possibleTruncatedSuffix = bestGenerated.some((candidate) =>
    candidate.changedFinalCharacter && candidate.prefixLength === 2 && candidate.suffixLength === 1
  );
  const multipleBestCandidates = bestCandidates.length > 1;
  const ambiguous = multipleBestCandidates || possibleTruncatedSuffix;
  const selectedCandidate = !ambiguous && bestCandidates.length === 1 ? bestCandidates[0] : null;

  return {
    rawText,
    normalizedText,
    generatedCandidateCount: generated.size,
    validCandidates,
    selectedCandidate: selectedCandidate?.serial ?? null,
    correctionCount: selectedCandidate?.correctionCount ?? null,
    ambiguous,
    ...(ambiguous ? {
      ambiguityReason: multipleBestCandidates ? 'multiple-valid-candidates' as const : 'possible-truncated-suffix' as const,
    } : {}),
    status: validCandidates.length === 0
      ? 'no-valid-candidate'
      : ambiguous
        ? 'ambiguous'
        : 'corrected',
  };
}

interface CandidateWithScore {
  serial: string;
  corrections: number;
}

/** NFKC・大文字化しつつ、OCR文面の区切りを維持する。 */
export function cleanOcrText(input: string): string {
  return input ? input.normalize('NFKC').toUpperCase() : '';
}

/**
 * OCR全文から記番号候補を抽出する。文字欠落・挿入や並び替えは行わず、
 * tokenまたは区切られた番号全体が8〜10文字のときだけ位置ベース補正を試す。
 */
export function extractSerialCandidates(ocrRawText: string, maxCandidates = 3): string[] {
  if (!ocrRawText || typeof ocrRawText !== 'string') return [];

  const cleanedText = cleanOcrText(ocrRawText);
  const foundCandidates = new Map<string, CandidateWithScore>();
  const addTokenCandidates = (token: string) => {
    const result = correctOcrSerial(token);
    for (const candidate of result.validCandidates) {
      const existing = foundCandidates.get(candidate.serial);
      if (!existing || candidate.correctionCount < existing.corrections) {
        foundCandidates.set(candidate.serial, { serial: candidate.serial, corrections: candidate.correctionCount });
      }
    }
  };

  for (const word of cleanedText.split(/[\s\r\n\t]+/)) {
    const token = word.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
    if (token) addTokenCandidates(token);
  }

  const segmentedRegex = /([A-Z0-9]{1,3}[\s-]+[A-Z0-9\s-]{4,10}[A-Z0-9]{1,3})/g;
  let match: RegExpExecArray | null;
  while ((match = segmentedRegex.exec(cleanedText)) !== null) {
    const token = normalizeSerialInput(match[1]);
    if (token.length >= 8 && token.length <= 10) addTokenCandidates(token);
  }

  return [...foundCandidates.values()]
    .sort((a, b) => a.corrections - b.corrections)
    .slice(0, maxCandidates)
    .map((candidate) => candidate.serial);
}

/**
 * Otsu法（判別分析法）による最適閾値の自動算出
 */
function calculateOtsuThreshold(grayData: Uint8ClampedArray): number {
  const histogram = new Array(256).fill(0);
  const total = grayData.length / 4;

  for (let i = 0; i < grayData.length; i += 4) {
    histogram[grayData[i]]++;
  }

  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const betweenVariance = wB * wF * (mB - mF) * (mB - mF);

    if (betweenVariance > maxVariance) {
      maxVariance = betweenVariance;
      threshold = t;
    }
  }

  return threshold;
}

/**
 * 画像ピクセル統計情報
 */
export interface ImagePixelStats {
  width: number;
  height: number;
  minLum: number;
  maxLum: number;
  avgLum: number;
  transparentRatio: string;
}

/**
 * ImageData のピクセル統計を解析（最小/最大/平均輝度、透明ピクセル率）
 */
export function analyzeImageData(imageData: ImageData): ImagePixelStats {
  const data = imageData.data;
  const totalPixels = data.length / 4;
  let minLum = 255;
  let maxLum = 0;
  let sumLum = 0;
  let transparentCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 10) {
      transparentCount++;
    }
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
    sumLum += lum;
  }

  return {
    width: imageData.width,
    height: imageData.height,
    minLum: totalPixels === 0 ? 0 : Math.round(minLum),
    maxLum: totalPixels === 0 ? 0 : Math.round(maxLum),
    avgLum: totalPixels === 0 ? 0 : Math.round(sumLum / totalPixels),
    transparentRatio: totalPixels === 0 ? '0%' : ((transparentCount / totalPixels) * 100).toFixed(1) + '%',
  };
}

/**
 * Blob から ImagePixelStats を解析する補助関数
 */
export async function analyzeBlobStats(blob: Blob): Promise<ImagePixelStats> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({
          width: canvas.width,
          height: canvas.height,
          minLum: 0,
          maxLum: 0,
          avgLum: 0,
          transparentRatio: '0%',
        });
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve(analyzeImageData(imgData));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0, minLum: 0, maxLum: 0, avgLum: 0, transparentRatio: '100%' });
    };
    img.src = url;
  });
}

/**
 * 前処理パターンの種類
 */
export interface PreprocessedPass {
  name: string;
  blob: Blob;
  previewUrl: string;
  stats: ImagePixelStats;
}

export interface PsmImageDiagnostic {
  imageVariant: 'Original (Upscaled)' | 'Contrast Enhanced' | 'Otsu Binarized';
  psm: 7 | 13;
  psmName: 'SINGLE_LINE' | 'RAW_LINE';
  width: number;
  height: number;
  rawText: string;
  compactText: string;
  candidates: string[];
  rejectedWindows: string[];
  isValid: boolean;
  confidence: number;
  durationMs: number;
  previewUrl: string;
  error?: string;
}

export const OCR_PSM_COMPARISON = [
  { psm: 7, name: 'SINGLE_LINE' },
  { psm: 13, name: 'RAW_LINE' },
] as const;

export const REALTIME_OCR_IMAGE = {
  width: 1400,
  height: 214,
  exposure: 1.18,
  blackLevel: 12,
  threshold: 150,
  minimumIntervalMs: 350,
} as const;

export interface SerialScanObservation {
  serial: string | null;
  rawText: string;
  confidence: number;
  durationMs: number;
}

export function evaluateSerialStability(history: readonly SerialScanObservation[]): {
  serial: string | null;
  reason: 'two-consecutive' | 'three-of-five' | null;
} {
  const recent = history.slice(-5).map((observation) => ({
    ...observation,
    serial: observation.serial && validateSerialNumber(observation.serial).isValid
      ? normalizeSerialInput(observation.serial)
      : null,
  }));
  const lastTwo = recent.slice(-2);
  if (lastTwo.length === 2 && lastTwo[0].serial && lastTwo[0].serial === lastTwo[1].serial) {
    return { serial: lastTwo[1].serial, reason: 'two-consecutive' };
  }
  const counts = new Map<string, number>();
  for (const observation of recent) {
    if (observation.serial) counts.set(observation.serial, (counts.get(observation.serial) ?? 0) + 1);
  }
  const match = [...counts.entries()].find(([, count]) => count >= 3);
  return match ? { serial: match[0], reason: 'three-of-five' } : { serial: null, reason: null };
}

export interface RealtimeSerialOcrResult extends SerialScanObservation {
  candidates: string[];
  input: Blob;
  width: number;
  height: number;
}

export interface RealtimeSerialOcrSession {
  recognize(image: Blob): Promise<RealtimeSerialOcrResult>;
  terminate(): Promise<void>;
}

async function preprocessRealtimeSerialImage(source: Blob): Promise<Blob> {
  const url = URL.createObjectURL(source);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not load camera frame'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }

  const canvas = document.createElement('canvas');
  canvas.width = REALTIME_OCR_IMAGE.width;
  canvas.height = REALTIME_OCR_IMAGE.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D context unavailable');
  const fitted = getContainedImageRect(img.naturalWidth, img.naturalHeight, canvas.width, canvas.height);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, fitted.x, fitted.y, fitted.width, fitted.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const { exposure, blackLevel, threshold } = REALTIME_OCR_IMAGE;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const luminance = 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2];
    const exposed = Math.max(0, Math.min(255, (luminance - blackLevel) * exposure));
    const binary = exposed < threshold ? 0 : 255;
    pixels.data[i] = binary;
    pixels.data[i + 1] = binary;
    pixels.data[i + 2] = binary;
  }
  context.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode OCR frame')), 'image/png');
  });
}

/** Create one lazy, reusable local Tesseract worker for the camera session. */
export async function createRealtimeSerialOcrSession(): Promise<RealtimeSerialOcrSession> {
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng', 1);
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: OCR_ALLOWED_CHARACTERS,
    });
  } catch (error) {
    await worker.terminate();
    throw error;
  }
  let busy = false;
  let terminated = false;
  return {
    async recognize(image) {
      if (terminated) throw new Error('OCR session has ended');
      if (busy) throw new Error('OCR frame already in progress');
      busy = true;
      const startedAt = performance.now();
      try {
        const input = await preprocessRealtimeSerialImage(image);
        const result = await worker.recognize(input);
        const rawText = result.data.text || '';
        const candidates = extractSerialCandidates(rawText, 3);
        return {
          serial: candidates.length === 1 ? candidates[0] : null,
          rawText,
          confidence: result.data.confidence ?? 0,
          durationMs: performance.now() - startedAt,
          candidates,
          input,
          width: REALTIME_OCR_IMAGE.width,
          height: REALTIME_OCR_IMAGE.height,
        };
      } finally {
        busy = false;
      }
    },
    async terminate() {
      if (terminated) return;
      terminated = true;
      await worker.terminate();
    },
  };
}

export interface OcrSerialCandidate {
  serial: string;
  isValid: boolean;
  requiresReview: boolean;
  confidence: number;
  sourcePasses: string[];
}

export function getOcrUpscaleFactor(sourceWidth: number, sourceHeight: number): number {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError('OCR image dimensions must be positive');
  }
  return Math.min(4, Math.max(1, 420 / sourceHeight), 4096 / sourceWidth);
}

/** Merge valid suggestions from one captured image; every result remains a manual-review suggestion. */
export function collectSingleImageOcrCandidates(
  passResults: readonly (readonly OcrSerialCandidate[])[]
): OcrSerialCandidate[] {
  const merged = new Map<string, { candidate: OcrSerialCandidate; sources: Set<string> }>();
  for (const results of passResults) {
    for (const candidate of results) {
      if (!candidate.isValid) continue;
      const source = candidate.sourcePasses[0] ?? 'OCR';
      const existing = merged.get(candidate.serial);
      if (existing) {
        existing.sources.add(source);
        if (candidate.confidence > existing.candidate.confidence) existing.candidate = candidate;
      } else {
        merged.set(candidate.serial, { candidate, sources: new Set([source]) });
      }
    }
  }
  return [...merged.values()]
    .map(({ candidate, sources }) => ({
      ...candidate,
      requiresReview: true,
      sourcePasses: [...sources],
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

function getRejectedWindows(rawText: string): string[] {
  const compact = cleanOcrText(rawText).replace(/[^A-Z0-9]/g, '');
  const rejected = new Map<string, string>();
  for (const length of [8, 9, 10]) {
    for (let start = 0; start <= compact.length - length; start++) {
      const value = compact.slice(start, start + length);
      const validation = validateSerialNumber(value);
      if (!validation.isValid) rejected.set(value, value);
    }
  }
  return [...rejected.values()].slice(0, 12);
}

export interface OcrCorrectionDiagnostic extends OcrSerialCorrectionResult {
  pass: string;
}

/**
 * 細いカメラ切り抜きでも文字が小さくなりすぎないよう高さ約420pxを目安に拡大し、
 * 以下の3種類の前処理パターンを生成する:
 * 1. 原画像（アップスケールのみ・カラー情報保持）
 * 2. グレースケール + コントラスト強調
 * 3. グレースケール + 二値化 (Otsu適応閾値)
 */
export async function generatePreprocessedPasses(imageSource: Blob | File): Promise<PreprocessedPass[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(imageSource);

    img.onload = async () => {
      try {
        URL.revokeObjectURL(objectUrl);

        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;

        // 横長のserial ROIを縮小しない。高解像度フレームも文字を保てる範囲で
        // 約420px高まで拡大し、極端に巨大な画像は避ける。
        const scale = getOcrUpscaleFactor(srcW, srcH);

        const width = Math.max(1, Math.round(srcW * scale));
        const height = Math.max(1, Math.round(srcH * scale));

        // ベースとなるアップスケールCanvas
        const baseCanvas = document.createElement('canvas');
        baseCanvas.width = width;
        baseCanvas.height = height;
        const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
        if (!baseCtx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        // 白背景で塗りつぶし（透明ピクセルによる誤認識防止）
        baseCtx.fillStyle = '#ffffff';
        baseCtx.fillRect(0, 0, width, height);

        // 高品質スムージングで拡大描画
        baseCtx.imageSmoothingEnabled = true;
        baseCtx.imageSmoothingQuality = 'high';
        baseCtx.drawImage(img, 0, 0, width, height);

        const baseImgData = baseCtx.getImageData(0, 0, width, height);
        const statsOriginal = analyzeImageData(baseImgData);

        // --- パス 1: 原画像（アップスケールのみ） ---
        const blobOriginal = await new Promise<Blob>((res, rej) => {
          baseCanvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.95);
        });

        // --- パス 2: グレースケール + コントラスト強調 ---
        const contrastCanvas = document.createElement('canvas');
        contrastCanvas.width = width;
        contrastCanvas.height = height;
        const contrastCtx = contrastCanvas.getContext('2d', { willReadFrequently: true })!;
        contrastCtx.drawImage(baseCanvas, 0, 0);

        const imgData2 = contrastCtx.getImageData(0, 0, width, height);
        const data2 = imgData2.data;
        const contrastFactor = 1.4; // コントラスト40%強調

        for (let i = 0; i < data2.length; i += 4) {
          const gray = 0.299 * data2[i] + 0.587 * data2[i + 1] + 0.114 * data2[i + 2];
          const adjusted = Math.min(255, Math.max(0, ((gray - 128) * contrastFactor) + 128));
          data2[i] = adjusted;
          data2[i + 1] = adjusted;
          data2[i + 2] = adjusted;
        }
        contrastCtx.putImageData(imgData2, 0, 0);
        const statsContrast = analyzeImageData(imgData2);

        const blobContrast = await new Promise<Blob>((res, rej) => {
          contrastCanvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.95);
        });

        // --- パス 3: グレースケール + 二値化 (Otsu法) ---
        const binarizedCanvas = document.createElement('canvas');
        binarizedCanvas.width = width;
        binarizedCanvas.height = height;
        const binarizedCtx = binarizedCanvas.getContext('2d', { willReadFrequently: true })!;
        binarizedCtx.drawImage(baseCanvas, 0, 0);

        const imgData3 = binarizedCtx.getImageData(0, 0, width, height);
        const data3 = imgData3.data;

        // まずグレースケール化
        for (let i = 0; i < data3.length; i += 4) {
          const gray = 0.299 * data3[i] + 0.587 * data3[i + 1] + 0.114 * data3[i + 2];
          data3[i] = gray;
          data3[i + 1] = gray;
          data3[i + 2] = gray;
        }

        // Otsu法で最適閾値を決定
        const otsuThreshold = calculateOtsuThreshold(data3);

        // 二値化（文字を濃い色、背景を白に）
        for (let i = 0; i < data3.length; i += 4) {
          const val = data3[i] < otsuThreshold ? 0 : 255;
          data3[i] = val;
          data3[i + 1] = val;
          data3[i + 2] = val;
        }
        binarizedCtx.putImageData(imgData3, 0, 0);
        const statsBinarized = analyzeImageData(imgData3);

        const blobBinarized = await new Promise<Blob>((res, rej) => {
          binarizedCanvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.95);
        });

        resolve([
          {
            name: 'Original (Upscaled)',
            blob: blobOriginal,
            previewUrl: URL.createObjectURL(blobOriginal),
            stats: statsOriginal,
          },
          {
            name: 'Contrast Enhanced',
            blob: blobContrast,
            previewUrl: URL.createObjectURL(blobContrast),
            stats: statsContrast,
          },
          {
            name: 'Otsu Binarized',
            blob: blobBinarized,
            previewUrl: URL.createObjectURL(blobBinarized),
            stats: statsBinarized,
          },
        ]);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for preprocessing: ' + e));
    };

    img.src = objectUrl;
  });
}

/**
 * 端末内OCR実行関数（マルチパス & SINGLE_WORD対応）
 * - dynamic import で tesseract.js を遅延ロード
 * - ページセグメンテーション: SINGLE_WORD
 * - 複数前処理パターンを順次評価し、最も妥当な候補をマージ
 * - ?debug=timing 時の詳細診断ログ出力
 */
async function recognizeBanknoteSerialFromImageInternal(
  imageFileOrBlob: Blob | File,
  onProgress?: (status: string) => void,
  onPassesReady?: (passes: PreprocessedPass[]) => void,
  onRecognizeEvent?: (event: { type: 'start' | 'end' | 'error'; pass: string; message?: string; code?: string }) => void,
  onPsmDiagnostics?: (results: PsmImageDiagnostic[]) => void,
  onOcrCorrectionDiagnostics?: (results: OcrCorrectionDiagnostic[]) => void,
): Promise<OcrSerialCandidate[]> {
  const debugTiming = isDebugTiming();

  const startTime = debugTiming ? performance.now() : 0;

  onProgress?.('OCRエンジンを読み込み中...');

  // 1. Tesseract.js の動的インポート (初期バンドルサイズ削減)
  const { createWorker, PSM } = await import('tesseract.js');

  onProgress?.('画像を前処理中（解像度最適化・二値化など）...');
  let passes: PreprocessedPass[] = [];
  try {
    passes = await generatePreprocessedPasses(imageFileOrBlob);
  } catch (err) {
    console.warn('Preprocessing passes failed, fallback to single pass:', err);
    passes = [
      {
        name: 'Raw Input',
        blob: imageFileOrBlob,
        previewUrl: URL.createObjectURL(imageFileOrBlob),
        stats: { width: 0, height: 0, minLum: 0, maxLum: 0, avgLum: 0, transparentRatio: '0%' },
      },
    ];
  }

  onPassesReady?.(passes);

  onProgress?.('記番号を認識中...');

  let worker: any = null;
  const passCandidateLists: OcrSerialCandidate[][] = [];
  const correctionDiagnostics: OcrCorrectionDiagnostic[] = [];
  try {
    try {
      worker = await createWorker('eng', 1, debugTiming ? {
        logger: ({ status, progress }) => {
          console.log(`[Tesseract] status=${status} progress=${Math.round(progress * 100)}%`);
        },
        errorHandler: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[Tesseract] worker error: ${message}`);
        },
      } : {});
    } catch (err) {
      const error = err as Error & { code?: string };
      onRecognizeEvent?.({ type: 'error', pass: 'initialize', message: error.message, code: error.code });
      throw err;
    }

    const contrastPass = passes.find((pass) => pass.name.includes('Contrast'));
    const otsuPass = passes.find((pass) => pass.name.includes('Otsu'));
    const imageVariants = [
      passes[0] && { pass: passes[0], name: 'Original (Upscaled)' as const },
      contrastPass && { pass: contrastPass, name: 'Contrast Enhanced' as const },
      otsuPass && { pass: otsuPass, name: 'Otsu Binarized' as const },
    ].filter((variant): variant is { pass: PreprocessedPass; name: PsmImageDiagnostic['imageVariant'] } => Boolean(variant));
    const diagnosticResults: PsmImageDiagnostic[] = [];

    // One captured image is evaluated as three image variants × PSM 7/13.
    // No frame voting or auto-acceptance is done; results are suggestions only.
    for (const variant of imageVariants) {
      for (const psm of OCR_PSM_COMPARISON) {
        const label = `${variant.name} / PSM ${psm.psm} (${psm.name})`;
        onProgress?.(`記番号を認識中... (${label})`);
        onRecognizeEvent?.({ type: 'start', pass: label });
        let rawText = '';
        let confidence = 0;
        let durationMs = 0;
        let errorMessage: string | undefined;
        const passStart = performance.now();
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: psm.psm === 7 ? PSM.SINGLE_LINE : PSM.RAW_LINE,
            tessedit_char_whitelist: OCR_ALLOWED_CHARACTERS,
          });
          const ret = await worker.recognize(variant.pass.blob);
          rawText = ret.data.text || '';
          confidence = ret.data.confidence ?? 0;
          onRecognizeEvent?.({ type: 'end', pass: label });
        } catch (err) {
          const error = err as Error & { code?: string };
          errorMessage = error.message || String(err);
          onRecognizeEvent?.({ type: 'error', pass: label, message: errorMessage, code: error.code });
        }
        durationMs = performance.now() - passStart;
        const compactText = cleanOcrText(rawText).replace(/[^A-Z0-9]/g, '');
        const candidates = extractSerialCandidates(rawText, 3);
        const candidateResults = candidates.map((serial) => ({
          serial,
          isValid: validateSerialNumber(serial).isValid,
          requiresReview: true,
          confidence,
          sourcePasses: [label],
        }));
        passCandidateLists.push(candidateResults);
        diagnosticResults.push({
          imageVariant: variant.name,
          psm: psm.psm,
          psmName: psm.name,
          width: variant.pass.stats.width,
          height: variant.pass.stats.height,
          rawText,
          compactText,
          candidates,
          rejectedWindows: getRejectedWindows(rawText),
          isValid: candidates.length > 0,
          confidence,
          durationMs,
          previewUrl: variant.pass.previewUrl,
          error: errorMessage,
        });
        if (debugTiming) onPsmDiagnostics?.([...diagnosticResults]);

        if (debugTiming) {
          const correction = correctOcrSerial(rawText);
          correctionDiagnostics.push({ pass: label, ...correction });
          onOcrCorrectionDiagnostics?.([...correctionDiagnostics]);
          console.log(`[OCR Debug] ${label} raw="${rawText.replace(/[\r\n]+/g, ' ').trim()}" candidates=${candidates.length} confidence=${confidence.toFixed(1)}% duration=${durationMs.toFixed(0)}ms`);
        }
      }
    }

    const allCandidates = collectSingleImageOcrCandidates(passCandidateLists);
    if (debugTiming) {
      console.log(`[OCR Timing] total=${(performance.now() - startTime).toFixed(0)}ms comparisons=${diagnosticResults.length} suggestions=${allCandidates.length}`);
    }
    return allCandidates;
  } finally {
    if (worker) {
      await worker.terminate();
    }
    if (!debugTiming) passes.forEach((pass) => URL.revokeObjectURL(pass.previewUrl));
  }
}

let recognitionInProgress = false;
export async function recognizeBanknoteSerialFromImage(
  imageFileOrBlob: Blob | File,
  onProgress?: (status: string) => void,
  onPassesReady?: (passes: PreprocessedPass[]) => void,
  onRecognizeEvent?: (event: { type: 'start' | 'end' | 'error'; pass: string; message?: string; code?: string }) => void,
  onPsmDiagnostics?: (results: PsmImageDiagnostic[]) => void,
  onOcrCorrectionDiagnostics?: (results: OcrCorrectionDiagnostic[]) => void,
): Promise<OcrSerialCandidate[]> {
  if (recognitionInProgress) {
    const error = new Error('OCR is already running');
    Object.assign(error, { code: 'ocr/busy' });
    throw error;
  }
  recognitionInProgress = true;
  try {
    return await recognizeBanknoteSerialFromImageInternal(
      imageFileOrBlob, onProgress, onPassesReady, onRecognizeEvent, onPsmDiagnostics, onOcrCorrectionDiagnostics
    );
  } finally {
    recognitionInProgress = false;
  }
}
