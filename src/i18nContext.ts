import { createContext } from 'react';
import type { Language, TranslationKey } from './i18n';

export type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  number: (value: number) => string;
  date: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  yen: (value: number) => string;
};

export const I18nContext = createContext<I18nContextValue | null>(null);
