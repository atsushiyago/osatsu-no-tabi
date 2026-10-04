import { useEffect, useRef, useState } from 'react';
import { ArrowRight, WalletCards } from 'lucide-react';
import {
  getTrackedBillsPage,
  type TrackedBillRow,
  type TrackedBillsCursor,
} from '../services/trackedBills';
import { getUnseenTrackedBills } from '../utils/trackedBillState.js';

interface TrackedBillsViewProps {
  uid: string;
  restoreTargetBillId: string | null;
  restoreVisibleCount: number | null;
  onSelectBill: (publicBillId: string, visibleCount: number) => void;
  onRestoreComplete: () => void;
  syncState: 'anonymous' | 'linked' | 'other' | 'unavailable';
  syncing: boolean;
  syncError: string | null;
  onGoogleSync: () => void;
  popupFallbackAvailable: boolean;
  onGooglePopupFallback: () => void;
}

export function TrackedBillsView({
  uid,
  restoreTargetBillId,
  restoreVisibleCount,
  onSelectBill,
  onRestoreComplete,
  syncState,
  syncing,
  syncError,
  onGoogleSync,
  popupFallbackAvailable,
  onGooglePopupFallback,
}: TrackedBillsViewProps) {
  const [rows, setRows] = useState<TrackedBillRow[]>([]);
  const [cursor, setCursor] = useState<TrackedBillsCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const loadingMoreRef = useRef(false);
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
    if (loading || !restoreTargetBillId) return;
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-public-bill-id]'))
      .find((element) => element.dataset.publicBillId === restoreTargetBillId);
    target?.scrollIntoView({ block: 'center', behavior: 'auto' });
    onRestoreComplete();
  }, [loading, onRestoreComplete, restoreTargetBillId, rows]);

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

  return (
    <section className="tracked-bills-view">
      <h1>登録したお札</h1>
      <p className="tracked-bills-note">
        {syncState === 'linked'
          ? 'Googleと同期した登録したお札の一覧です。同じGoogleアカウントで別の端末からも確認できます。'
          : 'この端末・ブラウザから登録したお札の一覧です。'}
      </p>
      {syncState === 'anonymous' && (
        <section className="tracked-bills-sync" aria-labelledby="tracked-bills-sync-title">
          <div>
            <h2 id="tracked-bills-sync-title">別の端末でも登録したお札を見る</h2>
            <p>Googleアカウントと同期すると、別のブラウザや端末でも同じ一覧を確認できます。</p>
          </div>
          <button type="button" onClick={onGoogleSync} disabled={syncing}>
            {syncing ? 'Googleと同期しています…' : 'Googleで同期する'}
          </button>
          {popupFallbackAvailable && (
            <div className="tracked-bills-sync-fallback">
              <p>Googleアカウントを確認できませんでした。ボタンを押して、既存の同期データを開いてください。</p>
              <button type="button" onClick={onGooglePopupFallback} disabled={syncing}>
                Googleアカウントのデータを開く
              </button>
            </div>
          )}
          {syncError && <p className="tracked-bills-sync-error" role="alert">{syncError}</p>}
        </section>
      )}
      {syncState === 'linked' && (
        <section className="tracked-bills-sync tracked-bills-sync-linked" aria-live="polite">
          <h2>Googleと同期しています</h2>
          <p>別の端末でも同じGoogleアカウントで利用できます。</p>
        </section>
      )}
      {!loading && !hasMore && !error && newBillCount > 0 && (
        <p className="tracked-bills-new-summary" role="status">
          {newBillCount}枚のお札に新しい発見があります
        </p>
      )}
      {loading ? <p role="status">一覧を読み込んでいます…</p> : null}
      {!loading && error ? <p role="alert">一覧を読み込めませんでした。通信環境を確認してください。</p> : null}
      {!loading && !error && rows.length === 0 ? (
        <div className="tracked-bills-empty">
          <WalletCards size={32} aria-hidden="true" />
          <h2>登録したお札はまだありません</h2>
          <p>最初に登録したお札が、ここに表示されます。</p>
        </div>
      ) : null}
      {error && rows.length > 0 && <p role="alert">次のお札を読み込めませんでした。もう一度お試しください。</p>}
      <div className="tracked-bills-list" aria-label="登録したお札の一覧">
        {rows.map((row) => {
          const { bill } = row;
          const latestSighting = bill.sightings[bill.sightings.length - 1];
          const currentMunicipality = latestSighting?.municipality;
          return (
            <button
              className="tracked-bill-card"
              key={bill.id}
              data-public-bill-id={bill.id}
              onClick={() => onSelectBill(bill.id, rows.length)}
            >
              <span className="tracked-bill-card-main">
                <strong>{row.serialNumber}</strong>
                {row.unseenSightingsCount > 0 && (
                  <span className="tracked-bill-new-badge">
                    新しい発見あり +{row.unseenSightingsCount}
                  </span>
                )}
                <span>{bill.denomination.toLocaleString()}円札</span>
                <span>最終発見地: {latestSighting ? `${latestSighting.prefecture} ${latestSighting.municipality}` : '記録なし'}</span>
                {row.lastSeenMunicipality && currentMunicipality && row.lastSeenMunicipality !== currentMunicipality && (
                  <span
                    className="travel-route tracked-bill-region-change"
                    aria-label={`前回確認 ${row.lastSeenMunicipality} から現在 ${currentMunicipality} へ`}
                  >
                    <span><small>前回</small>{row.lastSeenMunicipality}</span>
                    <span className="travel-route-dots" aria-hidden="true">··· →</span>
                    <span><small>現在</small>{currentMunicipality}</span>
                  </span>
                )}
                <span>発見回数: {bill.sightingsCount}回</span>
                <span>最終発見: {new Date(bill.lastSightedAt).toLocaleString('ja-JP')}</span>
              </span>
              <ArrowRight size={20} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {!loading && hasMore && (
        <button className="btn-secondary public-bills-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? '読み込んでいます…' : 'もっと見る'}
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
          もう一度読み込む
        </button>
      )}
    </section>
  );
}
