import { useState, useEffect } from 'react';
import {
  Camera,
  Navigation,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import type { Denomination, RegisterResult } from '../types';
import {
  PREFECTURES,
  getCitiesByPrefecture,
  findNearestCity,
  type CityLocation,
} from '../utils/geo';
import {
  normalizeSerialNumber,
  validateSerialNumber,
  formatSerialDisplay,
} from '../utils/serial';
import { registerBillSighting } from '../services/billService';
import { checkSubmissionAllowed, recordSubmission } from '../utils/rateLimit';

interface RegisterViewProps {
  initialSerial?: string;
  onSuccess: (result: RegisterResult) => void;
  onCancel: () => void;
}

export const RegisterView = ({
  initialSerial = '',
  onSuccess,
  onCancel,
}: RegisterViewProps) => {
  const [denomination, setDenomination] = useState<Denomination>(1000);
  const [serialInput, setSerialInput] = useState(initialSerial);
  const [selectedPref, setSelectedPref] = useState('東京都');
  const [selectedCity, setSelectedCity] = useState('千代田区');
  const [userNote, setUserNote] = useState('');
  
  const [availableCities, setAvailableCities] = useState<CityLocation[]>([]);
  const [locating, setLocating] = useState(false);
  const [locatingMessage, setLocatingMessage] = useState<string | null>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 都道府県が変更されたら市区町村リストを更新
  useEffect(() => {
    const cities = getCitiesByPrefecture(selectedPref);
    setAvailableCities(cities);
    if (cities.length > 0 && !cities.some((c) => c.city === selectedCity)) {
      setSelectedCity(cities[0].city);
    }
  }, [selectedPref]);

  // GPS取得と市区町村代表座標への丸め込み
  const handleAutoLocate = () => {
    if (!navigator.geolocation) {
      alert('お使いの端末またはブラウザは位置情報取得に対応していません。');
      return;
    }

    setLocating(true);
    setLocatingMessage('位置情報を取得中（市区町村レベルに変換します）...');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // 正確なGPS座標は保持せず、直ちに最も近い市区町村に丸める
        const nearest = findNearestCity(latitude, longitude);
        setSelectedPref(nearest.pref);
        setSelectedCity(nearest.city);
        setLocating(false);
        setLocatingMessage(`最寄りの「${nearest.pref} ${nearest.city}」を設定しました`);
        setTimeout(() => setLocatingMessage(null), 4000);
      },
      (err) => {
        console.warn('Geolocation error:', err);
        setLocating(false);
        setLocatingMessage('位置情報の取得が許可されていないため、手動で選択してください');
        setTimeout(() => setLocatingMessage(null), 4000);
      },
      { timeout: 8000 }
    );
  };

  const normSerial = normalizeSerialNumber(serialInput);
  const validation = serialInput ? validateSerialNumber(serialInput) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // バリデーション
    const valResult = validateSerialNumber(serialInput);
    if (!valResult.isValid) {
      setErrorMessage(valResult.message || '記番号をご確認ください');
      return;
    }

    // 連投防止チェック
    const rateCheck = checkSubmissionAllowed(normSerial);
    if (!rateCheck.allowed) {
      setErrorMessage(rateCheck.reason || '短時間の重複登録は制限されています');
      return;
    }

    const currentCityObj = availableCities.find((c) => c.city === selectedCity) || {
      lat: 35.6895,
      lng: 139.6917,
    };

    setIsSubmitting(true);

    try {
      const result = await registerBillSighting({
        denomination,
        serialNumber: normSerial,
        prefecture: selectedPref,
        municipality: selectedCity,
        latitudeApprox: currentCityObj.lat,
        longitudeApprox: currentCityObj.lng,
        userNote,
      });

      // ローカルレートリミットに記録
      recordSubmission(normSerial);

      onSuccess(result);
    } catch (err: any) {
      console.error('Registration failed:', err);
      setErrorMessage(err?.message || '登録中にエラーが発生しました。再度お試しください。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ paddingBottom: '24px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
          お札を登録する
        </h2>
        <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
          手元にある紙幣の情報を入力して、旅路を記録しましょう。
        </p>
      </div>

      <form onSubmit={handleSubmit} className="form-card">
        {/* 額面選択 */}
        <div className="form-group">
          <label className="form-label">
            <span>1. 額面を選択</span>
            <span className="form-label-badge">必須</span>
          </label>
          <div className="denom-selector">
            {([1000, 5000, 10000] as Denomination[]).map((val) => (
              <button
                type="button"
                key={val}
                className={`denom-btn ${denomination === val ? 'active' : ''}`}
                onClick={() => setDenomination(val)}
                id={`denom-${val}`}
              >
                <div className="denom-yen">{val.toLocaleString()}円</div>
                <div className="denom-label">
                  {val === 1000 ? '千円札' : val === 5000 ? '五千円札' : '一万円札'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 記番号入力 */}
        <div className="form-group">
          <label className="form-label" htmlFor="serialInput">
            <span>2. 記番号を入力</span>
            <span className="form-label-badge">必須</span>
          </label>

          <input
            id="serialInput"
            type="text"
            className="text-input code-font"
            placeholder="例: AA123456B"
            value={serialInput}
            onChange={(e) => setSerialInput(e.target.value)}
            maxLength={12}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />

          {/* リアルタイム正規化プレビュー */}
          {serialInput && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '6px',
                fontSize: '12px',
                color: validation?.isValid ? '#059669' : '#dc2626',
              }}
            >
              {validation?.isValid ? (
                <>
                  <CheckCircle size={14} />
                  <span>
                    正規化記番号: <strong>{formatSerialDisplay(normSerial)}</strong>
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle size={14} />
                  <span>{validation?.message}</span>
                </>
              )}
            </div>
          )}

          <p className="input-hint">
            ※全角・半角・小文字は自動変換されます。ハイフンやスペースは不要です。
          </p>

          {/* 将来のOCRカメラ用プレースホルダー */}
          <div
            style={{
              marginTop: '10px',
              padding: '10px 14px',
              backgroundColor: '#f8fafc',
              border: '1px dashed #cbd5e1',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: '#64748b',
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Camera size={16} color="#94a3b8" />
              <span>カメラで自動読み取り (OCR)</span>
            </div>
            <span
              style={{
                fontSize: '10px',
                background: '#e2e8f0',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 600,
              }}
            >
              将来拡張スロット
            </span>
          </div>
        </div>

        {/* 現在地選択 */}
        <div className="form-group">
          <div className="form-label">
            <span>3. 現在の地域</span>
            <span className="form-label-badge">プライバシー保護済</span>
          </div>

          <button
            type="button"
            onClick={handleAutoLocate}
            disabled={locating}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              padding: '10px',
              marginBottom: '10px',
              backgroundColor: '#f0fdf4',
              color: '#166534',
              border: '1px solid #bbf7d0',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            id="btn-auto-locate"
          >
            <Navigation size={15} />
            <span>{locating ? '位置判定中...' : '現在地から市区町村を自動設定'}</span>
          </button>

          {locatingMessage && (
            <div
              style={{
                fontSize: '12px',
                color: '#2563eb',
                marginBottom: '10px',
                padding: '6px 10px',
                background: '#eff6ff',
                borderRadius: '6px',
              }}
            >
              {locatingMessage}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                都道府県
              </label>
              <select
                className="text-input"
                style={{ padding: '10px', fontSize: '14px' }}
                value={selectedPref}
                onChange={(e) => setSelectedPref(e.target.value)}
                id="select-pref"
              >
                {PREFECTURES.map((pref) => (
                  <option key={pref} value={pref}>
                    {pref}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                市区町村
              </label>
              <select
                className="text-input"
                style={{ padding: '10px', fontSize: '14px' }}
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                id="select-city"
              >
                {availableCities.map((c) => (
                  <option key={c.city} value={c.city}>
                    {c.city}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="input-hint" style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px' }}>
            <HelpCircle size={13} />
            <span>正確なGPS座標は一切保存・公開されず、市区町村の代表点として丸められます。</span>
          </p>
        </div>

        {/* 旅のひと言メモ（任意） */}
        <div className="form-group">
          <label className="form-label" htmlFor="userNote">
            <span>4. 旅のメモ・出会った場所（任意）</span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>任意</span>
          </label>
          <input
            id="userNote"
            type="text"
            className="text-input"
            placeholder="例: 駅前のカフェでお釣りとして受け取りました"
            value={userNote}
            onChange={(e) => setUserNote(e.target.value)}
            maxLength={60}
          />
        </div>

        {/* エラー表示 */}
        {errorMessage && (
          <div
            style={{
              padding: '12px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '10px',
              color: '#b91c1c',
              fontSize: '13px',
              marginBottom: '16px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            id="btn-submit-registration"
          >
            <Sparkles size={18} />
            <span>{isSubmitting ? '登録しています...' : 'お札の旅を登録する'}</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
};
