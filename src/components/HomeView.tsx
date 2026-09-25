import { useEffect, useState } from 'react';
import {
  Compass,
  Search,
  PlusCircle,
  MapPin,
  TrendingUp,
  Award,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import type { GlobalStats, BillWithSightings } from '../types';
import { getGlobalStats, getRecentJourneys } from '../services/billService';
import { formatSerialDisplay } from '../utils/serial';
import { SAMPLE_JOURNEYS } from '../data/sampleJourneys';
import type { TrackedBillRow } from '../services/trackedBills';

interface HomeViewProps {
  onNavigateRegister: (initialSerial?: string) => void;
  onNavigateSearch: () => void;
  onSelectBill: (serial: string) => void;
  trackedBills: TrackedBillRow[] | null;
  onNavigateTrackedBills: () => void;
}

export const HomeView = ({
  onNavigateRegister,
  onNavigateSearch,
  onSelectBill,
  trackedBills,
  onNavigateTrackedBills,
}: HomeViewProps) => {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [recentJourneys, setRecentJourneys] = useState<BillWithSightings[]>([]);
  const [loading, setLoading] = useState(true);
  const displayedJourneys = loading
    ? []
    : [
        ...recentJourneys,
        ...SAMPLE_JOURNEYS.slice(0, Math.max(0, 8 - recentJourneys.length)),
      ];
  const newTrackedBills = trackedBills?.filter((row) => row.unseenSightingsCount > 0) ?? [];
  const leadingNewBill = newTrackedBills[0];
  const latestNewSighting = leadingNewBill?.bill.sightings.at(-1);

  useEffect(() => {
    async function loadData() {
      try {
        const [statsData, journeysData] = await Promise.all([
          getGlobalStats(),
          getRecentJourneys(8),
        ]);
        setStats(statsData);
        setRecentJourneys(journeysData);
      } catch (err) {
        console.error('Failed to load home data', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div>
      {newTrackedBills.length > 0 && (
        <section className="home-new-discovery" aria-labelledby="home-new-discovery-title">
          <div className="home-new-discovery-copy">
            <span className="home-new-discovery-kicker">あなたの旅ノートに新しい足跡</span>
            <h2 id="home-new-discovery-title">再発見！</h2>
            <p>{newTrackedBills.length}枚のお札に新しい発見があります</p>
          </div>
          <span className="rediscovery-stamp" aria-label="再発見の記録">
            <span>再発見</span>
          </span>
          {leadingNewBill?.lastSeenMunicipality && latestNewSighting?.municipality &&
            leadingNewBill.lastSeenMunicipality !== latestNewSighting.municipality && (
              <div
                className="travel-route home-new-discovery-route"
                aria-label={`前回確認 ${leadingNewBill.lastSeenMunicipality} から現在 ${latestNewSighting.municipality} へ`}
              >
                <span>{leadingNewBill.lastSeenMunicipality}</span>
                <span className="travel-route-dots" aria-hidden="true">··· →</span>
                <span>{latestNewSighting.municipality}</span>
              </div>
            )}
          <button className="home-new-discovery-link" onClick={onNavigateTrackedBills}>
            <span>この端末のお札を見る</span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </section>
      )}

      {/* ヒーロー */}
      <section className="hero">
        <div className="hero-tag">
          <Compass size={14} />
          <span>日本円紙幣の移動追跡プロジェクト</span>
        </div>

        <h1 className="hero-title">
          このお札、
          <br />
          前はどこにいた？
        </h1>

        <p className="hero-desc">
          手元のお札の記番号を登録すると、
          <br />
          同じお札を誰かが再び登録したとき、
          <br />
          そのお札が日本をどう旅したのかを見ることができます。
        </p>

        <div className="cta-group">
          <button
            className="btn-primary"
            onClick={() => onNavigateRegister()}
            id="btn-register-top"
          >
            <PlusCircle size={20} />
            <span>手元にあるお札を登録する</span>
          </button>

          <button
            className="btn-secondary"
            onClick={onNavigateSearch}
            id="btn-search-top"
          >
            <Search size={18} />
            <span>記番号を検索する</span>
          </button>
        </div>
      </section>

      {/* 全体統計 */}
      <section className="stats-container">
        <div className="stats-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <TrendingUp size={16} color="#9f3b2f" />
            <span>全国の旅の統計</span>
          </div>
          <span style={{ fontSize: '15px', color: '#494b46' }}>リアルタイム</span>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">登録された紙幣数</span>
            <div className="stat-value">
              {loading ? '...' : (stats?.totalBills ?? 0).toLocaleString()}
              <span className="stat-unit">枚</span>
            </div>
          </div>

          <div className="stat-card">
            <span className="stat-label">総発見回数</span>
            <div className="stat-value">
              {loading ? '...' : (stats?.totalSightings ?? 0).toLocaleString()}
              <span className="stat-unit">回</span>
            </div>
          </div>

          <div className="stat-card">
            <span className="stat-label">再発見された紙幣</span>
            <div className="stat-value" style={{ color: '#9f3b2f' }}>
              {loading ? '...' : (stats?.rediscoveredBills ?? 0).toLocaleString()}
              <span className="stat-unit">枚</span>
            </div>
          </div>

          <div className="stat-card">
            <span className="stat-label">最長移動距離</span>
            <div className="stat-value" style={{ color: '#365d4a' }}>
              {loading ? '...' : (stats?.maxDistanceKm ?? 0).toLocaleString()}
              <span className="stat-unit">km</span>
            </div>
          </div>
        </div>
      </section>

      {/* 最近の旅ログ */}
      {displayedJourneys.length > 0 && (
        <section style={{ margin: '24px 0' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px',
            }}
          >
            <h2
              style={{
                fontSize: '15px',
                fontWeight: 800,
                color: '#1e293b',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Award size={18} color="#f59e0b" />
              <span>最近の旅</span>
            </h2>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              タップで軌跡を表示
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {displayedJourneys.map((b) => {
              const isSample = b.id.startsWith('sample-');
              const startCity = b.sightings[0]
                ? `${b.sightings[0].municipality}`
                : '不明';
              const latestCity =
                b.sightings[b.sightings.length - 1]?.municipality || startCity;

              return (
                <div
                  key={b.id}
                  className="journey-row"
                  onClick={isSample ? undefined : () => onSelectBill(b.serialNumber)}
                  onKeyDown={isSample ? undefined : (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectBill(b.serialNumber);
                    }
                  }}
                  role={isSample ? undefined : 'button'}
                  tabIndex={isSample ? undefined : 0}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    cursor: isSample ? 'default' : 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px',
                      }}
                    >
                      {isSample && <span className="sample-badge">サンプル</span>}
                      {!isSample && <span
                        style={{
                          backgroundColor: '#eee5d5',
                          color: '#463924',
                          fontSize: '15px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '6px',
                        }}
                      >
                        {b.denomination.toLocaleString()}円札
                      </span>}
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          fontSize: isSample ? '15px' : '13px',
                          color: '#334155',
                        }}
                      >
                        {isSample ? '架空ID ' + b.id : formatSerialDisplay(b.serialNumber)}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        color: '#475569',
                      }}
                    >
                        <MapPin size={15} color="#494b46" />
                      <span>{startCity}</span>
                      {b.sightings.length > 1 && (
                        <>
                      <span style={{ color: '#9f3b2f' }}>→</span>
                      <span style={{ fontWeight: 700, color: '#7f2f27' }}>
                            {latestCity}
                          </span>
                        </>
                      )}
                      <span style={{ color: '#494b46', fontSize: '15px' }}>
                        ({b.sightingsCount}回目・約{b.totalDistanceKm}km)
                      </span>
                    </div>
                  </div>

                  {!isSample && <ArrowRight size={18} color="#94a3b8" />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 紙幣書き込み禁止のマナー啓発 */}
      <section className="manner-notice">
        <ShieldCheck size={24} color="#b45309" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <h3 className="manner-title">お札への書き込み・シール等は厳禁です</h3>
          <p className="manner-text">
            このプロジェクトは、自然に市中を流通している紙幣の偶然の再会をみんなで見守る市民実験です。
            お札へのペンでの書き込み、スタンプ、シールの貼付等は、紙幣を傷め法律やマナーに反するため絶対にやめましょう。
          </p>
        </div>
      </section>
    </div>
  );
};
