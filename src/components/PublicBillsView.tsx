import { useEffect, useRef, useState } from 'react';
import { JourneyBillCard } from './JourneyBillCard';
import {
  getPublicBillsPage,
  type PublicBillsCursor,
} from '../services/billService';
import type { Bill } from '../types';
import { useI18n } from '../useI18n';

interface PublicBillsViewProps {
  onSelectBill: (publicBillId: string, visibleCount: number) => void;
  restoreTargetBillId: string | null;
  restoreVisibleCount: number | null;
  onRestoreComplete: () => void;
}

export function PublicBillsView({
  onSelectBill,
  restoreTargetBillId,
  restoreVisibleCount,
  onRestoreComplete,
}: PublicBillsViewProps) {
  const { t } = useI18n();
  const [bills, setBills] = useState<Bill[]>([]);
  const [cursor, setCursor] = useState<PublicBillsCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const initialRestoreRef = useRef({
    billId: restoreTargetBillId,
    visibleCount: restoreVisibleCount,
  });

  useEffect(() => {
    let active = true;
    const { billId: targetBillId, visibleCount: targetVisibleCount } = initialRestoreRef.current;
    const loadInitialPage = async () => {
      const loadedBills: Bill[] = [];
      let nextCursor: PublicBillsCursor | null = null;
      let hasMorePages = false;
      try {
        let page = await getPublicBillsPage();
        loadedBills.push(...page.bills);
        nextCursor = page.nextCursor;
        hasMorePages = page.hasMore;

        while (
          active &&
          nextCursor &&
          targetBillId &&
          targetVisibleCount !== null &&
          (loadedBills.length < targetVisibleCount ||
            !loadedBills.some((bill) => bill.id === targetBillId))
        ) {
          page = await getPublicBillsPage(nextCursor);
          loadedBills.push(...page.bills);
          nextCursor = page.nextCursor;
          hasMorePages = page.hasMore;
        }

        if (active) {
          setBills(loadedBills);
          setCursor(nextCursor);
          setHasMore(hasMorePages);
        }
      } catch (reason) {
        console.error('Could not load public bills:', reason);
        if (active) {
          setBills(loadedBills);
          setCursor(nextCursor);
          setHasMore(hasMorePages);
          setError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadInitialPage();
    return () => { active = false; };
  }, [retryKey]);

  useEffect(() => {
    if (loading || !restoreTargetBillId) return;
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-public-bill-id]'))
      .find((element) => element.dataset.publicBillId === restoreTargetBillId);
    target?.scrollIntoView({ block: 'center', behavior: 'auto' });
    onRestoreComplete();
  }, [bills, loading, onRestoreComplete, restoreTargetBillId]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(false);
    try {
      const page = await getPublicBillsPage(cursor);
      setBills((current) => [...current, ...page.bills]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (reason) {
      console.error('Could not load the next public bills page:', reason);
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="public-bills-view" aria-labelledby="public-bills-title">
      <h1 id="public-bills-title">{t('publicBillsTitle')}</h1>
      <p className="tracked-bills-note">{t('publicBillsDescription')}</p>

      {loading && <p role="status">{t('loadingList')}</p>}
      {!loading && error && bills.length === 0 && (
        <div>
          <p role="alert">{t('loadError')}</p>
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
        </div>
      )}
      {!loading && !error && bills.length === 0 && (
        <div className="tracked-bills-empty">
          <h2>{t('noPublicBills')}</h2>
        </div>
      )}

      {bills.length > 0 && (
        <div className="tracked-bills-list" aria-label={t('publicListLabel')}>
          {bills.map((bill) => (
            <JourneyBillCard
              key={bill.id}
              bill={bill}
              latestCity={bill.lastMunicipality}
              onSelectBill={(publicBillId) => onSelectBill(publicBillId, bills.length)}
            />
          ))}
        </div>
      )}

      {error && bills.length > 0 && <p role="alert">{t('nextPageError')}</p>}
      {!loading && hasMore && (
        <button className="btn-secondary public-bills-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? t('loadingMore') : t('loadMore')}
        </button>
      )}
    </section>
  );
}
