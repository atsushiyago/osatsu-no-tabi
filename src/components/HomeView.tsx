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
import { useI18n } from '../useI18n';
import { getLocalizedPlaceName } from '../utils/geo';

interface HomeViewProps {
  onNavigateRegister: (initialSerial?: string) => void;
  onNavigateSearch: () => void;
  onSelectBill: (publicBillId: string) => void;
  trackedBills: TrackedBillRow[] | null;
  onNavigateTrackedBills: () => void;
  onNavigateBills: () => void;
  restoreTargetBillId: string | null;
  onRestoreComplete: () => void;
}

export const HomeView = ({
  onNavigateRegister,
  onSelectBill,
  trackedBills,
  onNavigateTrackedBills,
  onNavigateBills,
  restoreTargetBillId,
  onRestoreComplete,
}: HomeViewProps) => {
  const { language, t, number } = useI18n();
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

  useEffect(() => {
    if (loading || !restoreTargetBillId) return;
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-public-bill-id]'))
      .find((element) => element.dataset.publicBillId === restoreTargetBillId);
    target?.scrollIntoView({ block: 'center', behavior: 'auto' });
    onRestoreComplete();
  }, [loading, onRestoreComplete, recentJourneys, restoreTargetBillId]);

  return (
    <div>
      {newTrackedBills.length > 0 && (
        <section className="home-new-discovery" aria-labelledby="home-new-discovery-title">
          <div className="home-new-discovery-copy">
            <span className="home-new-discovery-kicker">{t('newDiscoveryKicker')}</span>
            <h2 id="home-new-discovery-title">{t('newDiscoveryTitle')}</h2>
            <p>
              {newTrackedBills.length === 1
                ? t('newDiscoveryOne')
                : t('newDiscoveryMany', { count: number(newTrackedBills.length) })}
            </p>
          </div>
          <span className="rediscovery-stamp" aria-label={t('rediscovery')}>
            <span>{t('rediscovery')}</span>
          </span>
          {latestPublicSightingRoute && (
            <div
              className="travel-route home-new-discovery-route"
              aria-label={t('recentMove', {
                from: getLocalizedPlaceName(latestPublicSightingRoute.from, language),
                to: getLocalizedPlaceName(latestPublicSightingRoute.to, language),
              })}
            >
              <span>{getLocalizedPlaceName(latestPublicSightingRoute.from, language)}</span>
              <span className="travel-route-dots" aria-hidden="true">··· →</span>
              <span>{getLocalizedPlaceName(latestPublicSightingRoute.to, language)}</span>
            </div>
          )}
          <button className="home-new-discovery-link" onClick={onNavigateTrackedBills}>
            <span>{t('viewTracked')}</span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </section>
      )}

      {/* ヒーロー */}
      <section className="hero">
        <div className="hero-tag">
          <Compass size={14} />
          <span>{t('heroTag')}</span>
        </div>

        <h1 className="hero-title">
          {t('heroTitle')}
        </h1>

        <p className="hero-desc">
          {t('heroDescription')}
        </p>

        <div className="cta-group">
          <button
            className="btn-primary"
            onClick={() => onNavigateRegister()}
            id="btn-register-top"
          >
            <PlusCircle size={20} />
            <span>{t('registerBill')}</span>
          </button>
        </div>
      </section>

      <aside className="home-return-note" aria-label={t('returnNoteLabel')}>
        <p>{t('returnNote')}</p>
        <p className="home-return-note-followup">{t('returnNoteFollowup')}</p>
      </aside>

      {/* 全体統計 */}
      <section className="stats-container">
        <div className="stats-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <TrendingUp size={16} color="#9f3b2f" />
            <span>{t('statsTitle')}</span>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">{t('registeredBills')}</span>
            <div className="stat-value">
              {loading ? '...' : number(stats?.totalBills ?? 0)}
              <span className="stat-unit">{t('statsBillUnit')}</span>
            </div>
          </div>

          <div className="stat-card">
            <span className="stat-label">{t('sightings')}</span>
            <div className="stat-value">
              {loading ? '...' : number(stats?.totalSightings ?? 0)}
              <span className="stat-unit">{t('statsSightingUnit')}</span>
            </div>
          </div>

          <div className="stat-card">
            <span className="stat-label">{t('rediscoveredBills')}</span>
            <div className="stat-value" style={{ color: '#9f3b2f' }}>
              {loading ? '...' : number(stats?.rediscoveredBills ?? 0)}
              <span className="stat-unit">{t('statsBillUnit')}</span>
            </div>
          </div>

          <div className="stat-card">
            <span className="stat-label">{t('longestDistance')}</span>
            <div className="stat-value" style={{ color: '#365d4a' }}>
              {loading ? '...' : number(stats?.maxDistanceKm ?? 0)}
              <span className="stat-unit">{t('distanceUnit')}</span>
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
              <span>{t('recentJourneys')}</span>
            </h2>
            <button className="home-all-bills-link" type="button" onClick={onNavigateBills}>
              {t('seeAll')} <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {displayedJourneys.map((b) => {
              const isSample = b.id.startsWith('sample-');
              const startCity = b.sightings[0]
                ? `${b.sightings[0].municipality}`
                : t('unknown');
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
            <h3 className="manner-title">{t('mannerTitle')}</h3>
          <p className="manner-text">
            {t('mannerText')}
          </p>
        </div>
      </section>

    </div>
  );
};
