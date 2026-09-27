/**
 * 日本円紙幣の記番号正規化および検証ユーティリティ
 */

export function normalizeSerialNumber(input: string): string {
  if (!input) return '';

  // 全角英数字を半角に変換
  let normalized = input.replace(/[！-～]/g, (s) => {
    return String.fromCharCode(s.charCodeAt(0) - 0xfee0);
  });

  // 全角スペースや制御文字、ハイフン、空白を除去
  normalized = normalized.replace(/[\s\-\u3000]/g, '');

  // 英大文字に統一
  normalized = normalized.toUpperCase();

  return normalized;
}

/** Normalize interactive serial input without changing validation rules. */
export function normalizeSerialInput(input: string): string {
  return normalizeSerialNumber(input.normalize('NFKC')).replace(/[^A-Z0-9]/g, '');
}

/**
 * 日本の紙幣記番号のフォーマットチェック
 * 主なパターン:
 * 1. [A-HJ-NP-Z]{1,2}\d{6}[A-HJ-NP-Z] (従来券)
 * 2. [A-HJ-NP-Z]{2}\d{6}[A-HJ-NP-Z]{2} (2024年発行開始券)
 * 例:
 * - AA123456B
 * - A123456B
 * - AA123456BB
 * - A123456A
 */
export function validateSerialNumber(serial: string): {
  isValid: boolean;
  message?: string;
} {
  const norm = normalizeSerialNumber(serial);

  if (!norm) {
    return { isValid: false, message: '記番号を入力してください' };
  }

  const parts = norm.match(/^([A-Z]{1,2})([0-9]{6})([A-Z]{1,2})$/);
  const examples = '例：AA123456BB（新紙幣） / A123456B・AA123456B（従来券）';
  if (!parts) return { isValid: false, message: `記番号の形式を確認してください。${examples}` };

  if (/[IO]/.test(parts[1] + parts[3])) {
    return { isValid: false, message: '記番号の英字には I（アイ）と O（オー）は使われません' };
  }

  const [, prefix, digits, suffix] = parts;
  const isLegacy = prefix.length >= 1 && prefix.length <= 2 && suffix.length === 1;
  const isNew = prefix.length === 2 && suffix.length === 2;
  if (!isLegacy && !isNew) {
    return { isValid: false, message: `記番号の形式を確認してください。${examples}` };
  }

  const serialNumber = Number(digits);
  if (serialNumber < 1 || serialNumber > 900000) {
    return { isValid: false, message: '記番号の数字部分は000001〜900000です' };
  }

  return { isValid: true };
}

/**
 * 将来的なプライバシー保護や不可逆検索用のハッシュ生成スロット
 * 将来Firestoreで直接生記番号を保存せずハッシュ化したい場合に使用
 */
export async function hashSerialNumber(serial: string): Promise<string> {
  const norm = normalizeSerialNumber(serial);
  const encoder = new TextEncoder();
  const data = encoder.encode(norm);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 表示用の記番号フォーマット（例: "AA 123456 B" のように読みやすくする）
 */
export function formatSerialDisplay(serial: string): string {
  const norm = normalizeSerialNumber(serial);
  const match = norm.match(/^([A-HJ-NP-Z]{1,2})([0-9]{6})([A-HJ-NP-Z]{1,2})$/);
  if (!match) return norm;
  if (match[1].length === 1 && match[3].length !== 1) return norm;
  if (match[1].length === 2 && match[3].length === 2) {
    const value = Number(match[2]);
    if (value < 1 || value > 900000) return norm;
  } else if (match[1].length === 2 || match[3].length !== 1) return norm;
  if (Number(match[2]) < 1 || Number(match[2]) > 900000) return norm;
  return `${match[1]} ${match[2]} ${match[3]}`;
}
