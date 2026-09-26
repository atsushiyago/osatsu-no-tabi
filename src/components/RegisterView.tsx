import { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Navigation,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Lock,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { Denomination, RegisterResult, BillWithSightings } from '../types';
import { useSerialInput } from '../hooks/useSerialInput';
import { recognizeBanknoteSerialFromImage, analyzeBlobStats, type OcrSerialCandidate } from '../utils/ocr.ts';
import { CropModal, type CropMetadata } from './CropModal';
import { OcrDebugPanel, type OcrDebugData } from './OcrDebugPanel';
import { isDebugTiming } from '../utils/debug';
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
import {
  registerBillSighting,
  getBillBySerial,
  initializeLegacyBillCooldown,
  RegistrationRateLimitError,
} from '../services/billService';
import { trackFirstRegisteredBill } from '../services/trackedBills';

const BILL_COOLDOWN_MS = 15 * 60 * 1000;

function getTimestampMillis(value: BillWithSightings['lastSightedAtServer']): number | null {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return value?.toMillis() ?? null;
}

function getCooldownRemainingMs(bill: BillWithSightings): number {
  const lastSeenMs = getTimestampMillis(bill.lastSightedAtServer) ?? Date.parse(bill.lastSightedAt);
  return Math.max(0, BILL_COOLDOWN_MS - (Date.now() - lastSeenMs));
}

function cooldownMessage(remainingMs: number): string {
  const minutes = Math.ceil(remainingMs / 60_000);
  return `このお札はついさっき登録されています。あと約${minutes}分で再登録できます。`;
}

interface RegisterViewProps {
  initialSerial?: string;
  userUid?: string | null;
  onSuccess: (result: RegisterResult, trackingFailed?: boolean) => void;
  onCancel: () => void;
}

export const RegisterView = ({
  initialSerial = '',
  userUid,
  onSuccess,
  onCancel,
}: RegisterViewProps) => {
  const [denomination, setDenomination] = useState<Denomination>(1000);
  const {
    value: serialInput,
    setValue: setSerialInput,
    onChange: onSerialInputChange,
    onCompositionStart: onSerialCompositionStart,
    onCompositionEnd: onSerialCompositionEnd,
    isComposing: isSerialComposing,
    validation,
  } = useSerialInput(initialSerial);
  const [selectedPref, setSelectedPref] = useState('東京都');
  const [selectedCity, setSelectedCity] = useState('千代田区');
  const [userNote, setUserNote] = useState('');
  
  const [availableCities, setAvailableCities] = useState<CityLocation[]>([]);
  const [locating, setLocating] = useState(false);
  const [locatingMessage, setLocatingMessage] = useState<string | null>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [existingBill, setExistingBill] = useState<BillWithSightings | null>(null);
  const [isCheckingExisting, setIsCheckingExisting] = useState(false);

  // OCR機能関連 state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const rawFileRef = useRef<File | null>(null);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrStatusMessage, setOcrStatusMessage] = useState<string | null>(null);
  const [ocrCandidates, setOcrCandidates] = useState<OcrSerialCandidate[]>([]);
  const [ocrMessage, setOcrMessage] = useState<{
    type: 'success' | 'warn' | 'info';
    text: string;
  } | null>(null);

  // ?debug=timing 用の画像診断データ
  const [ocrDebugData, setOcrDebugData] = useState<OcrDebugData | null>(null);
  const isTimingDebug = isDebugTiming();
  const debugUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (isTimingDebug) console.log('[OCR Debug] enabled=true');
  }, [isTimingDebug]);

  const revokeDebugUrls = () => {
    debugUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    debugUrlsRef.current = [];
  };

  useEffect(() => () => revokeDebugUrls(), []);

  const handleTriggerOcr = () => {
    if (!isTimingDebug || isOcrProcessing) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';

    if (!isTimingDebug || !file) return;

    revokeDebugUrls();
    setOcrDebugData(null);
    rawFileRef.current = file;
    // 撮影/選択後、まずクロップモーダルを開いてユーザーに記番号領域を指定してもらう
    setPendingImageFile(file);
  };

  const handleCropComplete = async (croppedBlob: Blob, metadata: CropMetadata) => {
    setPendingImageFile(null);
    setIsOcrProcessing(true);
    setOcrStatusMessage('記番号を読み取っています…');
    setOcrMessage(null);
    setOcrCandidates([]);

    const rawFile = rawFileRef.current;
    let emittedOcrError = false;

    try {
      if (isTimingDebug && rawFile) {
        const rawImageUrl = URL.createObjectURL(rawFile);
        const croppedImageUrl = URL.createObjectURL(croppedBlob);
        debugUrlsRef.current.push(rawImageUrl, croppedImageUrl);
        setOcrDebugData({ rawImageUrl, croppedImageUrl, cropMetadata: metadata, passes: [] });
        void Promise.all([analyzeBlobStats(rawFile), analyzeBlobStats(croppedBlob)]).then(([rawStats, croppedStats]) => {
          setOcrDebugData((current) => current ? { ...current, rawStats, croppedStats } : current);
        }).catch((error) => console.warn('Failed to analyze OCR debug images:', error));
      }

      const candidates = await recognizeBanknoteSerialFromImage(
        croppedBlob,
        (msg) => {
          setOcrStatusMessage(msg);
        },
        (passes) => {
          if (isTimingDebug && rawFile) {
            const passUrls = passes.map((pass) => pass.previewUrl);
            debugUrlsRef.current.push(...passUrls);
            setOcrDebugData((current) => current ? { ...current, passes } : current);
            console.log('[OCR Debug] passesReady=true');
            console.log('[OCR Debug] imageCount=4');
          }
        },
        (event) => {
          if (!isTimingDebug) return;
          if (event.type === 'error') {
            console.log(`[OCR Debug] recognizeError pass=${event.pass} message=${event.message || 'Unknown error'}`);
            emittedOcrError = true;
            setOcrDebugData((current) => current ? {
              ...current,
              error: { pass: event.pass, message: event.message || 'Unknown error', code: event.code },
            } : current);
          } else if (event.type === 'start') {
            console.log(`[OCR Debug] recognizeStart pass=${event.pass}`);
          } else {
            console.log(`[OCR Debug] recognizeEnd pass=${event.pass}`);
          }
        },
        (results) => {
          if (!isTimingDebug) return;
          setOcrDebugData((current) => current ? { ...current, psmDiagnostics: results } : current);
        },
        (results) => {
          if (!isTimingDebug) return;
          setOcrDebugData((current) => current ? { ...current, correctionDiagnostics: results } : current);
        }
      );

      if (candidates.length > 0) {
        setOcrCandidates(candidates);
        setOcrMessage({
          type: 'info',
          text: `${candidates.length}件の読み取り候補があります。紙幣と照合し、必要に応じて入力欄で修正してください。`,
        });
      } else {
        setOcrCandidates([]);
        setOcrMessage({
          type: 'warn',
          text: '記番号を読み取れませんでした。記番号だけが入るよう枠を合わせて再撮影するか、手入力してください。',
        });
      }
    } catch (err) {
      console.warn('OCR processing error:', err);
      if (isTimingDebug) {
        const error = err as Error & { code?: string };
        if (!emittedOcrError) {
          console.log(`[OCR Debug] recognizeError pass=initialize message=${error.message || String(err)}`);
        }
        setOcrDebugData((current) => current ? {
          ...current,
          error: current.error || { pass: 'initialize', message: error.message || String(err), code: error.code },
        } : current);
      }
      setOcrCandidates([]);
      setOcrMessage({
        type: 'warn',
        text: '読み取り中にエラーが発生しました。もう一度撮影するか、手入力してください。',
      });
    } finally {
      setIsOcrProcessing(false);
      setOcrStatusMessage(null);
    }
  };

  const handleCropCancel = () => {
    setPendingImageFile(null);
  };

  // 都道府県が変更されたら市区町村リストを更新
  useEffect(() => {
    const cities = getCitiesByPrefecture(selectedPref);
    setAvailableCities(cities);
    if (cities.length > 0 && !cities.some((c) => c.city === selectedCity)) {
      setSelectedCity(cities[0].city);
    }
  }, [selectedPref]);

  // 記番号の入力に応じて既存紙幣が存在するか確認
  useEffect(() => {
    const norm = normalizeSerialNumber(serialInput);

    if (!validation?.isValid) {
      setExistingBill(null);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      setIsCheckingExisting(true);
      try {
        const found = await getBillBySerial(norm);
        if (isMounted) {
          if (found) {
            setExistingBill(found);
            setDenomination(found.denomination); // 既存の額面を自動反映
          } else {
            setExistingBill(null);
          }
        }
      } catch (err) {
        console.warn('Failed to check existing bill:', err);
      } finally {
        if (isMounted) {
          setIsCheckingExisting(false);
        }
      }
    }, 250);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [serialInput, isSerialComposing, validation?.isValid]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (isSerialComposing) return;

    // バリデーション
    const valResult = validateSerialNumber(serialInput);
    if (!valResult.isValid) {
      setErrorMessage(valResult.message || '記番号をご確認ください');
      return;
    }

    if (isCheckingExisting) {
      setErrorMessage('登録状況を確認しています。少し待ってからもう一度お試しください。');
      return;
    }

    const currentCityObj = availableCities.find((c) => c.city === selectedCity) || {
      lat: 35.6895,
      lng: 139.6917,
    };

    setIsSubmitting(true);

    let billForSubmit = existingBill?.serialNumber === normSerial ? existingBill : null;
    try {
      if (billForSubmit && !getTimestampMillis(billForSubmit.lastSightedAtServer)) {
        const initialized = await initializeLegacyBillCooldown(normSerial);
        const refreshedBill = await getBillBySerial(normSerial);
        if (refreshedBill) {
          billForSubmit = refreshedBill;
          setExistingBill(refreshedBill);
        }
        if (initialized && billForSubmit) {
          setErrorMessage(cooldownMessage(getCooldownRemainingMs(billForSubmit)));
          return;
        }
      }

      if (billForSubmit) {
        const remainingMs = getCooldownRemainingMs(billForSubmit);
        if (remainingMs > 0) {
          setErrorMessage(cooldownMessage(remainingMs));
          return;
        }
      }

      const targetDenomination = billForSubmit ? billForSubmit.denomination : denomination;
      const result = await registerBillSighting({
        denomination: targetDenomination,
        serialNumber: normSerial,
        prefecture: selectedPref,
        municipality: selectedCity,
        latitudeApprox: currentCityObj.lat,
        longitudeApprox: currentCityObj.lng,
        userNote,
      });

      let trackingFailed = false;
      if (!result.isRediscovery && userUid) {
        try {
          await trackFirstRegisteredBill(userUid, result.bill, result.newSighting.municipality);
        } catch (trackingError) {
          console.warn('Bill registered publicly but could not be saved to this-device list:', trackingError);
          trackingFailed = true;
        }
      }
      onSuccess(result, trackingFailed);
    } catch (err: any) {
      console.error('Registration failed:', err);
      if (err instanceof RegistrationRateLimitError) {
        setErrorMessage(err.window === 'daily'
          ? '本日の登録回数が上限に達しました。時間をおいてからもう一度お試しください。'
          : '短時間に多くの登録が行われました。しばらく待ってからもう一度お試しください。');
        return;
      }
      const rawMsg = err?.message || '';
      const rawCode = typeof err?.code === 'string' ? err.code : '';
      const errorCode = rawCode.split('/').at(-1) ?? '';
      if (errorCode) console.error('Firebase registration error detail:', { code: rawCode, message: rawMsg });

      if (errorCode === 'permission-denied') {
        setErrorMessage('登録処理が許可されませんでした。しばらくしてからもう一度お試しください。');
      } else if (errorCode === 'unauthenticated') {
        setErrorMessage('認証の準備が完了していません。ページを再読み込みしてもう一度お試しください。');
      } else if (errorCode === 'unavailable' || errorCode === 'deadline-exceeded') {
        setErrorMessage('通信環境をご確認のうえ、もう一度お試しください。');
      } else if (errorCode === 'resource-exhausted') {
        setErrorMessage('短時間に多くの登録が行われました。しばらく待ってからもう一度お試しください。');
      } else if (rawMsg.includes('Missing or insufficient permissions')) {
        setErrorMessage('登録処理が許可されませんでした。しばらくしてからもう一度お試しください。');
      } else {
        setErrorMessage(rawMsg || '登録中にエラーが発生しました。再度お試しください。');
      }
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
            <span>1. 額面</span>
            <span className="form-label-badge">{existingBill ? '登録済み' : '必須'}</span>
          </label>

          {existingBill ? (
            <div
              style={{
                backgroundColor: '#eff6ff',
                border: '1.5px solid #bfdbfe',
                borderRadius: '12px',
                padding: '12px 14px',
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: '#dbeafe',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Lock size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#1e3a8a' }}>
                  このお札は {existingBill.denomination.toLocaleString()}円札 として登録済みです
                </div>
                <div style={{ fontSize: '12px', color: '#3b82f6', marginTop: '2px' }}>
                  再発見となるため額面は固定されています（これまでの発見: {existingBill.sightingsCount}回）
                </div>
              </div>
            </div>
          ) : null}

          <div className="denom-selector">
            {([1000, 5000, 10000] as Denomination[]).map((val) => (
              <button
                type="button"
                key={val}
                disabled={Boolean(existingBill)}
                className={`denom-btn ${denomination === val ? 'active' : ''}`}
                onClick={() => !existingBill && setDenomination(val)}
                id={`denom-${val}`}
                style={{
                  opacity: existingBill && denomination !== val ? 0.45 : 1,
                  cursor: existingBill ? 'not-allowed' : 'pointer',
                }}
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
            onChange={(e) => onSerialInputChange(e.target.value)}
            onCompositionStart={onSerialCompositionStart}
            onCompositionEnd={(e) => onSerialCompositionEnd(e.currentTarget.value)}
            maxLength={12}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
          />
          <p className="input-hint">全角・小文字でも自動変換します</p>

          {/* リアルタイム正規化プレビュー */}
          {serialInput && validation && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '8px',
                marginTop: '6px',
                fontSize: '12px',
                color: validation?.isValid ? '#059669' : '#dc2626',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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

              {validation?.isValid && isCheckingExisting && (
                <span style={{ color: '#64748b', fontSize: '11px' }}>
                  （登録状況を確認中...）
                </span>
              )}

              {validation?.isValid && !isCheckingExisting && existingBill && (
                <span
                  style={{
                    backgroundColor: '#dbeafe',
                    color: '#1e40af',
                    fontWeight: 700,
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                  }}
                >
                  🎉 再発見のお札です！
                </span>
              )}
            </div>
          )}

          <p className="input-hint">
            ※全角・半角・小文字は自動変換されます。ハイフンやスペースは不要です。
          </p>

          {isTimingDebug && (
            <>
              {/* OCRはdebug URLからのみ利用可能 */}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
                disabled={isOcrProcessing}
                id="ocr-file-input"
              />

          {/* カメラで記番号を読むボタン & ガイド */}
          <div style={{ marginTop: '10px' }}>
            <button
              type="button"
              onClick={handleTriggerOcr}
              disabled={isOcrProcessing}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '11px 16px',
                backgroundColor: isOcrProcessing ? '#f1f5f9' : '#f8fafc',
                color: isOcrProcessing ? '#94a3b8' : '#334155',
                border: '1.5px solid #cbd5e1',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: isOcrProcessing ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
              id="btn-ocr-camera"
            >
              {isOcrProcessing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>{ocrStatusMessage || '記番号を読み取っています…'}</span>
                </>
              ) : (
                <>
                  <Camera size={16} color="#475569" />
                  <span>カメラで記番号を読む（β）</span>
                </>
              )}
            </button>

            <div
              style={{
                fontSize: '11px',
                color: '#64748b',
                marginTop: '6px',
                textAlign: 'center',
              }}
            >
              📷 撮影後、記番号だけが大きく入るように囲んでください（画像は端末内でのみ処理されます）
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', textAlign: 'center' }}>
              読み取り結果は必ず紙幣の記番号と照合してください
            </div>

            {/* OCR結果・候補表示 */}
            {ocrMessage && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  backgroundColor:
                    ocrMessage.type === 'success'
                      ? '#f0fdf4'
                      : ocrMessage.type === 'warn'
                      ? '#fffbeb'
                      : '#eff6ff',
                  border: `1px solid ${
                    ocrMessage.type === 'success'
                      ? '#bbf7d0'
                      : ocrMessage.type === 'warn'
                      ? '#fde68a'
                      : '#bfdbfe'
                  }`,
                  color:
                    ocrMessage.type === 'success'
                      ? '#166534'
                      : ocrMessage.type === 'warn'
                      ? '#92400e'
                      : '#1e40af',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {ocrMessage.type === 'success' ? (
                    <CheckCircle size={15} style={{ flexShrink: 0 }} />
                  ) : ocrMessage.type === 'warn' ? (
                    <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  ) : (
                    <Sparkles size={15} style={{ flexShrink: 0 }} />
                  )}
                  <span style={{ fontWeight: 600 }}>{ocrMessage.text}</span>
                </div>

                {/* 候補はユーザーが選んだ場合のみ入力欄へ反映 */}
                {ocrCandidates.length > 0 && (
                  <div style={{ marginTop: '4px' }}>
                    <div style={{ fontSize: '11px', marginBottom: '4px', opacity: 0.85 }}>
                      タップすると入力欄へ反映します。紙幣と照合して修正してください。
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {ocrCandidates.map((candidate) => (
                        <button
                          type="button"
                          key={candidate.serial}
                          onClick={() => {
                            setSerialInput(candidate.serial);
                          }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 700,
                            fontFamily: 'monospace',
                            backgroundColor: serialInput === candidate.serial ? '#2563eb' : '#ffffff',
                            color: serialInput === candidate.serial ? '#ffffff' : '#1e293b',
                            border: `1px solid ${serialInput === candidate.serial ? '#2563eb' : '#cbd5e1'}`,
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ display: 'block' }}>{candidate.requiresReview ? '読み取り候補（要確認）' : '読み取り候補'}</span>
                          <span>{candidate.serial}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 候補なしの場合の案内ボタン */}
                {ocrCandidates.length === 0 && ocrMessage.type === 'warn' && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={handleTriggerOcr}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: '#ffffff',
                        border: '1px solid #fde68a',
                        borderRadius: '6px',
                        color: '#92400e',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <RefreshCw size={12} />
                      <span>もう一度撮影</span>
                    </button>
                  </div>
                )}
              </div>
            )}
              </div>
            </>
          )}
        </div>

        {isTimingDebug && ocrDebugData && (
          <OcrDebugPanel
            data={ocrDebugData}
            onPrepareNextCapture={(message) => {
              setOcrCandidates([]);
              setOcrMessage({ type: 'info', text: message });
            }}
          />
        )}

        {/* 現在地選択 */}
        <div className="form-group">
          <div className="form-label location-form-label">
            <span>3. 現在の地域（市区町村まで）</span>
          </div>
          <p className="location-privacy-note">
            位置情報の自動設定は任意です。保存するのは市区町村までで、GPS座標や正確な住所は保存・公開しません。
          </p>

          <button
            type="button"
            onClick={handleAutoLocate}
            disabled={locating}
            className="btn-location"
            id="btn-auto-locate"
          >
            <Navigation size={20} />
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
          <p className="input-hint">※最大60文字。個人情報や特定の日時・店舗名は避け、旅の雰囲気のみ記録してください。</p>
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
            disabled={isSubmitting || (Boolean(validation?.isValid) && isCheckingExisting)}
            id="btn-submit-registration"
          >
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

      {/* 記番号切り抜きモーダル */}
      {isTimingDebug && pendingImageFile && (
        <CropModal
          imageFile={pendingImageFile}
          onCrop={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}

    </div>
  );
};
