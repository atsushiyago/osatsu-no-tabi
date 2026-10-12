import { useState, useEffect } from 'react';
import {
  MapPin,
  Calendar,
  Compass,
  Share2,
  ArrowLeft,
  Check,
  Navigation,
} from 'lucide-react';
import type { BillWithSightings } from '../types';
import { getPublicBillById } from '../services/billService';
import { JourneyMap } from './JourneyMap';
import { markTrackedBillSeen } from '../services/trackedBills';
import { useI18n } from '../useI18n';
import { getLocalizedLocationLabel } from '../utils/geo';

interface BillDetailViewProps {
  publicBillId: string;
  userUid?: string | null;
  registrationCompleted?: boolean;
  showTrackedBillsLink?: boolean;
  onNavigateTrackedBills?: () => void;
  onBack: () => void;
}

export const BillDetailView = ({
  publicBillId,
  userUid,
  registrationCompleted = false,
  showTrackedBillsLink = false,
  onNavigateTrackedBills,
  onBack,
}: BillDetailViewProps) => {
  const { language, t, number, date, yen } = useI18n();
  const [billData, setBillData] = useState<BillWithSightings | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function loadBill() {
      setLoading(true);
      try {
        const data = await getPublicBillById(publicBillId);
        setBillData(data);
      } catch (err) {
        console.error('Failed to load bill detail', err);
      } finally {
        setLoading(false);
      }
    }
    loadBill();
  }, [publicBillId]);

  useEffect(() => {
    if (!userUid || loading || !billData) return;
    const latestSighting = billData.sightings[billData.sightings.length - 1];
    if (!latestSighting) return;
    void markTrackedBillSeen(
      userUid,
      billData.id,
      billData.sightingsCount,
      latestSighting.municipality
    ).catch((error) => console.warn('Could not mark tracked bill as seen:', error));
  }, [billData, loading, userUid]);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: t('shareTitle', { amount: number(billData?.denomination ?? 0) }),
          text: t('shareDescription', { amount: number(billData?.denomination ?? 0), count: number(billData?.sightingsCount ?? 0), distance: number(billData?.totalDistanceKm ?? 0) }),
          url,
        });
        return;
      } catch {
        // フォールバック
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      alert(t('copyFailed'));
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
        <Compass size={36} className="animate-spin" color="#2563eb" style={{ margin: '0 auto 12px' }} />
        <p style={{ fontWeight: 600 }}>{t('detailLoading')}</p>
      </div>
    );
  }

  if (!billData) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>
          {t('billMissing')}
        </h3>
        <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '20px' }}>
          {t('billMissingDescription')}
        </p>
        <button className="btn-secondary" onClick={onBack}>
          {t('back')}
        </button>
      </div>
    );
  }

  const { denomination, sightingsCount, totalDistanceKm, sightings, firstSightedAt, lastSightedAt } =
    billData;

  const firstDateStr = date(firstSightedAt, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const totalDays = Math.max(
    0,
    Math.round(
      (new Date(lastSightedAt).getTime() - new Date(firstSightedAt).getTime()) /
        (1000 * 60 * 60 * 24)
    )
  );

  return (
    <div style={{ paddingBottom: '32px' }}>
      {/* 上部ナビ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
        }}
      >
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'none',
            border: 'none',
            color: '#475569',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            padding: '6px 0',
          }}
          id="btn-back-from-detail"
        >
          <ArrowLeft size={18} />
          <span>{t('back')}</span>
        </button>

        <button
          onClick={handleShare}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: copied ? '#ecfdf5' : '#f1f5f9',
            color: copied ? '#059669' : '#334155',
            border: 'none',
            borderRadius: '9999px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          id="btn-share-bill"
        >
          {copied ? <Check size={14} /> : <Share2 size={14} />}
          <span>{copied ? t('copied') : t('shareJourney')}</span>
        </button>
      </div>

      {/* 紙幣ヘッダーカード */}
      <div
        className="bill-detail-hero"
        style={{
          background: '#334f40',
          color: '#ffffff',
          borderRadius: '6px',
          padding: '20px',
          marginBottom: '20px',
          boxShadow: 'none',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span
            style={{
              fontSize: '15px',
              fontWeight: 800,
              padding: '4px 9px',
              borderRadius: '3px',
              backgroundColor:
                denomination === 10000
                  ? '#895b18'
                  : denomination === 5000
                  ? '#9f3b2f'
                  : '#365d4a',
              color: '#ffffff',
            }}
          >
            {t('yenBill', { amount: language === 'ja' ? number(denomination) : yen(denomination) })}
          </span>
          <span style={{ fontSize: '16px', color: '#f4efe3' }}>
            {sightingsCount >= 2 ? t('ongoingJourney') : t('firstDiscovery')}
          </span>
        </div>

        <div
          style={{
            fontFamily: 'monospace',
            fontSize: '26px',
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: '#f8fafc',
            marginBottom: '16px',
          }}
        >
          {t('journeyBill', { id: publicBillId.slice(0, 4).toUpperCase() })}
        </div>

        {/* 4つの主要指標 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '10px',
            paddingTop: '14px',
            borderTop: '1px solid rgba(255, 255, 255, 0.35)',
          }}
        >
          <div>
            <span style={{ fontSize: '15px', color: '#f4efe3' }}>{t('discoveryCount')}</span>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#ffffff' }}>
              {number(sightingsCount)} <span style={{ fontSize: '12px', color: '#ffffff' }}>{t('statsSightingUnit')}</span>
            </div>
          </div>

          <div>
            <span style={{ fontSize: '15px', color: '#f4efe3' }}>{t('firstRegistered')}</span>
            <div style={{ fontSize: '17px', fontWeight: 700, color: '#ffffff', marginTop: '2px' }}>
              {firstDateStr}
            </div>
          </div>

          <div>
            <span style={{ fontSize: '15px', color: '#f4efe3' }}>{t('totalDistance')}</span>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#ffffff' }}>
              {language === 'ja' ? '約 ' : 'About '}{number(totalDistanceKm)} <span style={{ fontSize: '12px', color: '#ffffff' }}>km</span>
            </div>
          </div>

          <div>
            <span style={{ fontSize: '15px', color: '#f4efe3' }}>{t('elapsedDays')}</span>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#ffffff' }}>
              {number(totalDays)} <span style={{ fontSize: '12px', color: '#ffffff' }}>{t('dayUnit')}</span>
            </div>
          </div>
        </div>
      </div>

      {registrationCompleted && (
        <aside className="registration-return-note" aria-labelledby="registration-return-title" role="status">
          <h2 id="registration-return-title">{t('registeredSuccess')}</h2>
          <p>{t('useNormally')}</p>
          <p>{t('visitAgain')}</p>
          {showTrackedBillsLink && onNavigateTrackedBills && (
            <button className="registration-return-link" onClick={onNavigateTrackedBills}>
              {t('viewTracked')}
            </button>
          )}
        </aside>
      )}

      {/* 地図コンポーネント */}
      <section style={{ marginBottom: '24px' }}>
        <div
          className="journey-map-heading"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '10px',
          }}
        >
          <h3
            className="journey-map-title"
            style={{
              fontSize: '18px',
              fontWeight: 800,
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Navigation size={18} color="#9f3b2f" />
            <span>{t('mapTitle')}</span>
          </h3>
          <span style={{ fontSize: '15px', color: '#494b46' }}>
            {t('mapHint')}
          </span>
        </div>

        <JourneyMap sightings={sightings} height="320px" />
      </section>

      {/* 移動履歴タイムライン */}
      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '10px',
          }}
        >
          <h3
            style={{
              fontSize: '18px',
              fontWeight: 800,
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Calendar size={18} color="#365d4a" />
            <span>{t('historyTitle', { count: number(sightings.length) })}</span>
          </h3>
        </div>

        <div className="timeline">
          {sightings.map((s, idx) => {
            const isFirst = idx === 0;
            const isLatest = idx === sightings.length - 1 && sightings.length > 1;
            const dateStr = date(s.createdAt, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            });

            return (
              <div key={s.id} className="timeline-step">
                <div
                  className={`timeline-dot ${
                    isLatest ? 'latest' : isFirst ? 'first' : ''
                  }`}
                />

                <div className="timeline-card">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          fontSize: '15px',
                          fontWeight: 700,
                          backgroundColor: isLatest
                            ? '#fee2e2'
                            : isFirst
                            ? '#d1fae5'
                            : '#eee5d5',
                          color: isLatest
                            ? '#b91c1c'
                            : isFirst
                            ? '#065f46'
                            : '#624c26',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        {t('stepLabel', { step: number(s.step) })} {isFirst ? `(${t('origin')})` : isLatest ? `(${t('latest')})` : ''}
                      </span>
                    </div>
                    <span style={{ fontSize: '15px', color: '#494b46' }}>{dateStr}</span>
                  </div>

                  <div
                    style={{
                      fontSize: '18px',
                      fontWeight: 800,
                      color: '#0f172a',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '4px',
                    }}
                  >
                    <MapPin size={18} color="#9f3b2f" />
                    <span>
                      {getLocalizedLocationLabel(s.prefecture, s.municipality, language)}
                    </span>
                  </div>

                  {s.distanceFromPrevKm && s.distanceFromPrevKm > 0 ? (
                    <div
                      style={{
                        marginTop: '6px',
                        fontSize: '16px',
                        color: '#7f2f27',
                        fontWeight: 600,
                      }}
                    >
                    {t('fromPrevious')} {language === 'ja' ? '約' : 'about '}{number(s.distanceFromPrevKm)}km {t('moved')} ({number(s.daysFromPrev ?? 0)} {t('dayUnit')})
                    </div>
                  ) : null}

                  {s.userNote && (
                    <div
                      style={{
                        marginTop: '8px',
                        padding: '8px 10px',
                        backgroundColor: '#f8fafc',
                        borderRadius: '8px',
                        fontSize: '16px',
                        color: '#282a27',
                        borderLeft: '3px solid #cbd5e1',
                      }}
                    >
                      “{s.userNote}”
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

    </div>
  );
};
