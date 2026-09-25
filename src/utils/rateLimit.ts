/**
 * クライアントサイドでの連投・いたずら防止ユーティリティ
 * - 同一記番号の短時間（例: 15分）再送信を制限
 * - 短時間の連続大量登録を抑止
 */

const STORAGE_KEY_RECENT_SUBMISSIONS = 'osatsu_recent_submissions';
const COOLDOWN_MINUTES = 15;

interface SubmissionRecord {
  serial: string;
  timestamp: number;
}

export function checkSubmissionAllowed(serial: string): {
  allowed: boolean;
  remainingMinutes?: number;
  reason?: string;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECENT_SUBMISSIONS);
    const records: SubmissionRecord[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

    // 期限切れレコードをパージ
    const validRecords = records.filter((r) => now - r.timestamp < cooldownMs);

    // 同一記番号がクールダウン期間内に登録されたかチェック
    const existing = validRecords.find((r) => r.serial === serial);
    if (existing) {
      const remainingMs = cooldownMs - (now - existing.timestamp);
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
      return {
        allowed: false,
        remainingMinutes,
        reason: `この端末から同一のお札記番号（${serial}）が直近に登録されています。短時間の重複送信を防ぐため、あと約${remainingMinutes}分お待ちください。`,
      };
    }

    // 1時間以内に10件以上の連続登録がある場合の簡易レートリミット
    if (validRecords.length >= 10) {
      return {
        allowed: false,
        reason: '短時間に多数のお札が登録されています。少し時間をおいてから再度お試しください。',
      };
    }

    return { allowed: true };
  } catch {
    // LocalStorage使えない場合はスルー
    return { allowed: true };
  }
}

export function recordSubmission(serial: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECENT_SUBMISSIONS);
    const records: SubmissionRecord[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

    const validRecords = records.filter((r) => now - r.timestamp < cooldownMs);
    validRecords.push({ serial, timestamp: now });

    localStorage.setItem(STORAGE_KEY_RECENT_SUBMISSIONS, JSON.stringify(validRecords));
  } catch (err) {
    console.error('Failed to update local rate limit store:', err);
  }
}
