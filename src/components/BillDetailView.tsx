import { useState, useEffect } from 'react';
import {
  MapPin,
  Calendar,
  Compass,
  Share2,
  ArrowLeft,
  Check,
  Navigation,
  Sparkles,
} from 'lucide-react';
import type { BillWithSightings } from '../types';
import { getBillBySerial } from '../services/billService';
import { JourneyMap } from './JourneyMap';
import { formatSerialDisplay } from '../utils/serial';

interface BillDetailViewProps {
  serialNumber: string;
  onBack: () => void;
  onRegisterAgain: (serial: string) => void;
}

export const BillDetailView = ({
  serialNumber,
  onBack,
  onRegisterAgain,
}: BillDetailViewProps) => {
  const [billData, setBillData] = useState<BillWithSightings | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function loadBill() {
      setLoading(true);
      try {
        const data = await getBillBySerial(serialNumber);
        setBillData(data);
      } catch (err) {
        console.error('Failed to load bill detail', err);
      } finally {
        setLoading(false);
      }
    }
    loadBill();
  }, [serialNumber]);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `お札の旅 - ${billData?.denomination}円札 (${serialNumber})`,
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
          記番号「{serialNumber}」はまだ登録されていません。
        </p>
        <button className="btn-primary" onClick={() => onRegisterAgain(serialNumber)}>
          このお札を登録する
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
              fontSize: '12px',
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: '6px',
              backgroundColor:
                denomination === 10000
                  ? '#f59e0b'
                  : denomination === 5000
                  ? '#a855f7'
                  : '#10b981',
              color: '#ffffff',
            }}
          >
            {denomination.toLocaleString()}円札
          </span>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            {sightingsCount >= 2 ? '継続中の旅' : '最初の発見'}
          </span>
        </div>

        <div
          style={{
            fontFamily: 'monospace',
            fontSize: '24px',
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: '#f8fafc',
            marginBottom: '16px',
          }}
        >
          {formatSerialDisplay(serialNumber)}
        </div>

        {/* 4つの主要指標 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '10px',
            paddingTop: '14px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>発見回数</span>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#38bdf8' }}>
              {sightingsCount} <span style={{ fontSize: '12px' }}>回</span>
            </div>
          </div>

          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>最初の登録</span>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
              {firstDateStr}
            </div>
          </div>

          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>総移動距離</span>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#34d399' }}>
              約 {totalDistanceKm} <span style={{ fontSize: '12px' }}>km</span>
            </div>
          </div>

          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>経過日数</span>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#fbbf24' }}>
              {totalDays} <span style={{ fontSize: '12px' }}>日</span>
            </div>
          </div>
        </div>
      </div>

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
              fontSize: '15px',
              fontWeight: 800,
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Navigation size={16} color="#2563eb" />
            <span>日本列島の移動軌跡</span>
          </h3>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            ピンタップで詳細
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
              fontSize: '15px',
              fontWeight: 800,
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Calendar size={16} color="#2563eb" />
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
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: isLatest
                            ? '#fee2e2'
                            : isFirst
                            ? '#d1fae5'
                            : '#eff6ff',
                          color: isLatest
                            ? '#b91c1c'
                            : isFirst
                            ? '#065f46'
                            : '#1d4ed8',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        第{s.step}の足跡 {isFirst ? '(起点)' : isLatest ? '(最新)' : ''}
                      </span>
                    </div>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>{dateStr}</span>
                  </div>

                  <div
                    style={{
                      fontSize: '16px',
                      fontWeight: 800,
                      color: '#0f172a',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '4px',
                    }}
                  >
                    <MapPin size={16} color="#2563eb" />
                    <span>
                      {s.prefecture} {s.municipality}
                    </span>
                  </div>

                  {s.distanceFromPrevKm && s.distanceFromPrevKm > 0 ? (
                    <div
                      style={{
                        marginTop: '6px',
                        fontSize: '12px',
                        color: '#2563eb',
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
                        fontSize: '12px',
                        color: '#334155',
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

      {/* 今このお札を持っている人へのアクション */}
      <div style={{ marginTop: '28px' }}>
        <button
          className="btn-primary"
          onClick={() => onRegisterAgain(serialNumber)}
          id="btn-re-register-this"
        >
          <Sparkles size={18} />
          <span>今このお札をお持ちですか？発見を記録する</span>
        </button>
      </div>
    </div>
  );
};
