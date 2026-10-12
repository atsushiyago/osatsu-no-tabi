import type { Language } from '../i18n.ts';

// Kept separate from the live app's Denomination until v2 registration is introduced.
export type BanknoteDenomination = 1000 | 2000 | 5000 | 10000;
export type BillSeries = 'D' | 'E' | 'F';
export type SerialColor = 'black' | 'brown' | 'blue' | 'darkgreen' | 'navy';

export interface BanknoteVariant {
  denomination: BanknoteDenomination;
  series: BillSeries;
  serialColor: SerialColor;
}

// National Printing Bureau: denominations, designs and serial-number ink colors.
// https://www.npb.go.jp/product_service/intro/kihon.html
// https://www.npb.go.jp/product_service/intro/faq.html
// This catalog does not assert that every valid serial was issued in every color.
const catalog = [
  { series: 'D', denomination: 1000, colors: ['black', 'blue', 'brown', 'darkgreen'] },
  { series: 'D', denomination: 2000, colors: ['black'] },
  { series: 'D', denomination: 5000, colors: ['black', 'brown'] },
  { series: 'D', denomination: 10000, colors: ['black', 'brown'] },
  { series: 'E', denomination: 1000, colors: ['black', 'brown', 'navy'] },
  { series: 'E', denomination: 5000, colors: ['black', 'brown'] },
  { series: 'E', denomination: 10000, colors: ['black', 'brown'] },
  { series: 'F', denomination: 1000, colors: ['black'] },
  { series: 'F', denomination: 5000, colors: ['black'] },
  { series: 'F', denomination: 10000, colors: ['black'] },
] as const;

export const BANKNOTE_VARIANTS: readonly Readonly<BanknoteVariant>[] = Object.freeze(
  catalog.flatMap(({ series, denomination, colors }) => colors.map((serialColor) =>
    Object.freeze({ series, denomination, serialColor }),
  )),
);

export function isBanknoteDenomination(value: unknown): value is BanknoteDenomination {
  return value === 1000 || value === 2000 || value === 5000 || value === 10000;
}

export function isBillSeries(value: unknown): value is BillSeries {
  return value === 'D' || value === 'E' || value === 'F';
}

export function isSerialColor(value: unknown): value is SerialColor {
  return value === 'black' || value === 'brown' || value === 'blue'
    || value === 'darkgreen' || value === 'navy';
}

export function getAllowedSerialColors(
  series: unknown,
  denomination: unknown,
): readonly SerialColor[] {
  return BANKNOTE_VARIANTS
    .filter((variant) => variant.series === series && variant.denomination === denomination)
    .map((variant) => variant.serialColor);
}

export function isAllowedBanknoteVariant(
  denomination: unknown,
  series: unknown,
  serialColor: unknown,
): boolean {
  return BANKNOTE_VARIANTS.some((variant) => variant.denomination === denomination
    && variant.series === series && variant.serialColor === serialColor);
}

interface VariantLabels {
  series: Record<BillSeries, string>;
  colors: Record<SerialColor, string>;
  denominations: Record<BanknoteDenomination, string>;
}

// Labels are for display only; identity keys always use the stable codes above.
export const BANKNOTE_VARIANT_LABELS = {
  ja: {
    series: { D: 'D券', E: 'E券', F: 'F券' },
    colors: { black: '黒色', brown: '褐色', blue: '青色', darkgreen: '暗緑色', navy: '紺色' },
    denominations: { 1000: '千円札', 2000: '二千円札', 5000: '五千円札', 10000: '一万円札' },
  },
  en: {
    series: { D: 'Series D', E: 'Series E', F: 'Series F' },
    colors: { black: 'Black', brown: 'Brown', blue: 'Blue', darkgreen: 'Dark green', navy: 'Navy blue' },
    denominations: { 1000: '¥1,000 banknote', 2000: '¥2,000 banknote', 5000: '¥5,000 banknote', 10000: '¥10,000 banknote' },
  },
} as const satisfies Record<Language, VariantLabels>;
