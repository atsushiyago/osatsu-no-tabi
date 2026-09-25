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
 * 1. [A-Z]{1,2}\d{6}[A-Z]{1,2} (現行新札および歴代日銀券)
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

  if (norm.length < 8 || norm.length > 10) {
    return {
      isValid: false,
      message: '記番号は通常8〜10文字です（例: AA123456B または A123456B）',
    };
  }

  // 正規表現: アルファベット1〜2文字 + 数字6桁 + アルファベット1〜2文字
  const regex = /^[A-Z]{1,2}[0-9]{6}[A-Z]{1,2}$/;
  if (!regex.test(norm)) {
    return {
      isValid: false,
      message: '記番号の形式が正しくありません（例: AA123456B, A123456B, AA123456BB）',
    };
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
  const match = norm.match(/^([A-Z]{1,2})([0-9]{6})([A-Z]{1,2})$/);
  if (!match) return norm;
  return `${match[1]} ${match[2]} ${match[3]}`;
}
