import { useEffect, useState } from 'react';
import {
  Compass,
  PlusCircle,
  TrendingUp,
  Award,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import type { GlobalStats, BillWithSightings } from '../types';
import { getGlobalStats, getRecentJourneys } from '../services/billService';
import { SAMPLE_JOURNEYS } from '../data/sampleJourneys';
import type { TrackedBillRow } from '../services/trackedBills';
import { getUnseenTrackedBills } from '../utils/trackedBillState.js';
import { getLatestPublicSightingRoute } from '../utils/journeyRoute';
import { JourneyBillCard } from './JourneyBillCard';

interface HomeViewProps {
  onNavigateRegister: (initialSerial?: string) => void;
  onNavigateSearch: () => void;
  onSelectBill: (publicBillId: string) => void;
  trackedBills: TrackedBillRow[] | null;
  onNavigateTrackedBills: () => void;
  onNavigateBills: () => void;
}

export const HomeView = ({
  onNavigateRegister,
  onSelectBill,
  trackedBills,
  onNavigateTrackedBills,
  onNavigateBills,
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
  const newTrackedBills = trackedBills ? getUnseenTrackedBills(trackedBills) : [];
  const leadingNewBill = newTrackedBills[0];
  const latestPublicSightingRoute = getLatestPublicSightingRoute(leadingNewBill?.bill.sightings);

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
            <h2 id="home-new-discovery-title">あなたのお札に新しい旅の記録があります</h2>
            <p>
              {newTrackedBills.length === 1
                ? '1枚のお札が、また別の場所で見つかりました'
                : `${newTrackedBills.length}枚のお札に新しい発見があります`}
            </p>
          </div>
          <span className="rediscovery-stamp" aria-label="再発見の記録">
            <span>再発見</span>
          </span>
          {latestPublicSightingRoute && (
            <div
              className="travel-route home-new-discovery-route"
              aria-label={`直近の移動 ${latestPublicSightingRoute.from} から ${latestPublicSightingRoute.to} へ`}
            >
              <span>{latestPublicSightingRoute.from}</span>
              <span className="travel-route-dots" aria-hidden="true">··· →</span>
              <span>{latestPublicSightingRoute.to}</span>
            </div>
          )}
          <button className="home-new-discovery-link" onClick={onNavigateTrackedBills}>
            <span>登録したお札を見る</span>
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
        </div>
      </section>

      <aside className="home-return-note" aria-label="また旅の続きを見る楽しみ">
        <p>登録後も、お札はいつも通りお使いください。</p>
        <p className="home-return-note-followup">数週間後、また旅の続きを見にきてください。</p>
      </aside>

      {/* 全体統計 */}
      <section className="stats-container">
        <div className="stats-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <TrendingUp size={16} color="#9f3b2f" />
            <span>全国の旅の統計</span>
          </div>
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
            <button className="home-all-bills-link" type="button" onClick={onNavigateBills}>
              すべて見る <ArrowRight size={16} aria-hidden="true" />
            </button>
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
                <JourneyBillCard
                  key={b.id}
                  bill={b}
                  isSample={isSample}
                  startCity={startCity}
                  latestCity={b.sightings.length > 1 ? latestCity : startCity}
                  onSelectBill={onSelectBill}
                />
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
