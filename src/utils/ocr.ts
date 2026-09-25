import { validateSerialNumber } from './serial.ts';

/**
 * 混同されやすい文字の位置ベース補正マップ
 */
const NUM_TO_LETTER: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '5': 'S',
  '8': 'B',
  '2': 'Z',
};

const LETTER_TO_NUM: Record<string, string> = {
  'O': '0',
  'I': '1',
  'L': '1',
  'S': '5',
  'B': '8',
  'Z': '2',
};

interface CandidateWithScore {
  serial: string;
  corrections: number;
}

/**
 * 文字列が指定された記番号構成（先頭英字 + 中央数字6桁 + 末尾英字）に
 * 補正可能かどうかを判定し、可能であれば補正後の文字列と補正文字数を返す。
 * 
 * ※注意: OCR結果を無理やり変換しすぎないよう、補正文字数が2文字を超える場合は不適格とする。
 */
function tryFixPattern(
  chunk: string,
  prefixLen: number,
  suffixLen: number
): CandidateWithScore | null {
  if (chunk.length !== prefixLen + 6 + suffixLen) {
    return null;
  }

  let corrections = 0;
  const result: string[] = [];

  // 1. 先頭部 (英字であるべき位置)
  for (let i = 0; i < prefixLen; i++) {
    const char = chunk[i];
    if (char >= 'A' && char <= 'Z') {
      result.push(char);
    } else if (NUM_TO_LETTER[char]) {
      result.push(NUM_TO_LETTER[char]);
      corrections++;
    } else {
      return null; // 補正不能
    }
  }

  // 2. 中央部 (数字6桁であるべき位置)
  const middleStart = prefixLen;
  const middleEnd = prefixLen + 6;
  for (let i = middleStart; i < middleEnd; i++) {
    const char = chunk[i];
    if (char >= '0' && char <= '9') {
      result.push(char);
    } else if (LETTER_TO_NUM[char]) {
      result.push(LETTER_TO_NUM[char]);
      corrections++;
    } else {
      return null; // 補正不能
    }
  }

  // 3. 末尾部 (英字であるべき位置)
  const suffixStart = middleEnd;
  const suffixEnd = middleEnd + suffixLen;
  for (let i = suffixStart; i < suffixEnd; i++) {
    const char = chunk[i];
    if (char >= 'A' && char <= 'Z') {
      result.push(char);
    } else if (NUM_TO_LETTER[char]) {
      result.push(NUM_TO_LETTER[char]);
      corrections++;
    } else {
      return null; // 補正不能
    }
  }

  // 無理な補正の防止: 補正が3文字以上の場合はOCR結果の原形を留めていないため候補から除外
  if (corrections > 2) {
    return null;
  }

  const serial = result.join('');
  const validation = validateSerialNumber(serial);
  if (!validation.isValid) {
    return null;
  }

  return { serial, corrections };
}

/**
 * 長さ8〜10文字のトークンに対して、可能な記番号パターンを検証・補正する
 */
function evaluateToken(token: string): CandidateWithScore[] {
  const candidates: CandidateWithScore[] = [];

  // 日本銀行券の記番号パターン:
  // 長さ8: 1英字 + 6数字 + 1英字
  // 長さ9: 2英字 + 6数字 + 1英字 または 1英字 + 6数字 + 2英字
  // 長さ10: 2英字 + 6数字 + 2英字
  const patterns: [number, number][] = [];
  if (token.length === 8) {
    patterns.push([1, 1]);
  } else if (token.length === 9) {
    patterns.push([2, 1], [1, 2]);
  } else if (token.length === 10) {
    patterns.push([2, 2]);
  }

  for (const [prefixLen, suffixLen] of patterns) {
    const res = tryFixPattern(token, prefixLen, suffixLen);
    if (res) {
      candidates.push(res);
    }
  }

  return candidates;
}

/**
 * 全角を半角にし、大文字化するが、空白・改行・記号は保持する
 */
