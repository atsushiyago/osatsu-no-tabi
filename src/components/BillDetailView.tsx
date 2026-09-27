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
          title: `お札の旅 - ${billData?.denomination}円札`,
          text: `この${billData?.denomination}円札は${billData?.sightingsCount}回発見され、日本を約${billData?.totalDistanceKm}km旅しています！`,
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
      alert('URLのコピーに失敗しました');
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
        <Compass size={36} className="animate-spin" color="#2563eb" style={{ margin: '0 auto 12px' }} />
        <p style={{ fontWeight: 600 }}>旅の記憶を読み込んでいます...</p>
      </div>
    );
  }

  if (!billData) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>
          お札が見つかりませんでした
        </h3>
        <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '20px' }}>
          指定された旅の記録は見つかりませんでした。
        </p>
        <button className="btn-secondary" onClick={onBack}>
          戻る
        </button>
      </div>
    );
  }

  const { denomination, sightingsCount, totalDistanceKm, sightings, firstSightedAt, lastSightedAt } =
    billData;

  const firstDateStr = new Date(firstSightedAt).toLocaleDateString('ja-JP', {
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
          <span>戻る</span>
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
          <span>{copied ? 'リンクをコピーしました！' : '旅をシェア'}</span>
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
            {denomination.toLocaleString()}円札
          </span>
          <span style={{ fontSize: '16px', color: '#f4efe3' }}>
            {sightingsCount >= 2 ? '継続中の旅' : '最初の発見'}
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
          旅するお札 #{publicBillId.slice(0, 4).toUpperCase()}
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
            <span style={{ fontSize: '15px', color: '#f4efe3' }}>発見回数</span>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#ffffff' }}>
              {sightingsCount} <span style={{ fontSize: '12px', color: '#ffffff' }}>回</span>
            </div>
          </div>

          <div>
            <span style={{ fontSize: '15px', color: '#f4efe3' }}>最初の登録</span>
            <div style={{ fontSize: '17px', fontWeight: 700, color: '#ffffff', marginTop: '2px' }}>
              {firstDateStr}
            </div>
          </div>

          <div>
            <span style={{ fontSize: '15px', color: '#f4efe3' }}>総移動距離</span>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#ffffff' }}>
              約 {totalDistanceKm} <span style={{ fontSize: '12px', color: '#ffffff' }}>km</span>
            </div>
          </div>

          <div>
            <span style={{ fontSize: '15px', color: '#f4efe3' }}>経過日数</span>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#ffffff' }}>
              {totalDays} <span style={{ fontSize: '12px', color: '#ffffff' }}>日</span>
            </div>
          </div>
        </div>
      </div>

      {registrationCompleted && (
        <aside className="registration-return-note" aria-labelledby="registration-return-title" role="status">
          <h2 id="registration-return-title">登録しました</h2>
          <p>このお札を手元に保管する必要はありません。いつも通りお使いください。</p>
          <p>数週間したら、また旅の続きを見にきてください。</p>
          {showTrackedBillsLink && onNavigateTrackedBills && (
            <button className="registration-return-link" onClick={onNavigateTrackedBills}>
              登録したお札を見る
            </button>
          )}
        </aside>
      )}

      {/* 地図コンポーネント */}
      <section style={{ marginBottom: '24px' }}>
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
            <Navigation size={18} color="#9f3b2f" />
            <span>日本列島の移動軌跡</span>
          </h3>
          <span style={{ fontSize: '15px', color: '#494b46' }}>
            地図の印を選ぶと詳細を確認できます
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
            <span>移動履歴 ({sightings.length}地点)</span>
          </h3>
        </div>

        <div className="timeline">
          {sightings.map((s, idx) => {
            const isFirst = idx === 0;
            const isLatest = idx === sightings.length - 1 && sightings.length > 1;
            const dateStr = new Date(s.createdAt).toLocaleDateString('ja-JP', {
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
                        第{s.step}の足跡 {isFirst ? '(起点)' : isLatest ? '(最新)' : ''}
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
                      {s.prefecture} {s.municipality}
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
                      前回の街から 約{s.distanceFromPrevKm}km 移動 ({s.daysFromPrev ?? 0}日)
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
