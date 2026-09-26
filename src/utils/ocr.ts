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
  imageVariant: 'クロップ直後' | 'Contrast Enhanced' | 'Otsu Binarized';
  psmName: 'SINGLE_WORD' | 'RAW_LINE';
  padding: boolean;
  paddingPx: number;
  rawText: string;
  compactText: string;
  confidence: number;
  durationMs: number;
  isValid: boolean;
  error?: string;
}

export interface OcrSerialCandidate {
  serial: string;
  isValid: boolean;
  requiresReview: boolean;
  confidence: number;
  sourcePasses: string[];
}

export interface OcrCorrectionDiagnostic extends OcrSerialCorrectionResult {
  pass: string;
}

function serialFormatDistance(value: string): number {
  const layouts = [
    { letters: 1, suffix: 1 },
    { letters: 1, suffix: 2 },
    { letters: 2, suffix: 1 },
    { letters: 2, suffix: 2 },
  ];
  return Math.min(...layouts.map(({ letters, suffix }) => {
    if (value.length !== letters + 6 + suffix) return Number.POSITIVE_INFINITY;
    let mismatches = 0;
    for (let i = 0; i < value.length; i++) {
      const expectsLetter = i < letters || i >= letters + 6;
      if (expectsLetter ? !/[A-Z]/.test(value[i]) : !/[0-9]/.test(value[i])) mismatches++;
    }
    return mismatches;
  }));
}

function extractReviewCandidates(rawText: string): string[] {
  const compact = cleanOcrText(rawText).replace(/[^A-Z0-9]/g, '');
  const candidates = new Set<string>();
  for (const length of [8, 9, 10]) {
    for (let start = 0; start <= compact.length - length; start++) {
      const candidate = compact.slice(start, start + length);
      if (!validateSerialNumber(candidate).isValid && serialFormatDistance(candidate) <= 2) {
        candidates.add(candidate);
      }
    }
  }
  return [...candidates];
}

async function addWhitePadding(source: Blob): Promise<{ blob: Blob; paddingPx: number }> {
  const img = new Image();
  const sourceUrl = URL.createObjectURL(source);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image for padding'));
      img.src = sourceUrl;
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const paddingPx = Math.min(30, Math.max(20, Math.round(height * 0.1)));
  const canvas = document.createElement('canvas');
  canvas.width = width + paddingPx * 2;
  canvas.height = height + paddingPx * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable for padding');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, paddingPx, paddingPx, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Failed to encode padded image')), 'image/png');
  });
  return { blob, paddingPx };
}

