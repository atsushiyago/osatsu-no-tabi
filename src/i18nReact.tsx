import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDate, formatNumber, formatYen, getInitialLanguage, LANGUAGE_STORAGE_KEY, saveLanguagePreference, translate, type Language } from './i18n';
import { I18nContext, type I18nContextValue } from './i18nContext';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setCurrentLanguage] = useState<Language>(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LANGUAGE_STORAGE_KEY); } catch { /* Fall back to browser language. */ }
    return getInitialLanguage(saved, typeof navigator === 'undefined' ? null : navigator.language);
  });
  const setLanguage = (next: Language) => {
    setCurrentLanguage(next);
    try { saveLanguagePreference(localStorage, next); } catch { /* Keep current session usable. */ }
  };
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = translate(language, 'appTitle');
    document.querySelector('meta[name="description"]')?.setAttribute('content', translate(language, 'appDescription'));
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', translate(language, 'appTitle'));
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', translate(language, 'appDescription'));
  }, [language]);
  const value = useMemo<I18nContextValue>(() => ({
    language, setLanguage, t: (key, values) => translate(language, key, values),
    number: (value) => formatNumber(language, value), date: (value, options) => formatDate(language, value, options),
    yen: (value) => formatYen(language, value),
  }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
