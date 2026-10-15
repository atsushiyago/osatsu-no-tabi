import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useI18n } from '../useI18n';
import { getDisplayedSerialGuide, getSourceCropFromDisplay, type PixelCropRect } from '../utils/cameraCapture';
import { isDebugTiming } from '../utils/debug';
import { getModalViewportHeight } from '../utils/modalViewport';
import { normalizeSerialInput, validateSerialNumber } from '../utils/serial';
import type { SerialScanObservation, RealtimeSerialOcrSession } from '../utils/ocr';
import type { TranslationKey } from '../i18n';

interface SerialCameraModalProps {
  onAccept: (serial: string) => void;
  onClose: () => void;
}

function cropVideoFrame(video: HTMLVideoElement, crop: PixelCropRect): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('camera-canvas-unavailable'));
  context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('camera-capture-failed')), 'image/jpeg', 0.92);
  });
}

export const SerialCameraModal = ({ onAccept, onClose }: SerialCameraModalProps) => {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopStreamRef = useRef<() => void>(() => undefined);
  const sessionRef = useRef<RealtimeSerialOcrSession | null>(null);
  const scanBusyRef = useRef(false);
  const historyRef = useRef<SerialScanObservation[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const guideElementRef = useRef<HTMLDivElement>(null);
  const previewUrlsRef = useRef<string[]>([]);
  const [cameraState, setCameraState] = useState<'starting' | 'ready' | 'review' | 'error'>('starting');
  const [cameraRun, setCameraRun] = useState(0);
  const [visibleHeight, setVisibleHeight] = useState<number | undefined>();
  const [cameraError, setCameraError] = useState<TranslationKey | null>(null);
  const [guide, setGuide] = useState<PixelCropRect | null>(null);
  const [history, setHistory] = useState<SerialScanObservation[]>([]);
  const [reviewSerial, setReviewSerial] = useState('');
  const [stableReason, setStableReason] = useState<'two-consecutive' | 'three-of-five' | null>(null);
  const [latestFrame, setLatestFrame] = useState<{ cropUrl: string; ocrUrl: string; durationMs: number; confidence: number; rawText: string; width: number; height: number; sourceWidth: number; sourceHeight: number; displayWidth: number; displayHeight: number; crop: PixelCropRect } | null>(null);
  const debugMode = isDebugTiming();

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateViewport = () => setVisibleHeight(getModalViewportHeight(viewport.height, window.innerHeight));
    updateViewport();
    viewport.addEventListener('resize', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      viewport.removeEventListener('resize', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  useEffect(() => {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    let active = true;
    const stopStream = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    stopStreamRef.current = stopStream;

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('ocrCameraUnsupported');
        setCameraState('error');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) throw new Error('camera-view-unavailable');
        video.srcObject = stream;
        await video.play();
        if (!active) return;
        setCameraState('ready');
      } catch (error) {
        stopStream();
        if (!active) return;
        const name = error instanceof DOMException ? error.name : '';
        setCameraError(name === 'NotAllowedError' || name === 'SecurityError'
          ? 'ocrCameraPermission'
          : 'ocrCameraUnavailable');
        setCameraState('error');
      }
    };

    void startCamera();
    return () => {
      active = false;
      stopStream();
      void sessionRef.current?.terminate();
      sessionRef.current = null;
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = [];
    };
  }, [cameraRun]);

  useEffect(() => {
    if (cameraState !== 'ready') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const runFrame = async () => {
      if (!active || scanBusyRef.current) return;
      let shouldContinue = true;
      const startedAt = performance.now();
      scanBusyRef.current = true;
      try {
        const video = videoRef.current;
        if (!video || video.videoWidth < 1 || video.videoHeight < 1) throw new Error('camera-view-unavailable');
        const guideElement = guideElementRef.current;
        if (!guideElement) {
          // Wait for the measured overlay, including after an orientation change.
          return;
        }
        const display = video.getBoundingClientRect();
        const overlay = guideElement.getBoundingClientRect();
        if (!display.width || !display.height || !overlay.width || !overlay.height) return;
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        const measuredGuide = { x: overlay.left - display.left, y: overlay.top - display.top, width: overlay.width, height: overlay.height };
        const expectedGuide = getDisplayedSerialGuide(sourceWidth, sourceHeight, display.width, display.height);
        // ResizeObserver + React may need a render after rotation/layout changes.
        // Skip that transitional frame rather than crop from stale overlay geometry.
        if ((['x', 'y', 'width', 'height'] as const).some((key) => Math.abs(measuredGuide[key] - expectedGuide[key]) > 0.5)) return;
        const sourceCrop = getSourceCropFromDisplay(sourceWidth, sourceHeight, display.width, display.height, measuredGuide);
        const crop = await cropVideoFrame(video, sourceCrop);
        if (!sessionRef.current) {
          const ocr = await import('../utils/ocr');
          sessionRef.current = await ocr.createRealtimeSerialOcrSession();
        }
        const result = await sessionRef.current.recognize(crop);
        if (!active) return;
        const observation: SerialScanObservation = {
          serial: result.serial,
          rawText: result.rawText,
          confidence: result.confidence,
          durationMs: result.durationMs,
        };
        const nextHistory = [...historyRef.current, observation].slice(-5);
        historyRef.current = nextHistory;
        setHistory(nextHistory);

        if (debugMode) {
          const cropUrl = URL.createObjectURL(crop);
          const ocrUrl = URL.createObjectURL(result.input);
          previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
          previewUrlsRef.current = [cropUrl, ocrUrl];
          setLatestFrame({ cropUrl, ocrUrl, durationMs: result.durationMs, confidence: result.confidence, rawText: result.rawText, width: result.width, height: result.height, sourceWidth, sourceHeight, displayWidth: display.width, displayHeight: display.height, crop: sourceCrop });
        }

        const { evaluateSerialStability } = await import('../utils/ocr');
        const stable = evaluateSerialStability(nextHistory);
        if (stable.serial) {
          setReviewSerial(stable.serial);
          setStableReason(stable.reason);
          stopStreamRef.current();
          shouldContinue = false;
          await sessionRef.current?.terminate();
          sessionRef.current = null;
          setCameraState('review');
        }
      } catch {
        if (active) {
          shouldContinue = false;
          stopStreamRef.current();
          await sessionRef.current?.terminate();
          sessionRef.current = null;
          setCameraError('ocrCameraUnavailable');
          setCameraState('error');
        }
      } finally {
        scanBusyRef.current = false;
        if (active && shouldContinue) {
          const delay = Math.max(0, 350 - (performance.now() - startedAt));
          timer = setTimeout(() => void runFrame(), delay);
        }
      }
    };

    void runFrame();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [cameraState, debugMode]);

  // Observe both CSS layout and video resolution changes; neither is assumed to
  // match the requested capture resolution, especially after device rotation.
  useEffect(() => {
    const video = videoRef.current;
    const viewport = viewportRef.current;
    if (!video || !viewport) return;
    const measure = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      const display = video.getBoundingClientRect();
      if (!display.width || !display.height) return;
      setGuide(getDisplayedSerialGuide(video.videoWidth, video.videoHeight, display.width, display.height));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      video.removeEventListener('loadedmetadata', measure);
      video.removeEventListener('resize', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);
  const reviewValidation = validateSerialNumber(reviewSerial);
  const restartScan = () => {
    stopStreamRef.current();
    void sessionRef.current?.terminate();
    sessionRef.current = null;
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = [];
    historyRef.current = [];
    setHistory([]);
    setLatestFrame(null);
    setReviewSerial('');
    setStableReason(null);
    setCameraError(null);
    setCameraState('starting');
    setCameraRun((run) => run + 1);
  };

  return (
    <div className="serial-camera-modal" role="dialog" aria-modal="true" aria-label={t('ocrCameraTitle')} style={{
      position: 'fixed', insetInline: 0, top: 0, bottom: 'auto', height: visibleHeight, zIndex: 10000, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start', gap: 10, boxSizing: 'border-box', width: '100%', minHeight: 0, overflow: 'hidden', overscrollBehavior: 'none', padding: 'max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
      background: '#0f172a', color: '#fff',
    }}>
      <header style={{ flex: '0 0 auto', width: '100%', maxWidth: 620, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 6px' }}>{t('ocrCameraTitle')}</h2>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: '#cbd5e1', margin: 0 }}>{t('ocrCameraGuide')}</p>
        </div>
        <button type="button" aria-label={t('ocrCameraClose')} onClick={onClose} style={{ flex: '0 0 auto', border: 0, borderRadius: 999, padding: 10, background: '#334155', color: '#fff' }}><X size={22} /></button>
      </header>

      <main style={{ flex: '1 1 auto', minHeight: 0, width: '100%', maxWidth: 620, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        {cameraState === 'starting' && <p role="status">{t('ocrCameraStarting')}</p>}
        {cameraState === 'error' && <div role="alert" style={{ textAlign: 'center', maxWidth: 480 }}>
          <p>{cameraError ? t(cameraError) : t('ocrCameraUnavailable')}</p>
          <p style={{ color: '#cbd5e1', fontSize: 13 }}>{t('ocrManualFallback')}</p>
        </div>}
        <div ref={viewportRef} style={{ display: cameraState === 'ready' ? 'block' : 'none', position: 'relative', width: '100%', maxWidth: 620, height: 'min(44dvh, 380px)', minHeight: 180, flexShrink: 0, background: '#020617', overflow: 'hidden', borderRadius: 10 }}>
          <video ref={videoRef} autoPlay muted playsInline aria-label={t('ocrCameraPreview')} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', objectPosition: '50% 50%' }} />
          <div ref={guideElementRef} aria-hidden="true" style={{ display: guide ? 'block' : 'none', position: 'absolute', left: guide?.x ?? 0, top: guide?.y ?? 0, width: guide?.width ?? 0, height: guide?.height ?? 0, border: '2px solid #22d3ee', borderRadius: 5, boxShadow: '0 0 0 9999px rgba(2, 6, 23, .52)', boxSizing: 'border-box', pointerEvents: 'none' }}>
          </div>
        </div>
        {cameraState === 'ready' && <p role="status" style={{ color: '#bfdbfe', textAlign: 'center' }}>{t('ocrCameraScanning')}</p>}
        {cameraState === 'review' && <div style={{ width: '100%', maxWidth: 480, boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, background: '#1e293b', color: '#f8fafc', border: '1px solid #475569' }}>
          <h3 style={{ fontSize: 18, lineHeight: 1.35, color: '#fff', margin: '0 0 8px' }}>{t('ocrCameraReviewTitle')}</h3>
          <p style={{ color: '#e2e8f0', lineHeight: 1.5, margin: '0 0 10px' }}>{t(stableReason === 'two-consecutive' ? 'ocrCameraStableTwo' : 'ocrCameraStableThree')}</p>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ color: '#f1f5f9', lineHeight: 1.45 }}>{t('ocrCameraReviewPrompt')}</span>
            <input value={reviewSerial} onChange={(event) => setReviewSerial(event.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} style={{ fontSize: 20, minHeight: 52, padding: 12, width: '100%', boxSizing: 'border-box', borderRadius: 8, border: '2px solid #94a3b8', color: '#0f172a', background: '#fff' }} />
          </label>
          {!reviewValidation.isValid && <p role="alert">{t('serialInvalid')}</p>}
          <button type="button" disabled={!reviewValidation.isValid} onClick={() => onAccept(normalizeSerialInput(reviewSerial))} style={{ width: '100%', minHeight: 50, marginTop: 12, padding: '10px 14px', background: '#0f766e', color: '#fff', border: 0, borderRadius: 8, fontSize: 15, lineHeight: 1.35, fontWeight: 700, overflowWrap: 'anywhere' }}>
            <Check size={18} style={{ verticalAlign: 'middle', marginInlineEnd: 8 }} />{t('ocrCameraUseCandidate')}
          </button>
        </div>}
        {debugMode && <details style={{ maxHeight: 'min(32dvh, 240px)', overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', borderRadius: 8, background: '#1e293b', fontSize: 12, overflowWrap: 'anywhere' }}>
          <summary style={{ padding: '8px 10px', cursor: 'pointer', color: '#f8fafc', fontWeight: 700 }}>{t('ocrCameraDiagnostics')}</summary>
          <div style={{ padding: '0 10px 10px' }}>
          {latestFrame && <>
            <p>Video: {latestFrame.sourceWidth}×{latestFrame.sourceHeight}px ({(latestFrame.sourceWidth / latestFrame.sourceHeight).toFixed(3)}) · Display: {latestFrame.displayWidth.toFixed(1)}×{latestFrame.displayHeight.toFixed(1)}px ({(latestFrame.displayWidth / latestFrame.displayHeight).toFixed(3)}) · contain / centered / CSS zoom 1</p>
            <p>Source crop: x={latestFrame.crop.x}, y={latestFrame.crop.y}, {latestFrame.crop.width}×{latestFrame.crop.height}px</p>
            <p>{latestFrame.width}×{latestFrame.height}px · {latestFrame.durationMs.toFixed(0)}ms · confidence {latestFrame.confidence.toFixed(0)}% · raw: <code>{latestFrame.rawText || '—'}</code></p>
            <img src={latestFrame.cropUrl} alt={t('ocrDiagInput')} style={{ maxWidth: '100%', maxHeight: 80, background: '#fff' }} />
            <img src={latestFrame.ocrUrl} alt={t('ocrCameraProcessedPreview')} style={{ maxWidth: '100%', maxHeight: 100, background: '#fff' }} />
            <p>{t('ocrCameraRecentHistory')}: {history.slice(-5).map((item) => `${(item.serial ?? item.rawText) || '—'} (${item.durationMs.toFixed(0)}ms)`).join(' / ') || '—'}</p>
            {stableReason && <p>{t(stableReason === 'two-consecutive' ? 'ocrCameraStableTwo' : 'ocrCameraStableThree')}</p>}
          </>}
          </div>
        </details>}
      </main>

      <footer style={{ flex: '0 0 auto', width: '100%', maxWidth: 620, display: 'grid', gap: 8, paddingBottom: 2 }}>
        <p style={{ fontSize: 12, lineHeight: 1.4, color: '#e2e8f0', textAlign: 'center', margin: 0 }}>{t('ocrCameraPrivacy')}</p>
        {cameraState === 'review' && <button type="button" onClick={restartScan} className="btn-secondary" style={{ width: '100%', minHeight: 44 }}>{t('ocrCameraRescan')}</button>}
        <button type="button" onClick={onClose} className="btn-secondary" style={{ width: '100%', minHeight: 44 }}>{t('ocrCameraManualEntry')}</button>
      </footer>
    </div>
  );
};
