import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Sparkles, MapPin, Calendar, ArrowRight } from 'lucide-react';
import type { RegisterResult } from '../types';

interface CelebrationModalProps {
  result: RegisterResult;
  onClose: () => void;
  onViewJourney: () => void;
}

export const CelebrationModal = ({
  result,
  onClose,
  onViewJourney,
}: CelebrationModalProps) => {
  useEffect(() => {
    // 華やかな紙吹雪エフェクト
    const duration = 2.5 * 1000;
    const animationEnd = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ['#2563eb', '#10b981', '#f59e0b', '#ec4899'],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ['#2563eb', '#10b981', '#f59e0b', '#ec4899'],
      });

      if (Date.now() < animationEnd) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  }, []);

  const { sightingsCount, distanceFromPrevKm, daysFromPrev } = result;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(8px)',
        animation: 'fadeIn 0.25s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '24px',
          padding: '28px 24px',
          maxWidth: '420px',
          width: '100%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          position: 'relative',
          overflow: 'hidden',
          textAlign: 'center',
          animation: 'scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 背景の装飾グロー */}
        <div
          style={{
            position: 'absolute',
            top: '-60px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '200px',
            height: '200px',
            background: 'radial-gradient(circle, rgba(37,99,235,0.18) 0%, rgba(255,255,255,0) 70%)',
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: '#eff6ff',
            color: '#2563eb',
            marginBottom: '16px',
            boxShadow: '0 0 0 8px #dbeafe',
          }}
        >
          <Sparkles size={32} />
        </div>

        <span
          style={{
            display: 'inline-block',
            padding: '4px 12px',
            borderRadius: '9999px',
            backgroundColor: '#dbeafe',
            color: '#1d4ed8',
            fontWeight: 700,
            fontSize: '12px',
            letterSpacing: '0.05em',
            marginBottom: '8px',
          }}
        >
          奇跡の再発見！ (HIT)
        </span>

        <h3
          style={{
            fontSize: '22px',
            fontWeight: 800,
            color: '#0f172a',
            margin: '0 0 8px 0',
            lineHeight: 1.3,
          }}
        >
          このお札は以前にも
          <br />
          登録されています！
        </h3>

        <p
          style={{
            fontSize: '15px',
            color: '#475569',
            lineHeight: 1.6,
            margin: '0 0 20px 0',
          }}
        >
          あなたはこのお札の
          <br />
          <strong style={{ fontSize: '20px', color: '#2563eb' }}>
            第 {sightingsCount} 人目の発見者
          </strong>
          です！
        </p>

        {/* 旅のダイジェストカード */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            padding: '16px',
            marginBottom: '24px',
            display: 'flex',
            justifyContent: 'space-around',
            textAlign: 'center',
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                color: '#64748b',
                fontSize: '12px',
                marginBottom: '4px',
              }}
            >
              <MapPin size={14} />
              <span>前回の街から</span>
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
              約 {distanceFromPrevKm} <span style={{ fontSize: '12px' }}>km</span>
            </div>
          </div>

          <div style={{ width: '1px', backgroundColor: '#e2e8f0' }} />

          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                color: '#64748b',
                fontSize: '12px',
                marginBottom: '4px',
              }}
            >
              <Calendar size={14} />
              <span>経過日数</span>
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
              {daysFromPrev} <span style={{ fontSize: '12px' }}>日ぶり</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={onViewJourney}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              padding: '14px',
              borderRadius: '14px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              fontSize: '16px',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
              transition: 'transform 0.15s ease',
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.98)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            <span>お札の旅の軌跡を見る</span>
            <ArrowRight size={18} />
          </button>

          <button
            onClick={onClose}
            style={{
              padding: '10px',
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
