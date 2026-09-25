import { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X, Crop as CropIcon } from 'lucide-react';

interface CropModalProps {
  imageFile: File;
  onCrop: (croppedBlob: Blob) => void;
  onCancel: () => void;
}

interface Rect {
  x: number; // percentage (0 - 100)
  y: number; // percentage (0 - 100)
  w: number; // percentage (0 - 100)
  h: number; // percentage (0 - 100)
}

export const CropModal = ({ imageFile, onCrop, onCancel }: CropModalProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // 初期クロップ枠（中央付近、記番号に合わせた横長比率）
  const [crop, setCrop] = useState<Rect>({
    x: 15,
    y: 40,
    w: 70,
    h: 20,
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'move' | 'nw' | 'ne' | 'se' | 'sw' | 'draw' | null>(null);
  const dragStartRef = useRef<{ clientX: number; clientY: number; initialCrop: Rect }>({
    clientX: 0,
    clientY: 0,
    initialCrop: { x: 15, y: 40, w: 70, h: 20 },
  });

  // 画像URL生成とクリーンアップ
  const [imageUrl, setImageUrl] = useState<string>('');

  useEffect(() => {
    const url = URL.createObjectURL(imageFile);
    setImageUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [imageFile]);

  // コンテナ座標に対するパーセンテージ計算
  const getRelativeCoords = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return { px: 0, py: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const px = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const py = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
    return { px, py };
  }, []);

  const handlePointerDown = (
    e: React.MouseEvent | React.TouchEvent,
    mode: 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'draw'
  ) => {
    e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    if (mode === 'draw') {
      const { px, py } = getRelativeCoords(clientX, clientY);
      const newCrop = { x: px, y: py, w: 1, h: 1 };
      setCrop(newCrop);
      dragStartRef.current = {
        clientX,
        clientY,
        initialCrop: newCrop,
      };
    } else {
      dragStartRef.current = {
        clientX,
        clientY,
        initialCrop: { ...crop },
      };
    }

    setDragMode(mode);
    setIsDragging(true);
  };

  // ドラッグ操作
  useEffect(() => {
    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging || !dragMode || !containerRef.current) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

      const rect = containerRef.current.getBoundingClientRect();
      const dx = ((clientX - dragStartRef.current.clientX) / rect.width) * 100;
      const dy = ((clientY - dragStartRef.current.clientY) / rect.height) * 100;

      const init = dragStartRef.current.initialCrop;

      if (dragMode === 'move') {
        const newX = Math.min(100 - init.w, Math.max(0, init.x + dx));
        const newY = Math.min(100 - init.h, Math.max(0, init.y + dy));
        setCrop((prev) => ({ ...prev, x: newX, y: newY }));
      } else if (dragMode === 'se' || dragMode === 'draw') {
        const newW = Math.min(100 - init.x, Math.max(8, init.w + dx));
        const newH = Math.min(100 - init.y, Math.max(5, init.h + dy));
        setCrop((prev) => ({ ...prev, w: newW, h: newH }));
      } else if (dragMode === 'nw') {
        const newX = Math.min(init.x + init.w - 8, Math.max(0, init.x + dx));
        const newY = Math.min(init.y + init.h - 5, Math.max(0, init.y + dy));
        const newW = init.w + (init.x - newX);
        const newH = init.h + (init.y - newY);
        setCrop({ x: newX, y: newY, w: newW, h: newH });
      } else if (dragMode === 'ne') {
        const newY = Math.min(init.y + init.h - 5, Math.max(0, init.y + dy));
        const newW = Math.min(100 - init.x, Math.max(8, init.w + dx));
        const newH = init.h + (init.y - newY);
        setCrop((prev) => ({ ...prev, y: newY, w: newW, h: newH }));
      } else if (dragMode === 'sw') {
        const newX = Math.min(init.x + init.w - 8, Math.max(0, init.x + dx));
        const newW = init.w + (init.x - newX);
        const newH = Math.min(100 - init.y, Math.max(5, init.h + dy));
        setCrop((prev) => ({ ...prev, x: newX, w: newW, h: newH }));
      }
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      setDragMode(null);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [isDragging, dragMode]);

  // クロップ実行
  const handleApplyCrop = () => {
    if (!imgRef.current) return;
    const img = imgRef.current;

    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;

    const cropX = Math.round((crop.x / 100) * naturalW);
    const cropY = Math.round((crop.y / 100) * naturalH);
    const cropW = Math.round((crop.w / 100) * naturalW);
    const cropH = Math.round((crop.h / 100) * naturalH);

    if (cropW <= 0 || cropH <= 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCrop(blob);
        }
      },
      'image/jpeg',
      0.95
    );
  };

  if (!imageUrl) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '16px',
        color: '#ffffff',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* ヘッダーガイド */}
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '16px', fontWeight: 800 }}>
          <CropIcon size={18} color="#38bdf8" />
          <span>記番号を囲む</span>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
          記番号だけが大きく入るように囲んでください（左上・右下どちらでもOK）
        </p>
      </div>

      {/* 画像プレビュー & クロップ枠エリア */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 170px)',
        }}
      >
        <div
          ref={containerRef}
          onMouseDown={(e) => handlePointerDown(e, 'draw')}
          onTouchStart={(e) => handlePointerDown(e, 'draw')}
          style={{
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
            maxHeight: '100%',
            touchAction: 'none',
          }}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt="撮影画像プレビュー"
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: 'calc(100vh - 180px)',
              objectFit: 'contain',
              pointerEvents: 'none',
            }}
          />

          {/* クロップ枠の半透明マスク (外側暗転) */}
          <div
            style={{
              position: 'absolute',
              top: `${crop.y}%`,
              left: `${crop.x}%`,
              width: `${crop.w}%`,
              height: `${crop.h}%`,
              border: '2px solid #38bdf8',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
              cursor: 'move',
              boxSizing: 'border-box',
              touchAction: 'none',
            }}
            onMouseDown={(e) => handlePointerDown(e, 'move')}
            onTouchStart={(e) => handlePointerDown(e, 'move')}
          >
            {/* 中央の「記番号」ガイド文字 */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: '11px',
                fontWeight: 700,
                color: 'rgba(255, 255, 255, 0.85)',
                backgroundColor: 'rgba(15, 23, 42, 0.65)',
                padding: '2px 8px',
                borderRadius: '4px',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              記番号エリア
            </div>

            {/* 四隅の操作ハンドル */}
            <div
              style={{
                position: 'absolute',
                top: '-7px',
                left: '-7px',
                width: '14px',
                height: '14px',
                backgroundColor: '#38bdf8',
                borderRadius: '2px',
                cursor: 'nw-resize',
              }}
              onMouseDown={(e) => handlePointerDown(e, 'nw')}
              onTouchStart={(e) => handlePointerDown(e, 'nw')}
            />
            <div
              style={{
                position: 'absolute',
                top: '-7px',
                right: '-7px',
                width: '14px',
                height: '14px',
                backgroundColor: '#38bdf8',
                borderRadius: '2px',
                cursor: 'ne-resize',
              }}
              onMouseDown={(e) => handlePointerDown(e, 'ne')}
              onTouchStart={(e) => handlePointerDown(e, 'ne')}
            />
            <div
              style={{
                position: 'absolute',
                bottom: '-7px',
                left: '-7px',
                width: '14px',
                height: '14px',
                backgroundColor: '#38bdf8',
                borderRadius: '2px',
                cursor: 'sw-resize',
              }}
              onMouseDown={(e) => handlePointerDown(e, 'sw')}
              onTouchStart={(e) => handlePointerDown(e, 'sw')}
            />
            <div
              style={{
                position: 'absolute',
                bottom: '-7px',
                right: '-7px',
                width: '18px',
                height: '18px',
                backgroundColor: '#38bdf8',
                borderRadius: '2px',
                cursor: 'se-resize',
                boxShadow: '0 0 6px rgba(0,0,0,0.5)',
              }}
              onMouseDown={(e) => handlePointerDown(e, 'se')}
              onTouchStart={(e) => handlePointerDown(e, 'se')}
            />
          </div>
        </div>
      </div>

      {/* フッターアクション */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginTop: '12px',
          maxWidth: '480px',
          width: '100%',
          margin: '12px auto 0',
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '12px',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '10px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <X size={16} />
          <span>キャンセル</span>
        </button>

        <button
          type="button"
          onClick={handleApplyCrop}
          style={{
            flex: 2,
            padding: '12px',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '10px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
          }}
          id="btn-apply-crop"
        >
          <Check size={18} />
          <span>この範囲で読み取る</span>
        </button>
      </div>
    </div>
  );
};
