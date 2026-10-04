import { useEffect, useRef, useState } from 'react';
import { JourneyBillCard } from './JourneyBillCard';
import {
  getPublicBillsPage,
  type PublicBillsCursor,
} from '../services/billService';
import type { Bill } from '../types';

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
      <h1 id="public-bills-title">みんなのお札</h1>
      <p className="tracked-bills-note">登録されたお札を新しい順に表示しています。</p>

      {loading && <p role="status">一覧を読み込んでいます…</p>}
      {!loading && error && bills.length === 0 && (
        <div>
          <p role="alert">一覧を読み込めませんでした。通信環境を確認してください。</p>
          <button
            className="btn-secondary public-bills-retry"
            onClick={() => {
              setLoading(true);
              setError(false);
              setRetryKey((key) => key + 1);
            }}
          >
            もう一度読み込む
          </button>
        </div>
      )}
      {!loading && !error && bills.length === 0 && (
        <div className="tracked-bills-empty">
          <h2>まだ登録されたお札はありません</h2>
        </div>
      )}

      {bills.length > 0 && (
        <div className="tracked-bills-list" aria-label="登録された公開紙幣">
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

      {error && bills.length > 0 && <p role="alert">次の一覧を読み込めませんでした。もう一度お試しください。</p>}
      {!loading && hasMore && (
        <button className="btn-secondary public-bills-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? '読み込んでいます…' : 'もっと見る'}
        </button>
      )}
    </section>
  );
}
