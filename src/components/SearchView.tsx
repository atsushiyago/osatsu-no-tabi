import { useState } from 'react';
import { Search, Compass, CheckCircle, AlertCircle } from 'lucide-react';
import { getBillBySerial } from '../services/billService';
import { prepareSerialSearch, runValidatedSerialSearch } from '../utils/serialSearch';
import { useSerialInput } from '../hooks/useSerialInput';
import { isDebugTiming } from '../utils/debug';

interface SearchViewProps {
  onBillFound: (serial: string) => void;
  onRegisterNew: (serial: string) => void;
}

export const SearchView = ({ onBillFound, onRegisterNew }: SearchViewProps) => {
  const {
    value: searchInput,
    setValue: setSearchInput,
    onChange: onSerialInputChange,
    onCompositionStart,
    onCompositionEnd,
    isComposing,
    validation,
  } = useSerialInput();
  const [isSearching, setIsSearching] = useState(false);
  const [searchedSerial, setSearchedSerial] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isComposing) return;

    const form = e.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem('serial') as HTMLInputElement | null;
    const rawInput = input?.value ?? searchInput;
    const request = prepareSerialSearch(rawInput);
    if (!request.serial) return;

    if (isDebugTiming()) console.debug('[Search Debug] serialIndex exact lookup requested');

    setNotFound(false);
    setSearchInput(request.serial);
    if (!request.isValid) {
      setSearchedSerial(null);
      return;
    }

    setIsSearching(true);
    setSearchedSerial(request.serial);

    try {
      const searchResult = await runValidatedSerialSearch(rawInput, getBillBySerial);
      if (searchResult.status === 'invalid') {
        setSearchedSerial(null);
        return;
      }

      const bill = searchResult.result;
      if (bill) {
        onBillFound(bill.id);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      console.error('Search failed:', err);
      setNotFound(true);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
          記番号を検索する
        </h2>
        <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
          紙幣に印字されたアルファベットと数字を入力してください。
        </p>
      </div>

      <form onSubmit={handleSearch} className="form-card" style={{ marginBottom: '20px' }}>
        <div className="form-group" style={{ marginBottom: '14px' }}>
          <label className="form-label" htmlFor="searchSerialInput">
            <span>記番号</span>
          </label>
          <div style={{ position: 'relative' }}>
            <input
              id="searchSerialInput"
              name="serial"
              type="text"
              className="text-input code-font"
              placeholder="例: AA123456B"
              value={searchInput}
              onChange={(e) => {
                onSerialInputChange(e.target.value);
                setNotFound(false);
              }}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={(e) => {
                onCompositionEnd(e.currentTarget.value);
                setNotFound(false);
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
          <p className="input-hint">全角・小文字でも自動変換します</p>
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
                <span>記番号の形式は正しいです</span>
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
          <span>{isSearching ? '検索中...' : 'このお札の旅を調べる'}</span>
        </button>
      </form>

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
            この記番号のお札は、このサービスにはまだ登録されていません。
          </h3>

          <p style={{ fontSize: '16px', color: '#494b46', lineHeight: 1.6, marginBottom: '18px' }}>
            入力した記番号を最初に登録して、旅の記録を始められます。
            <br />
            <strong>あなたが最初の発見者になりませんか？</strong>
          </p>

          <button
            className="btn-primary"
            onClick={() => onRegisterNew(searchedSerial)}
            id="btn-register-not-found"
          >
            <span>この記番号で最初の登録をする</span>
          </button>
        </div>
      )}

    </div>
  );
};
