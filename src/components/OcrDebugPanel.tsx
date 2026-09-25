import type { CropMetadata } from './CropModal';
import type { ImagePixelStats, PreprocessedPass } from '../utils/ocr';

export interface OcrDebugData {
  rawImageUrl: string;
  rawImageFile?: File;
  rawStats?: ImagePixelStats;
  cropMetadata: CropMetadata;
  croppedImageUrl: string;
  croppedStats?: ImagePixelStats;
  passes: PreprocessedPass[];
  error?: { pass: string; message: string; code?: string };
}

interface OcrDebugPanelProps {
  data: OcrDebugData;
}

export const OcrDebugPanel = ({ data }: OcrDebugPanelProps) => {
  const { rawImageUrl, rawStats, cropMetadata, croppedImageUrl, croppedStats, passes, error } = data;

  const contrastPass = passes.find((p) => p.name.includes('Contrast'));
  const otsuPass = passes.find((p) => p.name.includes('Otsu'));

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
