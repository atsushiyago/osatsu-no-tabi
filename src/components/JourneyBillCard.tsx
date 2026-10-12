import { ArrowRight, MapPin } from 'lucide-react';
import type { Bill } from '../types';
import { useI18n } from '../useI18n';
import { getLocalizedPlaceName } from '../utils/geo';

interface JourneyBillCardProps {
  bill: Bill;
  isSample?: boolean;
  startCity?: string;
  latestCity?: string;
  onSelectBill?: (publicBillId: string) => void;
}

export function JourneyBillCard({
  bill,
  isSample = false,
  startCity,
  latestCity,
  onSelectBill,
}: JourneyBillCardProps) {
  const { language, t, number, yen } = useI18n();
  const currentCity = latestCity || bill.lastMunicipality || startCity || '不明';
  const clickable = !isSample && Boolean(onSelectBill);

  return (
    <div
      className="journey-row"
      data-public-bill-id={clickable ? bill.id : undefined}
      onClick={clickable ? () => onSelectBill?.(bill.id) : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectBill?.(bill.id);
        }
      } : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '14px',
        padding: '14px 16px',
        cursor: clickable ? 'pointer' : 'default',
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
          {isSample && <span className="sample-badge">{t('sample')}</span>}
          {!isSample && (
            <span
              style={{
                backgroundColor: '#eee5d5',
                color: '#463924',
                fontSize: '15px',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '6px',
              }}
            >
              {t('yenBill', { amount: language === 'ja' ? number(bill.denomination) : yen(bill.denomination) })}
            </span>
          )}
          <span
            style={{
              fontFamily: 'monospace',
              fontWeight: 700,
              fontSize: isSample ? '15px' : '13px',
              color: '#334155',
            }}
          >
            {isSample ? t('sampleJourney', { id: bill.id.slice(-3) }) : t('journeyBill', { id: bill.id.slice(0, 4).toUpperCase() })}
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
          {startCity ? (
            <>
              <span>{getLocalizedPlaceName(startCity, language)}</span>
              {currentCity !== startCity && (
                <>
                  <span style={{ color: '#9f3b2f' }}>→</span>
                  <span style={{ fontWeight: 700, color: '#7f2f27' }}>{getLocalizedPlaceName(currentCity, language)}</span>
                </>
              )}
            </>
          ) : (
            <span>{t('lastLocation', { city: getLocalizedPlaceName(currentCity, language) })}</span>
          )}
          <span style={{ color: '#494b46', fontSize: '15px' }}>
            ({t('discoveryNth', { count: number(bill.sightingsCount) })}・{t('approximateDistance', { distance: number(bill.totalDistanceKm) })})
          </span>
        </div>
      </div>

      {clickable && <ArrowRight size={18} color="#94a3b8" aria-hidden="true" />}
    </div>
  );
}
