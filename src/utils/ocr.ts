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
 * 補正可能かどうかを判定し、可能であれば補正後の文字列と補正文字数を返す
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
function cleanOcrText(input: string): string {
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
  // 例: "AA123456A and BB987654C" -> "AA123456A", "BB987654C"
  const isolatedExactRegex = /(?:^|[^A-Z0-9])([A-Z]{1,2}[0-9]{6}[A-Z]{1,2})(?:$|[^A-Z0-9])/g;
  let match: RegExpExecArray | null;
  while ((match = isolatedExactRegex.exec(cleanedText)) !== null) {
    const candidate = match[1];
    if (validateSerialNumber(candidate).isValid) {
      addCandidate({ serial: candidate, corrections: 0 });
    }
  }

  // 2. 単語（空白・改行区切り）単位の検証 & 誤認識補正 (O/0, I/1, S/5, B/8, Z/2)
  // 不要な記号を両端からトリムした上で評価
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
  // 例: "AA 123456 B", "A-123 456-A", "AA 123456\nB"
  // 空白・ハイフン区切りの連続する塊を結合して評価
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
 * ブラウザメモリ内（Canvas）で画像をOCR向けにリサイズ＆前処理する
 * - 最大長辺を1400pxにリサイズ（速度・精度の両立）
 * - グレースケール化
 * - コントラスト強調（記番号文字のエッジを際立たせる）
 */
export async function preprocessImage(imageFile: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(imageFile);

    img.onload = () => {
      try {
        // オブジェクトURLは直ちに解放
        URL.revokeObjectURL(objectUrl);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject(new Error('Canvas 2D context not available'));
          return;
        }

        const maxDimension = 1400;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // ピクセル操作: グレースケール化 + コントラスト強調
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const contrastFactor = 1.35; // コントラストを35%強調

        for (let i = 0; i < data.length; i += 4) {
          // グレースケール計算 (Rec. 601)
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          // コントラスト調整: ((gray / 255 - 0.5) * factor + 0.5) * 255
          const adjusted = Math.min(255, Math.max(0, ((gray - 128) * contrastFactor) + 128));
          data[i] = adjusted;
          data[i + 1] = adjusted;
          data[i + 2] = adjusted;
          // Alpha は維持 (data[i + 3])
        }

        ctx.putImageData(imageData, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas toBlob conversion failed'));
            }
          },
          'image/jpeg',
          0.9
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image file for OCR: ' + e));
    };

    img.src = objectUrl;
  });
}

/**
 * 端末内OCR実行関数
 * - dynamic import で tesseract.js を遅延ロード
 * - 外部サーバーへの画像アップロードは一切行わない
 * - 英数字ホワイトリスト指定
 * - debug=timing 時の計測ログ出力
 */
export async function recognizeBanknoteSerialFromImage(
  imageFile: File,
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

  onProgress?.('画像を前処理中...');
  let processedBlob: Blob | null = null;
  try {
    processedBlob = await preprocessImage(imageFile);
  } catch (err) {
    console.warn('Preprocessing failed, fallback to original image:', err);
    processedBlob = imageFile;
  }

  onProgress?.('記番号を認識中...');

  const processStartTime = isDebugTiming ? performance.now() : 0;
  let worker: any = null;

  try {
    worker = await createWorker('eng');

    // 記番号の対象文字（英大文字＋数字）のみにホワイトリストを制限
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    });

    const ret = await worker.recognize(processedBlob);
    const rawText = ret.data.text || '';

    if (isDebugTiming) {
      const processDuration = performance.now() - processStartTime;
      console.log(
        `%c[Timing Monitor] OCR Load: ${loadTime.toFixed(0)}ms | Process: ${processDuration.toFixed(0)}ms`,
        'background: #7c3aed; color: #fff; font-weight: bold; padding: 2px 6px; border-radius: 4px;'
      );
    }

    // 候補の抽出と誤認識補正
    const candidates = extractSerialCandidates(rawText, 3);
    return candidates;
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}
