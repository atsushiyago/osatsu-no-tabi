import { BANKNOTE_VARIANT_LABELS, getAllowedSerialColors, type BillSeries, type SerialColor } from '../data/banknoteVariants';
import { changeIdentityDesign, type IdentitySelection } from '../utils/billIdentitySelection';
import { useI18n } from '../useI18n';
import type { TranslationKey } from '../i18n';

const swatches: Record<SerialColor, string> = { black: '#222', brown: '#805037', blue: '#306bb4', darkgreen: '#244e39', navy: '#253c69' };
const designs: Record<string, TranslationKey> = {
  D1000: 'designD1000', D2000: 'designD2000', D5000: 'designD5000', D10000: 'designD10000',
  E1000: 'designE1000', E5000: 'designE5000', E10000: 'designE10000',
  F1000: 'designF1000', F5000: 'designF5000', F10000: 'designF10000',
};
export function BillIdentityFields({ selection, onChange, disabled }: {
  selection: IdentitySelection; onChange: (next: IdentitySelection) => void; disabled: boolean;
}) {
  const { language, t } = useI18n();
  const labels = BANKNOTE_VARIANT_LABELS[language];
  const colors = getAllowedSerialColors(selection.series, selection.denomination);
  const automatic = colors.length === 1;
  const automaticDesign = selection.series === 'F' || selection.denomination === 2000;
  if (automaticDesign) return <section className="identity-fields identity-auto-design" role="status">
    <strong>{t(selection.series === 'F' ? 'identityFAuto' : 'identity2000Auto')}</strong>
    <span>{t(designs[`${selection.series ?? 'D'}${selection.denomination}`])}</span>
  </section>;
  return <section className="identity-fields" aria-label={t('identityDesign')}>
    <fieldset disabled={disabled}>
      <legend className="form-label">{t('identityDesign')}</legend>
      <p className="input-hint">{t('identityDesignHelp')}</p>
<div className="identity-options">
        {(['E', 'D'] as BillSeries[]).filter((series) => getAllowedSerialColors(series, selection.denomination).length > 0).map((series) =>
          <button key={series} id={`identity-design-${series}`} type="button" className={`identity-option ${selection.series === series ? 'active' : ''}`}
            aria-pressed={selection.series === series} onClick={() => onChange(changeIdentityDesign(selection.denomination, series))}>
            <strong>{labels.series[series]}</strong><span>{t(designs[`${series}${selection.denomination}`])}</span>
          </button>)}
      </div>
      {!automaticDesign && <button type="button" className="btn-secondary" id="identity-design-unknown" onClick={() => onChange(changeIdentityDesign(selection.denomination, null))}>{t('identityUnknown')}</button>}
    </fieldset>
    {selection.series !== null && <fieldset disabled={disabled}>
      <legend className="form-label">{t('identityColor')}</legend>
      <p className="input-hint">{t('identityColorHelp')}</p>
      {automatic ? <p className="input-hint"><span className="identity-swatch" style={{ background: swatches.black }} /> {t('identityAutomatic')}</p> :
        <div className="identity-colors">{colors.map((color) =>
          <button key={color} id={`identity-color-${color}`} type="button" className={`identity-option ${selection.serialColor === color ? 'active' : ''}`}
            aria-pressed={selection.serialColor === color} onClick={() => onChange({ ...selection, serialColor: color })}>
            <span className="identity-swatch" aria-hidden="true" style={{ background: swatches[color] }} /><span>{labels.colors[color]}</span>
          </button>)}</div>}
      {!automatic && <button type="button" className="btn-secondary" id="identity-color-unknown" onClick={() => onChange({ ...selection, serialColor: null })}>{t('identityUnknown')}</button>}
      <p className="input-hint">{t('identityHold')}</p>
    </fieldset>}
  </section>;
}
