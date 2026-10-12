import { getAllowedSerialColors, type BanknoteDenomination, type BillSeries, type SerialColor } from '../data/banknoteVariants.ts';
import { validateBillIdentity } from './billIdentity.ts';

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