/**
 * 画像をOCRに最適な文字サイズ（高さ80〜120px程度）になるよう必要に応じてアップスケールし、
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

        // 記番号の文字高さをOCRに十分な解像度（高さ80〜120px程度）にスケールアップ
        let scale = 1.0;
        if (srcH < 70) {
          scale = Math.min(3.0, 100 / Math.max(1, srcH));
        } else if (srcH < 100) {
          scale = 1.5;
        }

        // 最大幅は1600pxに制限
        if (srcW * scale > 1600) {
          scale = 1600 / srcW;
        }

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
export async function recognizeBanknoteSerialFromImage(
  imageFileOrBlob: Blob | File,
  onProgress?: (status: string) => void,
  onPassesReady?: (passes: PreprocessedPass[]) => void,
  onRecognizeEvent?: (event: { type: 'start' | 'end' | 'error'; pass: string; message?: string; code?: string }) => void,
  onPsmDiagnostics?: (results: PsmImageDiagnostic[]) => void,
  onOcrCorrectionDiagnostics?: (results: OcrCorrectionDiagnostic[]) => void
): Promise<OcrSerialCandidate[]> {
  const debugTiming = isDebugTiming();

  const startTime = debugTiming ? performance.now() : 0;
  let loadTime = 0;

  onProgress?.('OCRエンジンを読み込み中...');

  // 1. Tesseract.js の動的インポート (初期バンドルサイズ削減)
  const { createWorker, PSM } = await import('tesseract.js');

  if (debugTiming) {
    loadTime = performance.now() - startTime;
  }

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
  const allCandidateSerials = new Map<string, OcrSerialCandidate & { formatDistance: number }>();
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

    // 記番号を1つの単語として認識。whitelistは適用しない。
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_WORD,
        tessedit_char_whitelist: '',
      });
    } catch (err) {
      const error = err as Error & { code?: string };
      onRecognizeEvent?.({ type: 'error', pass: 'initialize', message: error.message, code: error.code });
      throw err;
    }
    const contrastPass = passes.find((pass) => pass.name.includes('Contrast'));
    const otsuPass = passes.find((pass) => pass.name.includes('Otsu'));
    const normalPasses: PreprocessedPass[] = [
      { ...(passes[0]), name: 'クロップ直後', blob: imageFileOrBlob },
      ...(contrastPass ? [contrastPass] : []),
      ...(otsuPass ? [otsuPass] : []),
    ];

    for (let i = 0; i < normalPasses.length; i++) {
      const pass = normalPasses[i];
      onProgress?.(`記番号を認識中... (${i + 1}/${passes.length}: ${pass.name})`);

      const passStart = debugTiming ? performance.now() : 0;
      onRecognizeEvent?.({ type: 'start', pass: pass.name });
      let ret;
      try {
        ret = await worker.recognize(pass.blob);
      } catch (err) {
        const error = err as Error & { code?: string };
        onRecognizeEvent?.({ type: 'error', pass: pass.name, message: error.message, code: error.code });
        throw err;
      }
      const rawText = ret.data.text || '';
      const confidence = ret.data.confidence ?? 0;
      const passDuration = debugTiming ? performance.now() - passStart : 0;

      if (debugTiming) {
        const correction = correctOcrSerial(rawText);
        const diagnostic: OcrCorrectionDiagnostic = { pass: pass.name, ...correction };
        correctionDiagnostics.push(diagnostic);
        onOcrCorrectionDiagnostics?.([...correctionDiagnostics]);
        console.log('[OCR Correction]', {
          pass: pass.name,
          normalizedText: correction.normalizedText,
          generatedCandidateCount: correction.generatedCandidateCount,
          validCandidates: correction.validCandidates,
          selectedCandidate: correction.selectedCandidate,
          correctionCount: correction.correctionCount,
          ambiguous: correction.ambiguous,
          status: correction.status,
        });
      }

      onRecognizeEvent?.({ type: 'end', pass: pass.name });

      // 候補抽出
      const passCandidates = extractSerialCandidates(rawText, 3);
      const compactRaw = cleanOcrText(rawText).replace(/[^A-Z0-9]/g, '');
      const observations = [
        ...passCandidates.map((serial) => ({ serial, isValid: true })),
        ...extractReviewCandidates(rawText).map((serial) => ({ serial, isValid: false })),
      ];

      if (debugTiming) {
        console.log(
          `%c[OCR Pass ${i + 1}: ${pass.name}] ` +
          `Time: ${passDuration.toFixed(0)}ms | Conf: ${confidence.toFixed(1)}% | ` +
          `Size: ${pass.stats.width}x${pass.stats.height} | ` +
          `Lum(min/max/avg): ${pass.stats.minLum}/${pass.stats.maxLum}/${pass.stats.avgLum} | ` +
          `Trans: ${pass.stats.transparentRatio} | ` +
          `Raw: "${rawText.replace(/[\r\n]+/g, ' ').trim()}" | ` +
          `Candidates: [${passCandidates.join(', ')}]`,
          'background: #1e293b; color: #38bdf8; font-family: monospace; font-size: 11px; padding: 2px 4px;'
        );
      }

      for (const observation of observations) {
        const { serial, isValid } = observation;
        const exactText = compactRaw.includes(serial);
        const existing = allCandidateSerials.get(serial);
        if (!existing) {
          allCandidateSerials.set(serial, {
            serial,
            isValid,
            requiresReview: !isValid || !exactText,
            confidence,
            sourcePasses: [pass.name],
            formatDistance: serialFormatDistance(serial),
          });
        } else {
          existing.isValid ||= isValid;
          existing.requiresReview &&= !isValid || !exactText;
          existing.confidence = Math.max(existing.confidence, confidence);
          if (!existing.sourcePasses.includes(pass.name)) existing.sourcePasses.push(pass.name);
        }
      }
    }

    if (debugTiming) {
      const diagnosticResults: PsmImageDiagnostic[] = [];
      const contrastPass = passes.find((pass) => pass.name.includes('Contrast'));
      const otsuPass = passes.find((pass) => pass.name.includes('Otsu'));
      const imageVariants: Array<{ name: PsmImageDiagnostic['imageVariant']; blob: Blob | null }> = [
        { name: 'クロップ直後', blob: imageFileOrBlob },
        { name: 'Contrast Enhanced', blob: contrastPass?.blob || null },
        { name: 'Otsu Binarized', blob: otsuPass?.blob || null },
      ];
      const psmCases = [
        { name: 'SINGLE_WORD' as const, value: PSM.SINGLE_WORD },
        { name: 'RAW_LINE' as const, value: PSM.RAW_LINE },
      ];

      for (const variant of imageVariants) {
        for (const psm of psmCases) {
          for (const usePadding of [false, true]) {
            const label = `${variant.name} / ${psm.name} / padding ${usePadding ? 'on' : 'off'}`;
            onProgress?.(`OCR診断中... (${label})`);
            onRecognizeEvent?.({ type: 'start', pass: label });
            let recognizeStartedAt: number | null = null;
            let rawText = '';
            let confidence = 0;
            let durationMs = 0;
            let paddingPx = 0;
            let errorMessage: string | undefined;

            try {
              if (!variant.blob) throw new Error(`${variant.name} image is unavailable`);
              const input = usePadding ? await addWhitePadding(variant.blob) : { blob: variant.blob, paddingPx: 0 };
              paddingPx = input.paddingPx;
              await worker.setParameters({
                tessedit_pageseg_mode: psm.value,
                tessedit_char_whitelist: '',
              });
              recognizeStartedAt = performance.now();
              const ret = await worker.recognize(input.blob);
              rawText = ret.data.text || '';
              confidence = ret.data.confidence ?? 0;
              durationMs = performance.now() - recognizeStartedAt;
              onRecognizeEvent?.({ type: 'end', pass: label });
            } catch (err) {
              const error = err as Error & { code?: string };
              durationMs = recognizeStartedAt === null ? 0 : performance.now() - recognizeStartedAt;
              errorMessage = error.message || String(err);
              console.log(`[OCR Debug] ${label} error=${errorMessage}`);
            }

            const compactText = rawText.replace(/\s/g, '');
            diagnosticResults.push({
              imageVariant: variant.name,
              psmName: psm.name,
              padding: usePadding,
              paddingPx,
              rawText,
              compactText,
              confidence,
              durationMs,
              isValid: validateSerialNumber(compactText).isValid,
              error: errorMessage,
            });
            onPsmDiagnostics?.([...diagnosticResults]);
            console.log(`[OCR Debug] ${label} raw="${rawText.replace(/[\r\n]+/g, ' ').trim()}" compact="${compactText}" confidence=${confidence.toFixed(1)}% time=${durationMs.toFixed(0)}ms valid=${validateSerialNumber(compactText).isValid}`);
          }
        }
      }

      // Debug比較後も通常OCRと同じパラメータに戻す。
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_WORD,
        tessedit_char_whitelist: '',
      });
    }
    if (debugTiming) {
      console.log(
        `%c[Timing Monitor] Total OCR Load: ${loadTime.toFixed(0)}ms | Total Time: ${(performance.now() - startTime).toFixed(0)}ms | Unique Candidates: ${allCandidateSerials.size}`,
        'background: #7c3aed; color: #fff; font-weight: bold; padding: 2px 6px; border-radius: 4px;'
      );
    }

    const sorted = Array.from(allCandidateSerials.values()).sort((a, b) =>
      Number(a.requiresReview) - Number(b.requiresReview) ||
      a.formatDistance - b.formatDistance ||
      b.confidence - a.confidence ||
      b.serial.length - a.serial.length
    );

    return sorted.slice(0, 3).map(({ formatDistance: _formatDistance, ...candidate }) => candidate);
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}
