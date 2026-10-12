import { lazy, Suspense, useState, useEffect, useRef } from 'react';
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
import { useI18n } from '../useI18n';
import type { TranslationKey } from '../i18n';
import type { OcrSerialCandidate } from '../utils/ocr.ts';
import type { CropMetadata } from './CropModal';
import type { OcrDebugData } from './OcrDebugPanel';
import { isDebugTiming } from '../utils/debug';
import {
  PREFECTURES,
  getCitiesByPrefecture,
  findNearestCity,
  getLocalizedPlaceName,
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
  RegistrationRateLimitError,
} from '../services/billService';

const BILL_COOLDOWN_MS = 15 * 60 * 1000;
const LazyCropModal = lazy(() => import('./CropModal').then(({ CropModal }) => ({ default: CropModal })));
const LazyOcrDebugPanel = lazy(() => import('./OcrDebugPanel').then(({ OcrDebugPanel }) => ({ default: OcrDebugPanel })));
type LocalizedMessage = { key: TranslationKey; values?: Record<string, string | number> } | { text: string; language: 'ja' | 'en' };

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

interface RegisterViewProps {
  initialSerial?: string;
  onSuccess: (result: RegisterResult, trackingFailed?: boolean) => void;
  onCancel: () => void;
}

export const RegisterView = ({
  initialSerial = '',
  onSuccess,
  onCancel,
}: RegisterViewProps) => {
  const { language, t, number, yen } = useI18n();
  const [denomination, setDenomination] = useState<Denomination>(1000);
  const {
    value: serialInput,
    setValue: setSerialInput,
    onChange: onSerialInputChange,
    onCompositionStart: onSerialCompositionStart,
    onCompositionEnd: onSerialCompositionEnd,
    isComposing: isSerialComposing,
    validation,
  } = useSerialInput(initialSerial, language);
  const [selectedPref, setSelectedPref] = useState('東京都');
  const [selectedCity, setSelectedCity] = useState('千代田区');
  const [userNote, setUserNote] = useState('');
  
  const [availableCities, setAvailableCities] = useState<CityLocation[]>([]);
  const [locating, setLocating] = useState(false);
  const [locatingMessage, setLocatingMessage] = useState<LocalizedMessage | null>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<LocalizedMessage | null>(null);
  const displayMessage = (message: LocalizedMessage | null) => {
    if (!message) return null;
    if ('key' in message) {
      const values = message.key === 'locationSet' && message.values
        ? {
            ...message.values,
            prefecture: getLocalizedPlaceName(String(message.values.prefecture), language),
            city: getLocalizedPlaceName(String(message.values.city), language),
          }
        : message.values;
      return t(message.key, values);
    }
    return message.language === language ? message.text : t('registrationFailed');
  };
  const setErrorKey = (key: TranslationKey, values?: Record<string, string | number>) => setErrorMessage({ key, values });

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
      if (isTimingDebug) setOcrStatusMessage('OCRを読み込み中…');
      const ocr = await import('../utils/ocr.ts');

      if (isTimingDebug && rawFile) {
        const rawImageUrl = URL.createObjectURL(rawFile);
        const croppedImageUrl = URL.createObjectURL(croppedBlob);
        debugUrlsRef.current.push(rawImageUrl, croppedImageUrl);
        setOcrDebugData({ rawImageUrl, croppedImageUrl, cropMetadata: metadata, passes: [] });
        void Promise.all([ocr.analyzeBlobStats(rawFile), ocr.analyzeBlobStats(croppedBlob)]).then(([rawStats, croppedStats]) => {
          setOcrDebugData((current) => current ? { ...current, rawStats, croppedStats } : current);
        }).catch((error) => console.warn('Failed to analyze OCR debug images:', error));
      }

      const candidates = await ocr.recognizeBanknoteSerialFromImage(
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
      alert(t('locationUnsupported'));
      return;
    }

    setLocating(true);
    setLocatingMessage({ key: 'locationGetting' });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // 正確なGPS座標は保持せず、直ちに最も近い市区町村に丸める
        const nearest = findNearestCity(latitude, longitude);
        setSelectedPref(nearest.pref);
        setSelectedCity(nearest.city);
        setLocating(false);
        setLocatingMessage({ key: 'locationSet', values: { prefecture: nearest.pref, city: nearest.city } });
        setTimeout(() => setLocatingMessage(null), 4000);
      },
      (err) => {
        console.warn('Geolocation error:', err);
        setLocating(false);
        setLocatingMessage({ key: 'locationDenied' });
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
    const valResult = validateSerialNumber(serialInput, language);
    if (!valResult.isValid) {
      setErrorMessage({ text: valResult.message || t('serialCheckFirst'), language });
      return;
    }

    if (isCheckingExisting) {
      setErrorKey('checkingBill');
      return;
    }

    const currentCityObj = availableCities.find((c) => c.city === selectedCity) || {
      lat: 35.6895,
      lng: 139.6917,
    };

    setIsSubmitting(true);

    let billForSubmit = existingBill;
    try {
      if (billForSubmit && !getTimestampMillis(billForSubmit.lastSightedAtServer)) {
        setErrorKey('billCheckFailed');
        return;
      }

      if (billForSubmit) {
        const remainingMs = getCooldownRemainingMs(billForSubmit);
        if (remainingMs > 0) {
          setErrorKey('cooldown', { minutes: number(Math.ceil(remainingMs / 60_000)) });
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

      onSuccess(result, false);
    } catch (err: any) {
      console.error('Registration failed:', err);
      if (err instanceof RegistrationRateLimitError) {
        setErrorKey(err.window === 'daily' ? 'dailyLimit' : 'tooManySubmissions');
        return;
      }
      const rawMsg = err?.message || '';
      const rawCode = typeof err?.code === 'string' ? err.code : '';
      const errorCode = rawCode.split('/').at(-1) ?? '';
      if (errorCode) console.error('Firebase registration error detail:', { code: rawCode, message: rawMsg });

      if (errorCode === 'permission-denied') {
        setErrorKey('registrationDenied');
      } else if (errorCode === 'unauthenticated') {
        setErrorKey('authNotReady');
      } else if (errorCode === 'unavailable' || errorCode === 'deadline-exceeded') {
        setErrorKey('networkRetry');
      } else if (errorCode === 'resource-exhausted') {
        setErrorKey('tooManySubmissions');
      } else if (rawMsg.includes('Missing or insufficient permissions')) {
        setErrorKey('registrationDenied');
      } else {
        setErrorMessage({ text: language === 'ja' && rawMsg ? rawMsg : t('registrationFailed'), language });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ paddingBottom: '24px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
          {t('registerHeading')}
        </h2>
        <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
          {t('registerDescription')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="form-card">
        {/* 額面選択 */}
        <div className="form-group">
          <label className="form-label">
            <span>{t('denominationStep')}</span>
            <span className="form-label-badge">{existingBill ? t('registered') : t('required')}</span>
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
                  {t('existingDenomination', { amount: number(existingBill.denomination) })}
                </div>
                <div style={{ fontSize: '12px', color: '#3b82f6', marginTop: '2px' }}>
                  {t('fixedDenomination', { count: number(existingBill.sightingsCount) })}
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
                <div className="denom-yen">{language === 'ja' ? `${number(val)}円` : yen(val)}</div>
                <div className="denom-label">
                  {t(val === 1000 ? 'denominationLabel1000' : val === 5000 ? 'denominationLabel5000' : 'denominationLabel10000')}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 記番号入力 */}
        <div className="form-group">
          <label className="form-label" htmlFor="serialInput">
            <span>{t('serialStep')}</span>
            <span className="form-label-badge">{t('required')}</span>
          </label>

          <input
            id="serialInput"
            type="text"
            className="text-input code-font"
            placeholder={t('serialPlaceholder')}
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
          <p className="input-hint">
            {t('serialHelp')}<br />
            {t('serialExamples')}
          </p>

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
                      {t('normalizedSerial')} <strong>{formatSerialDisplay(normSerial)}</strong>
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
                  {t('checkingRegistration')}
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
                  {t('rediscoveryBill')}
                </span>
              )}
            </div>
          )}

          <p className="input-hint">
            {t('normalizeHelp')}
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
          <Suspense fallback={<p role="status">OCR診断を読み込み中…</p>}>
            <LazyOcrDebugPanel
              data={ocrDebugData}
              onPrepareNextCapture={(message) => {
                setOcrCandidates([]);
                setOcrMessage({ type: 'info', text: message });
              }}
            />
          </Suspense>
        )}

        {/* 現在地選択 */}
        <div className="form-group">
          <div className="form-label location-form-label">
            <span>{t('locationStep')}</span>
          </div>
          <p className="location-privacy-note">
            {t('locationPrivacy')}
          </p>

          <button
            type="button"
            onClick={handleAutoLocate}
            disabled={locating}
            className="btn-location"
            id="btn-auto-locate"
          >
            <Navigation size={20} />
            <span>{locating ? t('locating') : t('locateFromDevice')}</span>
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
              {displayMessage(locatingMessage)}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                {t('prefecture')}
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
                    {getLocalizedPlaceName(pref, language)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                {t('municipality')}
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
                    {getLocalizedPlaceName(c.city, language)}
                  </option>
                ))}
              </select>
            </div>
          </div>

        </div>

        {/* 旅のひと言メモ（任意） */}
        <div className="form-group">
          <label className="form-label" htmlFor="userNote">
            <span>{t('memoStep')}</span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t('optional')}</span>
          </label>
          <input
            id="userNote"
            type="text"
            className="text-input"
            placeholder={t('memoPlaceholder')}
            value={userNote}
            onChange={(e) => setUserNote(e.target.value)}
            maxLength={60}
          />
          <p className="input-hint">{t('memoPrivacy')}</p>
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
            <span>{displayMessage(errorMessage)}</span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting || (Boolean(validation?.isValid) && isCheckingExisting)}
            id="btn-submit-registration"
          >
            <span>{isSubmitting ? t('submitting') : t('submitRegistration')}</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
          >
            {t('cancel')}
          </button>
        </div>
      </form>

      {/* 記番号切り抜きモーダル */}
      {isTimingDebug && pendingImageFile && (
        <Suspense fallback={<p role="status">クロップ画面を読み込み中…</p>}>
          <LazyCropModal
            imageFile={pendingImageFile}
            onCrop={handleCropComplete}
            onCancel={handleCropCancel}
          />
        </Suspense>
      )}

    </div>
  );
};
