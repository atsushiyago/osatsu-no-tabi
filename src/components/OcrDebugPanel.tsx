import { useEffect, useMemo, useState } from 'react';
import type { CropMetadata } from './CropModal';
import type { ImagePixelStats, OcrCorrectionDiagnostic, PreprocessedPass, PsmImageDiagnostic } from '../utils/ocr';
import {
  createOcrEvaluationRecord,
  loadOcrEvaluations,
  ocrEvaluationsToCsv,
  saveOcrEvaluations,
  summarizeOcrEvaluations,
  type OcrEvaluationRecord,
} from '../utils/ocrEvaluation';

export interface OcrDebugData {
  rawImageUrl: string;
  rawImageFile?: File;
  rawStats?: ImagePixelStats;
  cropMetadata: CropMetadata;
  croppedImageUrl: string;
  croppedStats?: ImagePixelStats;
  passes: PreprocessedPass[];
  error?: { pass: string; message: string; code?: string };
  psmDiagnostics?: PsmImageDiagnostic[];
  correctionDiagnostics?: OcrCorrectionDiagnostic[];
}

interface OcrDebugPanelProps {
  data: OcrDebugData;
  onPrepareNextCapture?: (message: string) => void;
}

export const OcrDebugPanel = ({ data, onPrepareNextCapture }: OcrDebugPanelProps) => {
  const [evaluations, setEvaluations] = useState<OcrEvaluationRecord[]>(() => loadOcrEvaluations());
  const [expectedSerial, setExpectedSerial] = useState('');
  const [selectedEvaluationPass, setSelectedEvaluationPass] = useState('');
  const [evaluationMessage, setEvaluationMessage] = useState('');
  const [recordedCount, setRecordedCount] = useState<number | null>(null);
  const [dismissedDiagnostics, setDismissedDiagnostics] = useState<OcrCorrectionDiagnostic[] | null>(null);
  const {
    rawImageUrl,
    rawStats,
    cropMetadata,
    croppedImageUrl,
    croppedStats,
    passes,
    error,
    psmDiagnostics = [],
    correctionDiagnostics = [],
  } = data;

  const contrastPass = passes.find((p) => p.name.includes('Contrast'));
  const otsuPass = passes.find((p) => p.name.includes('Otsu'));
  const resultsDismissed = dismissedDiagnostics === correctionDiagnostics;
  const activeCorrectionDiagnostics = resultsDismissed ? [] : correctionDiagnostics;
  const selectedDiagnostic = activeCorrectionDiagnostics.find((item) => item.pass === selectedEvaluationPass)
    ?? activeCorrectionDiagnostics.at(-1);
  const evaluationSummary = useMemo(() => summarizeOcrEvaluations(evaluations), [evaluations]);

  useEffect(() => {
    try {
      saveOcrEvaluations(evaluations);
    } catch (storageError) {
      console.warn('[OCR Evaluation] localStorage save failed', storageError);
    }
  }, [evaluations]);

  const recordEvaluation = () => {
    if (!selectedDiagnostic) return;
    const record = createOcrEvaluationRecord(expectedSerial, selectedDiagnostic);
    if (!record) {
      setEvaluationMessage('正しい記番号を入力してください。');
      return;
    }
    setEvaluations((current) => [record, ...current]);
    setRecordedCount(evaluations.length + 1);
    setEvaluationMessage('');
  };

  const downloadCsv = () => {
    const blob = new Blob([ocrEvaluationsToCsv(evaluations)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'osatsu-ocr-evaluations.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(evaluations, null, 2));
      setEvaluationMessage('評価結果をコピーしました。ChatGPTのチャットに貼り付けてください。');
      window.setTimeout(() => setEvaluationMessage(''), 5000);
    } catch {
      setEvaluationMessage('JSONをコピーできませんでした。');
    }
  };

  const clearEvaluations = () => {
    if (!window.confirm('このブラウザに保存したOCR評価データをすべて削除しますか？')) return;
    setEvaluations([]);
    setEvaluationMessage('評価データを削除しました。');
    setRecordedCount(null);
  };

  const prepareAnotherCapture = (sameNote: boolean) => {
    setDismissedDiagnostics(correctionDiagnostics);
    setSelectedEvaluationPass('');
    setRecordedCount(null);
    setEvaluationMessage('');
    if (!sameNote) setExpectedSerial('');
    onPrepareNextCapture?.(sameNote
      ? '正解記番号は保持しました。同じお札を撮影してOCRしてください。'
      : '次のお札の正解記番号を入力してOCRしてください。');
  };

  const images = [
    {
      title: '1. 元画像 (撮影/選択)',
      url: rawImageUrl,
      width: rawStats?.width || cropMetadata.naturalWidth,
      height: rawStats?.height || cropMetadata.naturalHeight,
      stats: rawStats,
    },
    {
      title: '2. クロップ直後画像',
      url: croppedImageUrl,
      width: croppedStats?.width || cropMetadata.cropW,
      height: croppedStats?.height || cropMetadata.cropH,
      stats: croppedStats,
    },
    {
      title: '3. Contrast Enhanced',
      url: contrastPass?.previewUrl || '',
      width: contrastPass?.stats.width || 0,
      height: contrastPass?.stats.height || 0,
      stats: contrastPass?.stats,
    },
    {
      title: '4. Otsu Binarized',
      url: otsuPass?.previewUrl || '',
      width: otsuPass?.stats.width || 0,
      height: otsuPass?.stats.height || 0,
      stats: otsuPass?.stats,
    },
  ];

  return (
    <div
      style={{
        marginTop: '16px',
        padding: '14px',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        borderRadius: '12px',
        border: '2px solid #38bdf8',
        fontSize: '12px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
      }}
      id="ocr-pipeline-debug-panel"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ fontWeight: 800, fontSize: '13px', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>🔍 ?debug=timing OCR 画像パイプライン診断</span>
        </div>
        <span style={{ fontSize: '10px', backgroundColor: '#1e293b', padding: '2px 8px', borderRadius: '4px', color: '#94a3b8' }}>
          クライアント端末内メモリ
        </span>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: '12px', padding: '8px 10px', background: '#7f1d1d', borderRadius: '6px', color: '#fee2e2' }}>
          OCR error ({error.pass}){error.code ? ` · code: ${error.code}` : ''}: {error.message}
        </div>
      )}

      {activeCorrectionDiagnostics.length > 0 && (
        <div style={{ marginBottom: '12px', padding: '10px 12px', backgroundColor: '#1e293b', borderRadius: '8px', fontFamily: 'monospace', lineHeight: 1.5, overflowX: 'auto' }}>
          <div style={{ color: '#38bdf8', fontWeight: 700, marginBottom: '8px' }}>OCR後の記番号補正診断</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '11px' }}>
            <thead>
              <tr style={{ color: '#94a3b8', borderBottom: '1px solid #475569' }}>
                {['Pass', 'Raw OCR', 'Normalized', 'Generated', 'Valid candidates', 'Selected', 'Corrections', 'Status'].map((heading) => (
                  <th key={heading} style={{ padding: '5px 7px', whiteSpace: 'nowrap' }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeCorrectionDiagnostics.map((result) => (
                <tr key={result.pass} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '5px 7px', whiteSpace: 'nowrap' }}>{result.pass}</td>
                  <td style={{ padding: '5px 7px', whiteSpace: 'pre-wrap' }}>{result.rawText || '(empty)'}</td>
                  <td style={{ padding: '5px 7px' }}>{result.normalizedText || '(empty)'}</td>
                  <td style={{ padding: '5px 7px' }}>{result.generatedCandidateCount}</td>
                  <td style={{ padding: '5px 7px', whiteSpace: 'pre-wrap' }}>
                    {result.validCandidates.length
                      ? result.validCandidates.map(({ serial, correctionCount }) => `${serial} (+${correctionCount})`).join('\n')
                      : '(none)'}
                  </td>
                  <td style={{ padding: '5px 7px' }}>{result.selectedCandidate || '(none)'}</td>
                  <td style={{ padding: '5px 7px' }}>{result.correctionCount ?? '(none)'}</td>
                  <td style={{ padding: '5px 7px' }}>
                    {result.ambiguous
                      ? `ambiguous${result.ambiguityReason === 'possible-truncated-suffix' ? ' (suffix may be truncated)' : ''}`
                      : result.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-label="OCR評価" style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#1e293b', borderRadius: '8px', lineHeight: 1.55 }}>
        <h3 style={{ color: '#38bdf8', margin: '0 0 8px' }}>OCR評価（このブラウザ内のみ）</h3>
        <p style={{ margin: '0 0 10px', color: '#cbd5e1' }}>
          1. 紙幣を見て正解を入力　2. OCRしてpassを選択　3. 結果を記録　4. 10〜20件集めたら結果をコピー
        </p>
        {activeCorrectionDiagnostics.length === 0 ? (
          <p style={{ margin: 0 }}>OCRを実行すると、raw OCRと補正候補を使って評価を記録できます。</p>
        ) : (
          <>
            <label style={{ display: 'block', marginBottom: '8px' }}>
              評価するpass
              <select value={selectedDiagnostic?.pass ?? ''} onChange={(event) => setSelectedEvaluationPass(event.target.value)} style={{ display: 'block', width: '100%', minHeight: '40px', marginTop: '4px' }}>
                {activeCorrectionDiagnostics.map((item) => <option key={item.pass} value={item.pass}>{item.pass}</option>)}
              </select>
            </label>
            <div style={{ marginBottom: '8px', overflowWrap: 'anywhere' }}>
              <div>Raw OCR: <code>{selectedDiagnostic?.rawText || '(empty)'}</code></div>
              <div>Normalized: <code>{selectedDiagnostic?.normalizedText || '(empty)'}</code></div>
              <div>Valid candidates: {selectedDiagnostic?.validCandidates.map(({ serial }) => serial).join(' · ') || '(none)'}</div>
              <div>Selected: {selectedDiagnostic?.selectedCandidate ?? '(none)'} · Corrections: {selectedDiagnostic?.correctionCount ?? '(none)'} · {selectedDiagnostic?.ambiguous ? 'ambiguous' : selectedDiagnostic?.validCandidates.length ? 'not ambiguous' : 'no candidate'}</div>
            </div>
            <label style={{ display: 'block', marginBottom: '8px' }}>
              正解記番号（紙幣を見て入力）
              <input type="text" value={expectedSerial} onChange={(event) => setExpectedSerial(event.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} style={{ display: 'block', width: '100%', minHeight: '40px', marginTop: '4px', boxSizing: 'border-box' }} />
            </label>
            <button type="button" onClick={recordEvaluation} disabled={recordedCount !== null} style={{ minHeight: '44px', padding: '8px 14px' }}>この結果を記録</button>
          </>
        )}

        {recordedCount !== null && (
          <div role="status" style={{ marginTop: '8px', padding: '8px', backgroundColor: '#14532d', color: '#dcfce7', fontWeight: 700 }}>
            記録しました（現在 {recordedCount} 件）
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
              <button type="button" onClick={() => prepareAnotherCapture(true)} style={{ minHeight: '44px' }}>同じお札でもう一度</button>
              <button type="button" onClick={() => prepareAnotherCapture(false)} style={{ minHeight: '44px' }}>次のお札へ</button>
            </div>
          </div>
        )}

        <div aria-live="polite" style={{ marginTop: '10px' }}>
          <strong>評価件数: {evaluationSummary.count}</strong>
          <div>Raw完全一致: {evaluationSummary.rawExactCount} / {evaluationSummary.count} ({evaluationSummary.rawExactPercent.toFixed(1)}%)</div>
          <div>補正後完全一致: {evaluationSummary.correctedExactCount} / {evaluationSummary.count} ({evaluationSummary.correctedExactPercent.toFixed(1)}%)</div>
          <div>補正によって改善: {evaluationSummary.improvedCount}件</div>
          <div style={{ color: evaluationSummary.falseAcceptCount ? '#fecaca' : '#fde68a', fontWeight: 800 }}>誤った自動採用: {evaluationSummary.falseAcceptCount}件</div>
          <div>Ambiguous: {evaluationSummary.ambiguousCount}件</div>
          <div>Valid candidateなし: {evaluationSummary.noCandidateCount}件</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
          <button type="button" onClick={downloadCsv} disabled={!evaluations.length}>CSVを保存</button>
          <div>
            <button type="button" onClick={copyJson} disabled={!evaluations.length}>評価結果をコピー</button>
            <small style={{ display: 'block', color: '#cbd5e1', marginTop: '3px' }}>ChatGPTに貼り付けると結果を分析できます</small>
          </div>
          <button type="button" onClick={clearEvaluations} disabled={!evaluations.length}>評価データを全削除</button>
        </div>
        {evaluationMessage && <div role="status" style={{ marginTop: '8px' }}>{evaluationMessage}</div>}
      </section>

      {psmDiagnostics.length > 0 && (
        <div style={{ marginBottom: '12px', padding: '10px 12px', backgroundColor: '#1e293b', borderRadius: '8px', fontFamily: 'monospace', lineHeight: 1.5, overflowX: 'auto' }}>
          <div style={{ color: '#38bdf8', fontWeight: 700, marginBottom: '8px' }}>画像 / PSM / 白padding 比較（6基本条件 + padding版）</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '11px' }}>
            <thead>
              <tr style={{ color: '#94a3b8', borderBottom: '1px solid #475569' }}>
                {['Image variant', 'PSM', 'Padding', 'Raw text', '空白除去後', 'Confidence', 'Time', '形式', 'Error'].map((heading) => (
                  <th key={heading} style={{ padding: '5px 7px', whiteSpace: 'nowrap' }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {psmDiagnostics.map((result, index) => (
                <tr key={`${result.imageVariant}-${result.psmName}-${result.padding}-${index}`} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '5px 7px', whiteSpace: 'nowrap' }}>{result.imageVariant}</td>
                  <td style={{ padding: '5px 7px', whiteSpace: 'nowrap' }}>{result.psmName}</td>
                  <td style={{ padding: '5px 7px', whiteSpace: 'nowrap' }}>{result.padding ? `ON (+${result.paddingPx}px)` : 'OFF'}</td>
                  <td style={{ padding: '5px 7px', whiteSpace: 'pre-wrap' }}>{result.rawText || '(empty)'}</td>
                  <td style={{ padding: '5px 7px' }}>{result.compactText || '(empty)'}</td>
                  <td style={{ padding: '5px 7px', whiteSpace: 'nowrap' }}>{result.confidence.toFixed(1)}%</td>
                  <td style={{ padding: '5px 7px', whiteSpace: 'nowrap' }}>{result.durationMs.toFixed(0)} ms</td>
                  <td style={{ padding: '5px 7px', color: result.isValid ? '#4ade80' : '#fca5a5' }}>
                    {result.isValid ? 'Valid' : 'Invalid'}
                  </td>
                  <td style={{ padding: '5px 7px', color: '#fca5a5' }}>{result.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 座標変換サマリー */}
      <div
        style={{
          backgroundColor: '#1e293b',
          padding: '8px 12px',
          borderRadius: '8px',
          marginBottom: '12px',
          fontFamily: 'monospace',
          fontSize: '11px',
          lineHeight: '1.6',
          color: '#cbd5e1',
        }}
      >
        <div style={{ color: '#38bdf8', fontWeight: 700, marginBottom: '2px' }}>📐 座標変換メトリクス:</div>
        <div>元画像 natural: <strong>{cropMetadata.naturalWidth} x {cropMetadata.naturalHeight}</strong> px</div>
        <div>UI表示 client: <strong>{cropMetadata.displayedWidth} x {cropMetadata.displayedHeight}</strong> px</div>
        <div>scaleX / scaleY: <strong>{cropMetadata.scaleX.toFixed(3)}</strong> / <strong>{cropMetadata.scaleY.toFixed(3)}</strong></div>
        <div>crop元座標: x=<strong>{cropMetadata.cropX}</strong>, y=<strong>{cropMetadata.cropY}</strong>, w=<strong>{cropMetadata.cropW}</strong>, h=<strong>{cropMetadata.cropH}</strong></div>
      </div>

      {/* 4枚の実画像プレビューグリッド */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
        {images.map((item, idx) => (
          <div
            key={idx}
            style={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#f1f5f9' }}>{item.title}</div>

            {/* プレビュー画像 */}
            <div
              style={{
                height: '110px',
                backgroundColor: '#020617',
                border: '1px solid #475569',
                borderRadius: '6px',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {item.url ? (
                <img
                  src={item.url}
                  alt={item.title}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              ) : (
                <span style={{ color: '#64748b', fontSize: '10px' }}>処理中または画像なし</span>
              )}
            </div>

            {/* 各画像メトリクス */}
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '10px',
                color: '#94a3b8',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                lineHeight: '1.4',
              }}
            >
              <div>解像度: <strong style={{ color: '#e2e8f0' }}>{item.width} x {item.height}</strong></div>
              {item.stats ? (
                <>
                  <div>輝度 (min/max/avg): <strong style={{ color: '#e2e8f0' }}>{item.stats.minLum} / {item.stats.maxLum} / {item.stats.avgLum}</strong></div>
                  <div>透明率: <strong style={{ color: item.stats.transparentRatio === '0%' ? '#4ade80' : '#f87171' }}>{item.stats.transparentRatio}</strong></div>
                </>
              ) : (
                <div style={{ color: '#64748b' }}>統計解析中...</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
