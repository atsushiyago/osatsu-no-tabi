import {
  getAllowedSerialColors,
  isAllowedBanknoteVariant,
  isBanknoteDenomination,
  isBillSeries,
  isSerialColor,
  type BanknoteVariant,
  type BillSeries,
} from '../data/banknoteVariants.ts';
import { normalizeSerialNumber, validateSerialNumber } from './serial.ts';

export interface BillIdentity extends BanknoteVariant {
  serialNumber: string;
}

export type BillIdentityErrorCode = 'invalid-input' | 'unknown-denomination'
  | 'unknown-series' | 'unknown-color' | 'unsupported-variant'
  | 'invalid-serial' | 'serial-series-mismatch';

export type BillIdentityValidation =
  | { isValid: true; identity: BillIdentity }
  | { isValid: false; code: BillIdentityErrorCode };

function normalizeIdentitySerial(value: string): string {
  // Do not discard arbitrary punctuation: a corrupt serial must remain invalid.
  return normalizeSerialNumber(value.normalize('NFKC'));
}

/** Possible supported designs, not a determination of the physical banknote. */
export function getBillSeriesCandidates(
  serialNumber: unknown,
  denomination?: unknown,
): readonly BillSeries[] {
  if (typeof serialNumber !== 'string') return [];
  if (denomination !== undefined && !isBanknoteDenomination(denomination)) return [];
  const serial = normalizeIdentitySerial(serialNumber);
  if (!validateSerialNumber(serial).isValid) return [];
  const candidates: BillSeries[] = /^[A-HJ-NP-Z]{2}[0-9]{6}[A-HJ-NP-Z]{2}$/.test(serial)
    ? ['F'] : ['D', 'E'];
  return denomination === undefined ? candidates : candidates.filter((series) =>
    getAllowedSerialColors(series, denomination).length > 0,
  );
}

/** Validate untrusted input without filling in missing series or ink colors. */
export function validateBillIdentity(input: unknown): BillIdentityValidation {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { isValid: false, code: 'invalid-input' };
  }
  const { denomination, series, serialColor, serialNumber } = input as Record<string, unknown>;
  if (!isBanknoteDenomination(denomination)) return { isValid: false, code: 'unknown-denomination' };
  if (!isBillSeries(series)) return { isValid: false, code: 'unknown-series' };
  if (!isSerialColor(serialColor)) return { isValid: false, code: 'unknown-color' };
  if (!isAllowedBanknoteVariant(denomination, series, serialColor)) {
    return { isValid: false, code: 'unsupported-variant' };
  }
  if (typeof serialNumber !== 'string') return { isValid: false, code: 'invalid-serial' };
  const normalizedSerial = normalizeIdentitySerial(serialNumber);
  if (!validateSerialNumber(normalizedSerial).isValid) return { isValid: false, code: 'invalid-serial' };
  if (!getBillSeriesCandidates(normalizedSerial, denomination).includes(series)) {
    return { isValid: false, code: 'serial-series-mismatch' };
  }
  return {
    isValid: true,
    identity: { denomination, series, serialColor, serialNumber: normalizedSerial },
  };
}

/** Invalid or incomplete identities cannot produce a shared lookup key. */
export function createBillIdentityKey(input: unknown): string {
  const result = validateBillIdentity(input);
  if (result.isValid === false) throw new TypeError(`Invalid bill identity: ${result.code}`);
  const { denomination, series, serialColor, serialNumber } = result.identity;
  return `v2_JPY_${denomination}_${series}_${serialColor}_${serialNumber}`;
}

/** Parse only canonical keys; do not silently normalize malformed stored keys. */
export function parseBillIdentityKey(key: unknown): BillIdentity | null {
  if (typeof key !== 'string') return null;
  const parts = key.match(/^v2_JPY_(1000|2000|5000|10000)_([DEF])_(black|brown|blue|darkgreen|navy)_([A-Z0-9]+)$/);
  if (!parts) return null;
  const result = validateBillIdentity({
    denomination: Number(parts[1]), series: parts[2], serialColor: parts[3], serialNumber: parts[4],
  });
  if (result.isValid === false || createBillIdentityKey(result.identity) !== key) return null;
  return result.identity;
}

export function isValidBillIdentityKey(key: unknown): boolean {
  return parseBillIdentityKey(key) !== null;
}
