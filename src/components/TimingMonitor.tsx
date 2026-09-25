import { useEffect, useState } from 'react';
import { subscribeTiming, clearTimingLogs, type TimingEntry } from '../utils/timing';
import { isAppCheckConfigured, runDiagnoseAppCheck } from '../services/firebase';
import { isDebugTiming } from '../utils/debug';
import { Activity, ChevronDown, ChevronUp, Trash2, ShieldCheck, ShieldAlert } from 'lucide-react';

export const TimingMonitor = () => {
  const isVisible = import.meta.env.DEV || isDebugTiming();

  const [entries, setEntries] = useState<TimingEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [diagResult, setDiagResult] = useState<{
    success: boolean;
    length?: number;
    expireTimeMillis?: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!isVisible) return;
    const unsub = subscribeTiming((newEntries) => {
      setEntries(newEntries);
    });

    // ?debug=timing の場合は診断を実行して状態を保持
    if (isDebugTiming()) {
      runDiagnoseAppCheck().then((res) => {
        if (res) setDiagResult(res);
      });
    }

    return unsub;
  }, [isVisible]);

  if (!isVisible) return null;

  const latestCompleted = entries.find((e) => e.durationMs !== undefined);
  const latestPending = entries.find((e) => e.durationMs === undefined);

  return (
    <aside
      aria-label="Firestore 計測ログ"
      style={{
        position: 'fixed',
        bottom: 74,
        right: 12,
        zIndex: 99999,
        fontFamily: 'monospace',
        fontSize: '12px',
        maxWidth: isOpen ? '90vw' : '260px',
        width: isOpen ? '360px' : 'auto',
      }}
    >
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.94)',
          color: '#f8fafc',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          overflow: 'hidden',
        }}
      >
        <div
          onClick={() => setIsOpen(!isOpen)}
          style={{
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            cursor: 'pointer',
            userSelect: 'none',
            background: latestPending ? 'rgba(234, 88, 12, 0.25)' : 'transparent',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
            <Activity
              size={14}
              style={{
                color: latestPending ? '#fb923c' : '#38bdf8',
                animation: latestPending ? 'spin 1.5s linear infinite' : 'none',
                flexShrink: 0,
              }}
            />
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
              {latestPending
                ? `通信中...`
                : latestCompleted
                  ? `${latestCompleted.name.split(':')[0]} ${(latestCompleted.durationMs! / 1000).toFixed(1)}s`
                  : 'Firestore 計測'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {isOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </div>
        </div>

        {isOpen && (
          <div style={{ maxHeight: '280px', overflowY: 'auto', borderTop: '1px solid rgba(255, 255, 255, 0.1)', padding: '6px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Firestore 通信時間ログ</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearTimingLogs();
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  fontSize: '11px',
                }}
                title="ログをクリア"
              >
                <Trash2 size={12} /> クリア
              </button>
            </div>

            <div
              style={{
                fontSize: '10px',
                padding: '4px 6px',
                borderRadius: 4,
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: isAppCheckConfigured
                  ? 'rgba(16, 185, 129, 0.15)'
                  : 'rgba(234, 88, 12, 0.15)',
                color: isAppCheckConfigured ? '#34d399' : '#fb923c',
                border: `1px solid ${isAppCheckConfigured ? 'rgba(52, 211, 153, 0.3)' : 'rgba(251, 146, 60, 0.3)'}`,
              }}
            >
              {isAppCheckConfigured ? (
                <>
                  <ShieldCheck size={12} />
                  <span>App Check: reCAPTCHA Enterprise 有効</span>
                </>
              ) : (
                <>
                  <ShieldAlert size={12} />
                  <span>
                    App Check: 未設定 (
                    {import.meta.env.DEV &&
                    // @ts-expect-error FIREBASE_APPCHECK_DEBUG_TOKEN check in dev
                    Boolean(self.FIREBASE_APPCHECK_DEBUG_TOKEN)
                      ? 'Debug Provider 有効'
                      : '未認証リクエスト'}
                    )
                  </span>
                </>
              )}
            </div>

            {diagResult && (
              <div
                style={{
                  fontSize: '10px',
                  padding: '4px 6px',
                  borderRadius: 4,
                  marginBottom: 8,
                  background: diagResult.success
                    ? 'rgba(16, 185, 129, 0.1)'
                    : 'rgba(239, 68, 68, 0.15)',
                  color: diagResult.success ? '#6ee7b7' : '#fca5a5',
                  border: `1px solid ${diagResult.success ? 'rgba(110, 231, 183, 0.2)' : 'rgba(252, 165, 165, 0.3)'}`,
                  lineHeight: 1.4,
                  wordBreak: 'break-all',
                }}
              >
                {diagResult.success ? (
                  <div>
                    <div><strong>[診断] getToken 成功</strong></div>
                    <div style={{ color: '#94a3b8' }}>
                      Token長: {diagResult.length}文字
                      {diagResult.expireTimeMillis && ` (期限: ${new Date(diagResult.expireTimeMillis).toLocaleTimeString()})`}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div><strong>[診断] getToken 失敗</strong></div>
                    <div style={{ color: '#fca5a5' }}>{diagResult.error}</div>
                  </div>
                )}
              </div>
            )}
            {entries.length === 0 ? (
              <div style={{ color: '#64748b', textAlign: 'center', padding: '12px 0' }}>ログはありません</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {entries.map((entry) => {
                  const isLong = (entry.durationMs ?? 0) >= 5000;
                  const isPending = entry.durationMs === undefined;
                  return (
                    <div
                      key={entry.id}
                      style={{
                        padding: '4px 6px',
                        borderRadius: 4,
                        background: entry.error
                          ? 'rgba(239, 68, 68, 0.15)'
                          : isLong
                            ? 'rgba(239, 68, 68, 0.25)'
                            : isPending
                              ? 'rgba(245, 158, 11, 0.15)'
                              : 'rgba(255, 255, 255, 0.05)',
                        borderLeft: `3px solid ${
                          entry.error
                            ? '#ef4444'
                            : isLong
                              ? '#f43f5e'
                              : isPending
                                ? '#f59e0b'
                                : '#10b981'
                        }`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontWeight: 500, wordBreak: 'break-all' }}>{entry.name}</span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: entry.error
                              ? '#ef4444'
                              : isLong
                                ? '#f43f5e'
                                : isPending
                                  ? '#f59e0b'
                                  : '#10b981',
                            flexShrink: 0,
                          }}
                        >
                          {isPending
                            ? '測定中...'
                            : `${entry.durationMs?.toLocaleString()} ms`}
                        </span>
                      </div>
                      {entry.error && (
                        <div style={{ color: '#fca5a5', fontSize: '10px', marginTop: 2 }}>{entry.error}</div>
                      )}
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: 2 }}>
                        {entry.timestamp}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