export function cleanOcrText(input: string): string {
  if (!input) return '';
  // 全角英数字を半角に変換
  let text = input.replace(/[！-～]/g, (s) => {
    return String.fromCharCode(s.charCodeAt(0) - 0xfee0);
  });
  // 全角スペースを半角スペースに統一
  text = text.replace(/\u3000/g, ' ');
  return text.toUpperCase();
}

/**
 * OCR認識テキストから、日本銀行券の記番号候補を抽出・補正して優先度順に返す
 * 
 * @param ocrRawText Tesseract等から得られたOCR全文
 * @param maxCandidates 返す候補の最大件数（デフォルト3件）
 */
export function extractSerialCandidates(
  ocrRawText: string,
  maxCandidates = 3
): string[] {
  if (!ocrRawText || typeof ocrRawText !== 'string') {
    return [];
  }

  const cleanedText = cleanOcrText(ocrRawText);
  const foundCandidates: CandidateWithScore[] = [];
  const seenSerials = new Set<string>();

  const addCandidate = (cand: CandidateWithScore) => {
    if (!seenSerials.has(cand.serial)) {
      seenSerials.add(cand.serial);
      foundCandidates.push(cand);
    }
  };

  // 1. 英数字以外の境界（または先頭・末尾）で区切られた完全一致を探索
  const isolatedExactRegex = /(?:^|[^A-Z0-9])([A-Z]{1,2}[0-9]{6}[A-Z]{1,2})(?:$|[^A-Z0-9])/g;
  let match: RegExpExecArray | null;
  while ((match = isolatedExactRegex.exec(cleanedText)) !== null) {
    const candidate = match[1];
    if (validateSerialNumber(candidate).isValid) {
      addCandidate({ serial: candidate, corrections: 0 });
    }
  }

  // 2. 単語（空白・改行区切り）単位の検証 & 誤認識補正 (O/0, I/1, S/5, B/8, Z/2)
  const rawWords = cleanedText.split(/[\s\r\n\t]+/);
  for (const rawWord of rawWords) {
    const trimmedWord = rawWord.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
    if (trimmedWord.length >= 8 && trimmedWord.length <= 10) {
      const resList = evaluateToken(trimmedWord);
      for (const res of resList) {
        addCandidate(res);
      }
    }
  }

  // 3. 記番号の途中に空白やハイフンが誤混入したケースの検出
  const segmentedRegex = /([A-Z0-9]{1,3}[\s-]+[A-Z0-9\s-]{4,10}[A-Z0-9]{1,3})/g;
  while ((match = segmentedRegex.exec(cleanedText)) !== null) {
    const collapsed = match[1].replace(/[\s-]/g, '');
    if (collapsed.length >= 8 && collapsed.length <= 10) {
      const resList = evaluateToken(collapsed);
      for (const res of resList) {
        addCandidate(res);
      }
    }
  }

  // 4. まだ候補が見つからない場合のフォールバック:
  // 空白・記号を全除去した連続英数字文字列からスライディングウィンドウ
  if (foundCandidates.length === 0) {
    const alphanumericOnly = cleanedText.replace(/[^A-Z0-9]/g, '');
    for (const len of [8, 9, 10]) {
      for (let i = 0; i <= alphanumericOnly.length - len; i++) {
        const windowStr = alphanumericOnly.slice(i, i + len);
        const resList = evaluateToken(windowStr);
        for (const res of resList) {
          addCandidate(res);
        }
      }
    }
  }

  // スコアリングでソート:
  // 1. 補正数が少ない（0 = 無補正完全一致）
  // 2. 登録順（元の出現順）
  foundCandidates.sort((a, b) => a.corrections - b.corrections);

  return foundCandidates.slice(0, maxCandidates).map((c) => c.serial);
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
 * 前処理パターンの種類
 */
export interface PreprocessedPass {
  name: string;
  blob: Blob;
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
        // クロップされた記番号部分の短辺が小さい場合、2〜3倍アップスケールする
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

        // 高品質スムージングで拡大描画
        baseCtx.imageSmoothingEnabled = true;
        baseCtx.imageSmoothingQuality = 'high';
        baseCtx.drawImage(img, 0, 0, width, height);

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

        const blobBinarized = await new Promise<Blob>((res, rej) => {
          binarizedCanvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.95);
        });

        resolve([
          { name: 'Original (Upscaled)', blob: blobOriginal },
          { name: 'Contrast Enhanced', blob: blobContrast },
          { name: 'Otsu Binarized', blob: blobBinarized },
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
 * 端末内OCR実行関数（マルチパス & SINGLE_LINE対応）
 * - dynamic import で tesseract.js を遅延ロード
 * - ページセグメンテーション: SINGLE_LINE (7)
 * - 複数前処理パターンを順次評価し、最も妥当な候補をマージ
 * - ?debug=timing 時の詳細診断ログ出力
 */
export async function recognizeBanknoteSerialFromImage(
  imageFileOrBlob: Blob | File,
  onProgress?: (status: string) => void
): Promise<string[]> {
  const isDebugTiming =
    typeof window !== 'undefined' &&
    window.location &&
    window.location.search.includes('debug=timing');

  const startTime = isDebugTiming ? performance.now() : 0;
  let loadTime = 0;

  onProgress?.('OCRエンジンを読み込み中...');

  // 1. Tesseract.js の動的インポート (初期バンドルサイズ削減)
  const { createWorker } = await import('tesseract.js');

  if (isDebugTiming) {
    loadTime = performance.now() - startTime;
  }

  onProgress?.('画像を前処理中（解像度最適化・二値化など）...');
  let passes: PreprocessedPass[] = [];
  try {
    passes = await generatePreprocessedPasses(imageFileOrBlob);
  } catch (err) {
    console.warn('Preprocessing passes failed, fallback to single pass:', err);
    passes = [{ name: 'Raw Input', blob: imageFileOrBlob }];
  }

  onProgress?.('記番号を認識中...');

  let worker: any = null;
  const allCandidateSerials = new Map<string, { serial: string; maxConfidence: number; sourcePass: string }>();

  try {
    worker = await createWorker('eng');

    // 1行の英数字列として認識 (PSM.SINGLE_LINE = 7)
    await worker.setParameters({
      tessedit_pageseg_mode: '7',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    });

    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      onProgress?.(`記番号を認識中... (${i + 1}/${passes.length}: ${pass.name})`);

      const passStart = isDebugTiming ? performance.now() : 0;
      const ret = await worker.recognize(pass.blob);
      const rawText = ret.data.text || '';
      const confidence = ret.data.confidence ?? 0;
      const passDuration = isDebugTiming ? performance.now() - passStart : 0;

      // 候補抽出
      const passCandidates = extractSerialCandidates(rawText, 3);

      if (isDebugTiming) {
        console.log(
          `%c[OCR Pass ${i + 1}: ${pass.name}] ` +
          `Time: ${passDuration.toFixed(0)}ms | Confidence: ${confidence.toFixed(1)}% | ` +
          `Raw: "${rawText.replace(/[\r\n]+/g, ' ').trim()}" | ` +
          `Candidates: [${passCandidates.join(', ')}]`,
          'background: #1e293b; color: #38bdf8; font-family: monospace; font-size: 11px; padding: 2px 4px;'
        );
      }

      for (const cand of passCandidates) {
        const existing = allCandidateSerials.get(cand);
        if (!existing || confidence > existing.maxConfidence) {
          allCandidateSerials.set(cand, {
            serial: cand,
            maxConfidence: confidence,
            sourcePass: pass.name,
          });
        }
      }
    }

    if (isDebugTiming) {
      console.log(
        `%c[Timing Monitor] Total OCR Load: ${loadTime.toFixed(0)}ms | Total Time: ${(performance.now() - startTime).toFixed(0)}ms | Unique Candidates: ${allCandidateSerials.size}`,
        'background: #7c3aed; color: #fff; font-weight: bold; padding: 2px 6px; border-radius: 4px;'
      );
    }

    // 信頼度が高い順に並べ替え
    const sorted = Array.from(allCandidateSerials.values()).sort(
      (a, b) => b.maxConfidence - a.maxConfidence
    );

    return sorted.slice(0, 3).map((item) => item.serial);
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}
