import { getAllowedSerialColors, type BanknoteDenomination, type BillSeries, type SerialColor } from '../data/banknoteVariants.ts';
import { getBillSeriesCandidates, validateBillIdentity } from './billIdentity.ts';
import { normalizeSerialNumber } from './serial.ts';

export interface IdentitySelection {
  denomination: BanknoteDenomination;
  series: BillSeries | null;
  serialColor: SerialColor | null;
}
export function changeIdentityDesign(denomination: BanknoteDenomination, series: BillSeries | null): IdentitySelection {
  if (denomination === 2000) return { denomination, series: 'D', serialColor: 'black' };
  const colors = getAllowedSerialColors(series, denomination);
  // Only unambiguous, explicitly selected designs receive an automatic ink color.
  return { denomination, series, serialColor: colors.length === 1 ? colors[0] : null };
}
export function selectionIdentity(selection: IdentitySelection, serialNumber: string) {
  return validateBillIdentity({ ...selection, serialNumber });
}

/** Registration UI inference only; canonical validation/keys stay unchanged. */
export function resolveIdentitySelection(selection: IdentitySelection, serialNumber: string, composing = false): IdentitySelection {
  if (selection.denomination === 2000) return changeIdentityDesign(2000, 'D');
  if (!composing && getBillSeriesCandidates(serialNumber, selection.denomination).join() === 'F') {
    return { denomination: selection.denomination, series: 'F', serialColor: 'black' };
  }
  // An inferred F never becomes a remembered manual design when input is edited.
  return selection.series === 'F' ? changeIdentityDesign(selection.denomination, null) : selection;
}

export function identityInputSignature(denomination: BanknoteDenomination, serial: string): string {
  return JSON.stringify([denomination, normalizeSerialNumber(serial.normalize('NFKC'))]);
}
export function registrationIdentityStage(selection: IdentitySelection, serial: string, confirmedSignature: string | null, editing = false, composing = false) {
  const empty: IdentitySelection = { denomination: selection.denomination, series: null, serialColor: null };
  const candidates = getBillSeriesCandidates(serial, selection.denomination);
  if (composing || !candidates.length) return { stage: 'input' as const, selection: empty };
  if (editing || confirmedSignature !== identityInputSignature(selection.denomination, serial)) return { stage: 'confirm' as const, selection: empty };
  const resolved = resolveIdentitySelection(selection, serial);
  if (resolved.series === 'F' || selection.denomination === 2000) return { stage: 'automatic' as const, selection: resolved };
  if (!candidates.includes(resolved.series as BillSeries)) return { stage: 'design' as const, selection: empty };
  const colors = getAllowedSerialColors(resolved.series, resolved.denomination);
  return { stage: 'color' as const, selection: { ...resolved, serialColor: colors.includes(resolved.serialColor as SerialColor) ? resolved.serialColor : null } };
}
