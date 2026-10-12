import { BANKNOTE_VARIANTS } from '../data/banknoteVariants.ts';
import { createBillIdentityKey, validateBillIdentity } from './billIdentity.ts';
import { normalizeSerialNumber, validateSerialNumber } from './serial.ts';

/** Finite exact gets (3 F / 16 D-E), never an index query or listing. */
export function identitySearchKeys(raw: string): string[] {
  const serialNumber = normalizeSerialNumber(raw.normalize('NFKC'));
  if (!validateSerialNumber(serialNumber).isValid) throw new TypeError('invalid-serial');
  return BANKNOTE_VARIANTS.flatMap((variant) => {
    const result = validateBillIdentity({ ...variant, serialNumber });
    return result.isValid ? [createBillIdentityKey(result.identity)] : [];
  });
}

/** A failed get rejects the whole search rather than claiming a missing record. */
export async function readIdentityCandidates<T>(raw: string, read: (path: string) => Promise<T | null>): Promise<Awaited<T>[]> {
  const serial = normalizeSerialNumber(raw.normalize('NFKC'));
  const keys = identitySearchKeys(raw);
  const results = await Promise.all([...keys.map((key) => `billIdentityIndex/${key}`), `serialIndex/${serial}`].map(read));
  return results.filter((result): result is Awaited<T> => result !== null);
}

/** Both edits and newer requests invalidate late responses. */
export function createRequestVersion() {
  let version = 0;
  return { next: () => ++version, isCurrent: (request: number) => request === version };
}
