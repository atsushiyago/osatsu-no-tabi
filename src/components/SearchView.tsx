import { useState } from 'react';
import { Search, Compass, ArrowRight } from 'lucide-react';
import { getBillBySerial } from '../services/billService';
import { normalizeSerialNumber, formatSerialDisplay } from '../utils/serial';

interface SearchViewProps {
  onBillFound: (serial: string) => void;
  onRegisterNew: (serial: string) => void;
}

export const SearchView = ({ onBillFound, onRegisterNew }: SearchViewProps) => {
  const [searchInput, setSearchInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchedSerial, setSearchedSerial] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const normSerial = normalizeSerialNumber(searchInput);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!normSerial) return;

    setIsSearching(true);
    setNotFound(false);
    setSearchedSerial(normSerial);

    try {
      const bill = await getBillBySerial(normSerial);
      if (bill) {
        onBillFound(normSerial);
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
              type="text"
              className="text-input code-font"
              placeholder="例: AA123456B"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setNotFound(false);
              }}
              maxLength={12}
              autoCapitalize="characters"
              autoComplete="off"
            />
          </div>
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
            このお札はまだ登録されていません
          </h3>

          <p style={{ fontSize: '16px', color: '#494b46', lineHeight: 1.6, marginBottom: '18px' }}>
            記番号「{formatSerialDisplay(searchedSerial)}」はまだ誰も見つけていない新しいお札です。
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
