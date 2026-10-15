import { useI18n } from '../useI18n';
import type { PsmImageDiagnostic } from '../utils/ocr';

interface OcrCameraDiagnosticsProps {
  inputPreviewUrl: string;
  inputWidth?: number;
  inputHeight?: number;
  comparisons: PsmImageDiagnostic[];
  error?: { pass: string; message: string; code?: string };
}

export const OcrCameraDiagnostics = ({ inputPreviewUrl, inputWidth, inputHeight, comparisons, error }: OcrCameraDiagnosticsProps) => {
  const { t } = useI18n();
  const formatSize = (width: number, height: number) => `${width} × ${height}px`;

  return (
    <section aria-label={t('ocrDiagTitle')} style={{ marginTop: 12, padding: 12, background: '#0f172a', color: '#f8fafc', borderRadius: 10, fontSize: 12, lineHeight: 1.5 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{t('ocrDiagTitle')}</h3>
      <p style={{ margin: '0 0 8px', color: '#cbd5e1' }}>{t('ocrCameraPrivacy')}</p>
      {error && <p role="alert" style={{ color: '#fecaca', overflowWrap: 'anywhere' }}>OCR error at {error.pass}{error.code ? ` · ${error.code}` : ''}: {error.message}</p>}
      {inputPreviewUrl && <figure style={{ margin: '8px 0' }}>
        <figcaption>{t('ocrDiagInput')}{inputWidth && inputHeight ? ` · ${formatSize(inputWidth, inputHeight)}` : ''}</figcaption>
        <img src={inputPreviewUrl} alt={t('ocrDiagInput')} style={{ display: 'block', maxWidth: '100%', maxHeight: 180, objectFit: 'contain', background: '#fff', marginTop: 4 }} />
      </figure>}
      <h4 style={{ margin: '12px 0 6px' }}>{t('ocrDiagComparisons')}</h4>
      <div style={{ display: 'grid', gap: 10 }}>
        {comparisons.map((result, index) => (
          <article key={`${result.imageVariant}-${result.psm}-${index}`} style={{ padding: 8, border: '1px solid #334155', borderRadius: 8, overflowWrap: 'anywhere' }}>
            <strong>{result.imageVariant} · PSM {result.psm} ({result.psmName}) · {formatSize(result.width, result.height)} · confidence {result.confidence.toFixed(0)}%</strong>
            <div style={{ marginTop: 4 }}><b>{t('ocrDiagRawText')}:</b> <code>{result.rawText || t('ocrDiagNone')}</code></div>
            <div><b>{t('ocrDiagCandidates')}:</b> {result.candidates.join(', ') || t('ocrDiagNone')}</div>
            {result.rejectedWindows.length > 0 && <div><b>{t('ocrDiagRejected')}:</b> {result.rejectedWindows.join(' · ')}</div>}
            {result.error && <div role="alert">{result.error}</div>}
            {result.previewUrl && <img src={result.previewUrl} alt={`${result.imageVariant} input for PSM ${result.psm}`} style={{ display: 'block', maxWidth: '100%', maxHeight: 140, objectFit: 'contain', background: '#fff', marginTop: 6 }} />}
          </article>
        ))}
      </div>
    </section>
  );
};
