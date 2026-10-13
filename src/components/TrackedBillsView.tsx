import { useEffect, useRef, useState } from 'react';
import { ArrowRight, WalletCards } from 'lucide-react';
import {
  getTrackedBillsPage,
  type TrackedBillRow,
  type TrackedBillsCursor,
} from '../services/trackedBills';
import { getUnseenTrackedBills } from '../utils/trackedBillState.js';
import { useI18n } from '../useI18n';
import { getLocalizedPlaceName, getLocalizedLocationLabel } from '../utils/geo';
import type { TrackedBillMergeProgress } from '../services/trackedBillMerge';

interface TrackedBillsViewProps {
  uid: string;
  restoreTargetBillId: string | null;
  followingRestoreTargetBillId: string | null;
  restoreVisibleCount: number | null;
  restoreListKind: 'registered' | 'following' | null;
  onSelectBill: (publicBillId: string, visibleCount: number, listKind: 'registered' | 'following') => void;
  onRestoreComplete: () => void;
  syncState: 'anonymous' | 'linked' | 'other' | 'unavailable';
  syncing: boolean;
  syncError: string | null;
  onGoogleSync: () => void;
  popupFallbackAvailable: boolean;
  onGooglePopupFallback: () => void;
  syncDiagnostic: { stage: string; code: string | null; transport: string } | null;
  mergeProgress: TrackedBillMergeProgress | null;
  mergeResumeAvailable: boolean;
  onGoogleMergeResume: () => void;
}

