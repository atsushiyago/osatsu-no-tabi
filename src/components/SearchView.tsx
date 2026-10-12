import { useEffect, useRef, useState } from 'react';
import { Search, Compass, CheckCircle, AlertCircle } from 'lucide-react';
import { getBillBySerial } from '../services/billService';
import { prepareSerialSearch, runValidatedSerialSearch } from '../utils/serialSearch';
import { useSerialInput } from '../hooks/useSerialInput';
import { isDebugTiming } from '../utils/debug';
import { useI18n } from '../useI18n';

import { isIdentityV2Enabled } from '../services/firebase';
import { searchBillIdentities, type IdentityCandidate } from '../services/billIdentityUiService';
import { BANKNOTE_VARIANT_LABELS } from '../data/banknoteVariants';
import { createRequestVersion } from '../utils/identitySearch';
import type { TranslationKey } from '../i18n';

interface SearchViewProps {
  onBillFound: (serial: string) => void;
  onRegisterNew: (serial: string) => void;
}

export const SearchView = ({ onBillFound, onRegisterNew }: SearchViewProps) => {
  const { language, t, number, yen } = useI18n();
  const {
    value: searchInput,
    setValue: setSearchInput,
    onChange: onSerialInputChange,
    onCompositionStart,
    onCompositionEnd,
    isComposing,
    validation,
  } = useSerialInput('', language);
  const [isSearching, setIsSearching] = useState(false);
  const [searchedSerial, setSearchedSerial] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [candidates, setCandidates] = useState<IdentityCandidate[]>([]);
  const [searchError, setSearchError] = useState<TranslationKey | null>(null);
  const requests = useRef(createRequestVersion());
  useEffect(() => () => { requests.current.next(); }, []);
  const invalidateSearch = () => {
    requests.current.next(); setCandidates([]); setSearchError(null); setNotFound(false);
    setSearchedSerial(null); setIsSearching(false);
  };


  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isComposing) return;

    const form = e.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem('serial') as HTMLInputElement | null;
    const rawInput = input?.value ?? searchInput;
    const request = prepareSerialSearch(rawInput);
    if (!request.serial) return;

    if (isDebugTiming()) console.debug('[Search Debug] serialIndex exact lookup requested');

    const requestVersion = requests.current.next();
    setNotFound(false); setCandidates([]); setSearchError(null);
    setSearchInput(request.serial);
    if (!request.isValid) {
      setSearchedSerial(null);
      return;
    }

    setIsSearching(true);
    setSearchedSerial(request.serial);

    try {
      if (isIdentityV2Enabled) {
        const matches = await searchBillIdentities(request.serial);
        if (requests.current.isCurrent(requestVersion)) { setCandidates(matches); setNotFound(matches.length === 0); }
        return;
      }
      const searchResult = await runValidatedSerialSearch(rawInput, getBillBySerial);
      if (searchResult.status === 'invalid') {
        setSearchedSerial(null);
        return;
      }

      if (!requests.current.isCurrent(requestVersion)) return;
      const bill = searchResult.result;
      if (bill) {
        onBillFound(bill.id);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      console.error('Search failed:', (err as { code?: string }).code ?? 'unknown');
      if (requests.current.isCurrent(requestVersion)) {
        const code = (err as { code?: string }).code;
        setSearchError(code === 'invalid-connection' ? 'identityConfigError' : code === 'permission-denied' ? 'identitySearchDenied' : code === 'emulator-unavailable' || code === 'emulator-only' ? 'identityUnavailable' : 'identitySearchError');
      }
    } finally {
      if (requests.current.isCurrent(requestVersion)) setIsSearching(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
          {t('searchHeading')}
        </h2>
        <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
          {t('searchDescription')}
        </p>
      </div>

      <form onSubmit={handleSearch} className="form-card" style={{ marginBottom: '20px' }}>
        <div className="form-group" style={{ marginBottom: '14px' }}>
          <label className="form-label" htmlFor="searchSerialInput">
            <span>{t('serialLabel')}</span>
          </label>
          <div style={{ position: 'relative' }}>
            <input
              id="searchSerialInput"
              name="serial"
              type="text"
              className="text-input code-font"
              placeholder={t('serialPlaceholder')}
              value={searchInput}
              onChange={(e) => {
                onSerialInputChange(e.target.value);
                invalidateSearch();
              }}
              onCompositionStart={() => { onCompositionStart(); invalidateSearch(); }}
              onCompositionEnd={(e) => {
                onCompositionEnd(e.currentTarget.value);
                invalidateSearch();
              }}
              maxLength={12}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
            />
          </div>
          <p className="input-hint">
            {t('serialHelp')}<br />
            {t('serialExamples')}
          </p>
          {searchInput && validation && (
            <div
              aria-live="polite"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginTop: '6px',
                fontSize: '12px',
                color: validation.isValid ? '#059669' : '#dc2626',
              }}
            >
              {validation.isValid ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
              {validation.isValid ? (
                <span>{t('serialValid')}</span>
              ) : (
                <span>{validation.message}</span>
              )}
            </div>
          )}
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={!validation?.isValid || isComposing || isSearching}
          id="btn-execute-search"
        >
          <Search size={18} />
          <span>{isSearching ? t('searching') : t('executeSearch')}</span>
        </button>
      </form>

      {searchError && <p role="alert" className="identity-notice">{t(searchError)}</p>}
      {isIdentityV2Enabled && candidates.length > 0 && <section aria-label={t('identitySearchResults', { count: number(candidates.length) })}>
        <h3>{t('identitySearchResults', { count: number(candidates.length) })}</h3>
        <p className="input-hint">{t('identitySearchHint')}</p>
        <div className="identity-candidates">{candidates.map(({ bill, legacy }) => <article className="identity-candidate" key={bill.id}>
          <strong>{t('yenBill', { amount: language === 'ja' ? number(bill.denomination) : yen(bill.denomination) })}</strong>
          <p>{legacy ? t('identityLegacy') : `${bill.series ? BANKNOTE_VARIANT_LABELS[language].series[bill.series] : t('unknown')} · ${bill.serialColor ? BANKNOTE_VARIANT_LABELS[language].colors[bill.serialColor] : t('unknown')}`}</p>
          <p>{t('journeyBill', { id: bill.id.slice(-4).toUpperCase() })}</p>
          <button type="button" className="btn-secondary" onClick={() => onBillFound(bill.id)}>{t('identityView')}</button>
        </article>)}</div>
        <button type="button" className="btn-primary" style={{ marginTop: 16 }} onClick={() => searchedSerial && onRegisterNew(searchedSerial)}>{t('registerBill')}</button>
      </section>}

      {/* 検索結果なしの場合 */}
      {notFound && searchedSerial && (
        <div
          style={{
            backgroundColor: '#fbf9f3',
            border: '1.5px solid #d8d1c4',
            borderRadius: '6px',
            padding: '20px',
            textAlign: 'center',
            marginBottom: '24px',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: '#f8ebe7',
              color: '#9f3b2f',
              marginBottom: '12px',
            }}
          >
            <Compass size={24} />
          </div>

          <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#282a27', marginBottom: '8px' }}>
            {t('notFoundHeading')}
          </h3>

          <p style={{ fontSize: '16px', color: '#494b46', lineHeight: 1.6, marginBottom: '18px' }}>
            {t('notFoundText')}
            <br />
            <strong>{t('firstDiscoverer')}</strong>
          </p>

          <button
            className="btn-primary"
            onClick={() => onRegisterNew(searchedSerial)}
            id="btn-register-not-found"
          >
            <span>{t('registerThisSerial')}</span>
          </button>
        </div>
      )}

    </div>
  );
};
