import { ArrowRight, WalletCards } from 'lucide-react';
import type { TrackedBillRow } from '../services/trackedBills';
import { formatSerialDisplay } from '../utils/serial';
import { getUnseenTrackedBills } from '../utils/trackedBillState.js';

interface TrackedBillsViewProps {
  rows: TrackedBillRow[];
  loading: boolean;
  error: boolean;
  onSelectBill: (serial: string) => void;
}

export function TrackedBillsView({ rows, loading, error, onSelectBill }: TrackedBillsViewProps) {
  const newBillCount = getUnseenTrackedBills(rows).length;

  return (
    <section className="tracked-bills-view">
      <h1>登録したお札</h1>
      <p className="tracked-bills-note">
        この端末・ブラウザから登録したお札の一覧です。ブラウザデータを削除したり端末を変更すると、現在の状態では一覧を引き継げません。
      </p>
      {!loading && !error && newBillCount > 0 && (
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
      <div className="tracked-bills-list">
        {rows.map((row) => {
          const { bill } = row;
          const latestSighting = bill.sightings[bill.sightings.length - 1];
          const currentMunicipality = latestSighting?.municipality;
          return (
            <button
              className="tracked-bill-card"
              key={bill.id}
              onClick={() => onSelectBill(bill.serialNumber)}
            >
              <span className="tracked-bill-card-main">
                <strong>{formatSerialDisplay(bill.serialNumber)}</strong>
                {row.unseenSightingsCount > 0 && (
                  <span className="tracked-bill-new-badge">
                    新しい発見あり +{row.unseenSightingsCount}
                  </span>
                )}
                <span>{bill.denomination.toLocaleString()}円札</span>
                <span>最終発見地域: {latestSighting ? `${latestSighting.prefecture} ${latestSighting.municipality}` : '記録なし'}</span>
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
    </section>
  );
}
