import { useEffect, useState } from 'react';
import { JourneyBillCard } from './JourneyBillCard';
import {
  getPublicBillsPage,
  type PublicBillsCursor,
} from '../services/billService';
import type { Bill } from '../types';

interface PublicBillsViewProps {
  onSelectBill: (publicBillId: string) => void;
  onInitialLoadComplete: () => void;
}

export function PublicBillsView({ onSelectBill, onInitialLoadComplete }: PublicBillsViewProps) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [cursor, setCursor] = useState<PublicBillsCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    getPublicBillsPage()
      .then((page) => {
        if (!active) return;
        setBills(page.bills);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
      .catch((reason) => {
        console.error('Could not load public bills:', reason);
        if (active) setError(true);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          onInitialLoadComplete();
        }
      });
    return () => { active = false; };
  }, [onInitialLoadComplete, retryKey]);

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
              onSelectBill={onSelectBill}
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
