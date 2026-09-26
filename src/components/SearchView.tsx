import { useRef, useState } from 'react';
import { Search, Compass, ArrowRight } from 'lucide-react';
import { getBillBySerial } from '../services/billService';
import { normalizeSerialInput, formatSerialDisplay } from '../utils/serial';
import { runValidatedSerialSearch } from '../utils/serialSearch';
import { isDebugTiming } from '../utils/debug';

interface SearchViewProps {
  onBillFound: (serial: string) => void;
  onRegisterNew: (serial: string) => void;
}

export const SearchView = ({ onBillFound, onRegisterNew }: SearchViewProps) => {
  const [searchInput, setSearchInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchedSerial, setSearchedSerial] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const isComposing = useRef(false);

  const normSerial = normalizeSerialInput(searchInput);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem('serial') as HTMLInputElement | null;
    const rawInput = input?.value ?? searchInput;
    const normalizedSerial = normalizeSerialInput(rawInput);
    if (!normalizedSerial) return;

    if (isDebugTiming()) {
      console.debug('[Search Debug] raw input=', rawInput);
      console.debug('[Search Debug] normalized input=', normalizedSerial);
      console.debug('[Search Debug] search serial=', normalizedSerial);
      console.debug('[Search Debug] target document ID=', normalizedSerial);
    }

    setNotFound(false);
    setIsSearching(true);
    setValidationError(null);
    setSearchInput(normalizedSerial);
    setSearchedSerial(normalizedSerial);

    try {
      const searchResult = await runValidatedSerialSearch(rawInput, getBillBySerial);
      if (searchResult.status === 'invalid') {
        setValidationError(searchResult.request.validationMessage ?? '記番号の形式を確認してください。');
        setSearchedSerial(null);
        return;
      }

      const { serial } = searchResult.request;
      const bill = searchResult.result;
      if (bill) {
        onBillFound(serial);
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

  const handleSampleClick = (serial: string) => {
    setSearchInput(serial);
    onBillFound(serial);
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
                setSearchInput(isComposing.current ? e.target.value : normalizeSerialInput(e.target.value));
                setNotFound(false);
                setValidationError(null);
              }}
              onCompositionStart={() => { isComposing.current = true; }}
              onCompositionEnd={(e) => {
                isComposing.current = false;
                setSearchInput(normalizeSerialInput(e.currentTarget.value));
                setNotFound(false);
                setValidationError(null);
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
          {searchInput && (
            <p className="input-hint">
              検索キー: <strong>{formatSerialDisplay(normSerial)}</strong>
            </p>
          )}
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={!normSerial || isSearching}
          id="btn-execute-search"
        >
          <Search size={18} />
          <span>{isSearching ? '検索中...' : 'このお札の旅を調べる'}</span>
        </button>
      </form>

      {validationError && (
        <p role="alert" style={{ color: '#9f3b2f', fontSize: '14px', margin: '-8px 0 20px' }}>
          {validationError}
        </p>
      )}

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
            記番号「{formatSerialDisplay(searchedSerial)}」を最初に登録して、旅の記録を始められます。
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

      {/* サンプル記番号ですぐ試す */}
      <div style={{ marginTop: '24px' }}>
        <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', marginBottom: '10px' }}>
          登録済みのお札のサンプルを見てみる:
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleSampleClick('AA123456B')}
            style={{ justifyContent: 'space-between', padding: '12px 14px', fontSize: '13px' }}
          >
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 800, fontFamily: 'monospace' }}>AA 123456 B</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>千円札 / 4回発見 (大和→新宿→名古屋→京都)</div>
            </div>
            <ArrowRight size={16} color="#64748b" />
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleSampleClick('BC987654A')}
            style={{ justifyContent: 'space-between', padding: '12px 14px', fontSize: '13px' }}
          >
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 800, fontFamily: 'monospace' }}>BC 987654 A</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>一万円札 / 2回発見 (福岡→札幌・長距離)</div>
            </div>
            <ArrowRight size={16} color="#64748b" />
          </button>
        </div>
      </div>
    </div>
  );
};