export function TrackedBillsView({
  uid,
  restoreTargetBillId,
  followingRestoreTargetBillId,
  restoreVisibleCount,
  restoreListKind,
  onSelectBill,
  onRestoreComplete,
  syncState,
  syncing,
  syncError,
  onGoogleSync,
  popupFallbackAvailable,
  onGooglePopupFallback,
  syncDiagnostic,
  mergeProgress,
  mergeResumeAvailable,
  onGoogleMergeResume,
}: TrackedBillsViewProps) {
  const { language, t, number, date, yen } = useI18n();
  const [rows, setRows] = useState<TrackedBillRow[]>([]);
  const [cursor, setCursor] = useState<TrackedBillsCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [followingRows, setFollowingRows] = useState<TrackedBillRow[]>([]);
  const [followingCursor, setFollowingCursor] = useState<TrackedBillsCursor | null>(null);
  const [followingHasMore, setFollowingHasMore] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(true);
  const [followingLoadingMore, setFollowingLoadingMore] = useState(false);
  const [followingError, setFollowingError] = useState(false);
  const [followingRetryKey, setFollowingRetryKey] = useState(0);
  const loadingMoreRef = useRef(false);
  const followingLoadingMoreRef = useRef(false);
  const initialRestoreRef = useRef({
    billId: restoreTargetBillId,
    visibleCount: restoreVisibleCount,
  });
  const newBillCount = getUnseenTrackedBills(rows).length;

  useEffect(() => {
    let active = true;
    const { billId: targetBillId, visibleCount: targetVisibleCount } = initialRestoreRef.current;
    const loadInitialPages = async () => {
      const loadedRows: TrackedBillRow[] = [];
      let nextCursor: TrackedBillsCursor | null = null;
      let hasMorePages = false;
      try {
        let page = await getTrackedBillsPage(uid);
        loadedRows.push(...page.rows);
        nextCursor = page.nextCursor;
        hasMorePages = page.hasMore;

        while (
          active &&
          nextCursor &&
          targetBillId &&
          targetVisibleCount !== null &&
          (loadedRows.length < targetVisibleCount ||
            !loadedRows.some((row) => row.bill.id === targetBillId))
        ) {
          page = await getTrackedBillsPage(uid, nextCursor);
          loadedRows.push(...page.rows);
          nextCursor = page.nextCursor;
          hasMorePages = page.hasMore;
        }

        if (active) {
          setRows(loadedRows);
          setCursor(nextCursor);
          setHasMore(hasMorePages);
        }
      } catch (reason) {
        console.error('Could not load tracked bills:', reason);
        if (active) {
          setRows(loadedRows);
          setCursor(nextCursor);
          setHasMore(hasMorePages);
          setError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadInitialPages();
    return () => { active = false; };
  }, [retryKey, uid]);

  useEffect(() => {
    let active = true;
    const loadFollowing = async () => {
      let loadedRows: TrackedBillRow[] = [];
      let nextCursor: TrackedBillsCursor | null = null;
      let hasMorePages = false;
      try {
        let page = await getTrackedBillsPage(uid, null, false);
        loadedRows.push(...page.rows);
        nextCursor = page.nextCursor;
        hasMorePages = page.hasMore;
        while (
          active && restoreListKind === 'following' && followingRestoreTargetBillId && restoreVisibleCount !== null &&
          nextCursor && (loadedRows.length < restoreVisibleCount ||
            !loadedRows.some((row) => row.bill.id === followingRestoreTargetBillId))
        ) {
          page = await getTrackedBillsPage(uid, nextCursor, false);
          loadedRows.push(...page.rows);
          nextCursor = page.nextCursor;
          hasMorePages = page.hasMore;
        }
        if (active) {
          setFollowingRows(loadedRows);
          setFollowingCursor(nextCursor);
          setFollowingHasMore(hasMorePages);
          setFollowingError(false);
        }
      } catch (reason) {
        console.error('Could not load followed tracked bills:', reason);
        if (active) {
          setFollowingRows(loadedRows);
          setFollowingCursor(nextCursor);
          setFollowingHasMore(hasMorePages);
          setFollowingError(true);
        }
      } finally {
        if (active) setFollowingLoading(false);
      }
    };
    void loadFollowing();
    return () => { active = false; };
  }, [followingRetryKey, followingRestoreTargetBillId, restoreListKind, restoreVisibleCount, uid]);

  useEffect(() => {
    if (loading || !restoreTargetBillId) return;
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-public-bill-id]'))
      .find((element) => element.dataset.publicBillId === restoreTargetBillId);
    target?.scrollIntoView({ block: 'center', behavior: 'auto' });
    onRestoreComplete();
  }, [loading, onRestoreComplete, restoreTargetBillId, rows]);

  useEffect(() => {
    if (followingLoading || restoreListKind !== 'following' || !followingRestoreTargetBillId) return;
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-public-bill-id]'))
      .find((element) => element.dataset.publicBillId === followingRestoreTargetBillId);
    target?.scrollIntoView({ block: 'center', behavior: 'auto' });
    onRestoreComplete();
  }, [followingLoading, onRestoreComplete, restoreListKind, followingRestoreTargetBillId, followingRows]);

  const loadMore = async () => {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(false);
    try {
      const page = await getTrackedBillsPage(uid, cursor);
      setRows((current) => [...current, ...page.rows]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (reason) {
      console.error('Could not load the next tracked bills page:', reason);
      setError(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const loadMoreFollowing = async () => {
    if (!followingCursor || followingLoadingMoreRef.current) return;
    followingLoadingMoreRef.current = true;
    setFollowingLoadingMore(true);
    setFollowingError(false);
    try {
      const page = await getTrackedBillsPage(uid, followingCursor, false);
      setFollowingRows((current) => [...current, ...page.rows]);
      setFollowingCursor(page.nextCursor);
      setFollowingHasMore(page.hasMore);
    } catch (reason) {
      console.error('Could not load the next followed tracked bills page:', reason);
      setFollowingError(true);
    } finally {
      followingLoadingMoreRef.current = false;
      setFollowingLoadingMore(false);
    }
  };

  const renderBillCard = (row: TrackedBillRow, visibleCount: number, listKind: 'registered' | 'following') => {
    const { bill } = row;
    const latestSighting = bill.sightings[bill.sightings.length - 1];
    const currentMunicipality = latestSighting?.municipality;
    return (
      <button
        className="tracked-bill-card"
        key={bill.id}
        data-public-bill-id={bill.id}
        onClick={() => onSelectBill(bill.id, visibleCount, listKind)}
      >
        <span className="tracked-bill-card-main">
          <strong>{row.serialNumber}</strong>
          {row.unseenSightingsCount > 0 && (
            <span className="tracked-bill-new-badge">
              {t('newDiscoveryBadge', { count: number(row.unseenSightingsCount) })}
            </span>
          )}
          <span>{t('yenBill', { amount: language === 'ja' ? number(bill.denomination) : yen(bill.denomination) })}</span>
          <span>{latestSighting
            ? t('lastLocation', { city: getLocalizedLocationLabel(latestSighting.prefecture, latestSighting.municipality, language) })
            : t('noRecord')}</span>
          {row.lastSeenMunicipality && currentMunicipality && row.lastSeenMunicipality !== currentMunicipality && (
            <span
              className="travel-route tracked-bill-region-change"
              aria-label={`${t('previous')} ${getLocalizedPlaceName(row.lastSeenMunicipality, language)} → ${t('current')} ${currentMunicipality ? getLocalizedPlaceName(currentMunicipality, language) : ''}`}
            >
              <span><small>{t('previous')}</small>{getLocalizedPlaceName(row.lastSeenMunicipality, language)}</span>
              <span className="travel-route-dots" aria-hidden="true">··· →</span>
              <span><small>{t('current')}</small>{getLocalizedPlaceName(currentMunicipality, language)}</span>
            </span>
          )}
          <span>{t('discoveryCount')}: {number(bill.sightingsCount)}{t('statsSightingUnit')}</span>
          <span>{t('lastSighted', { date: date(bill.lastSightedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
        </span>
        <ArrowRight size={20} aria-hidden="true" />
      </button>
    );
  };

  return (
    <section className="tracked-bills-view">
      <h1>{t('trackedTitle')}</h1>
      <p className="tracked-bills-note">
        {syncState === 'linked'
          ? t('syncedNote')
          : t('localNote')}
      </p>
      {syncState === 'anonymous' && (
        <section className="tracked-bills-sync" aria-labelledby="tracked-bills-sync-title">
          <div>
            <h2 id="tracked-bills-sync-title">{t('syncTitle')}</h2>
            <p>{t('syncDescription')}</p>
          </div>
          <button type="button" onClick={onGoogleSync} disabled={syncing}>
            {syncing ? t('syncProgress') : t('syncButton')}
          </button>
          {popupFallbackAvailable && (
            <div className="tracked-bills-sync-fallback">
              <p>{t('popupFallbackDescription')}</p>
              <button type="button" onClick={onGooglePopupFallback} disabled={syncing}>
                {t('popupFallbackButton')}
              </button>
            </div>
          )}
          {mergeProgress && (
            <p className="tracked-bills-merge-progress" role="status" aria-live="polite">
              {t('mergeProgress', {
                copiedCount: number(mergeProgress.copiedCount),
                totalCount: number(mergeProgress.totalCount),
                duplicateCount: number(mergeProgress.duplicateCount),
              })}{' '}
              {t(mergeProgress.phase === 'preparing' ? 'mergePhasePreparing'
                : mergeProgress.phase === 'copying' ? 'mergePhaseCopying' : 'mergePhaseFinishing')}
            </p>
          )}
          {mergeResumeAvailable && !syncing && (
            <button type="button" onClick={onGoogleMergeResume}>
              {t('mergeResume')}
            </button>
          )}
          {syncError && <p className="tracked-bills-sync-error" role="alert">{syncError}</p>}
          {syncDiagnostic && (
            <small className="tracked-bills-sync-diagnostic" role="status" data-testid="google-sync-diagnostic">
              Emulator diagnostic: {syncDiagnostic.stage}{syncDiagnostic.code ? ` · ${syncDiagnostic.code}` : ''}<br />
              {syncDiagnostic.transport}
            </small>
          )}
        </section>
      )}
      {syncState === 'linked' && (
        <section className="tracked-bills-sync tracked-bills-sync-linked" aria-live="polite">
          <h2>{t('syncedTitle')}</h2>
          <p>{t('syncedDescription')}</p>
        </section>
      )}
      {!loading && !hasMore && !error && newBillCount > 0 && (
        <p className="tracked-bills-new-summary" role="status">
          {t('newDiscoveries', { count: number(newBillCount) })}
        </p>
      )}
      {loading ? <p role="status">{t('loadingList')}</p> : null}
      {!loading && error ? <p role="alert">{t('loadError')}</p> : null}
      {!loading && !error && rows.length === 0 ? (
        <div className="tracked-bills-empty">
          <WalletCards size={32} aria-hidden="true" />
          <h2>{t('trackedEmpty')}</h2>
          <p>{t('trackedEmptyHint')}</p>
        </div>
      ) : null}
      {error && rows.length > 0 && <p role="alert">{t('trackedNextError')}</p>}
      <div className="tracked-bills-list" aria-label={t('trackedListLabel')}>
        {rows.map((row) => renderBillCard(row, rows.length, 'registered'))}
      </div>
      {!loading && hasMore && (
        <button className="btn-secondary public-bills-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? t('loadingMore') : t('loadMore')}
        </button>
      )}
      {!loading && error && rows.length === 0 && (
        <button
          className="btn-secondary public-bills-retry"
          onClick={() => {
            setLoading(true);
            setError(false);
            setRetryKey((key) => key + 1);
          }}
        >
          {t('retry')}
        </button>
      )}
      {!followingLoading && followingRows.length > 0 && (
        <section className="tracked-bills-following" aria-labelledby="tracked-bills-following-title">
          <h2 id="tracked-bills-following-title">{t('trackedFollowingTitle')}</h2>
          <p>{t('trackedFollowingDescription')}</p>
          {followingError && <p role="alert">{t('trackedNextError')}</p>}
          <div className="tracked-bills-list" aria-label={t('trackedFollowingTitle')}>
            {followingRows.map((row) => renderBillCard(row, followingRows.length, 'following'))}
          </div>
          {followingHasMore && (
            <button className="btn-secondary public-bills-more" onClick={loadMoreFollowing} disabled={followingLoadingMore}>
              {followingLoadingMore ? t('loadingMore') : t('loadMore')}
            </button>
          )}
        </section>
      )}
      {!followingLoading && followingError && followingRows.length === 0 && (
        <section className="tracked-bills-following" aria-labelledby="tracked-bills-following-title">
          <h2 id="tracked-bills-following-title">{t('trackedFollowingTitle')}</h2>
          <p role="alert">{t('loadError')}</p>
          <button className="btn-secondary public-bills-retry" onClick={() => { setFollowingLoading(true); setFollowingError(false); setFollowingRetryKey((key) => key + 1); }}>
            {t('retry')}
          </button>
        </section>
      )}
    </section>
  );
}
