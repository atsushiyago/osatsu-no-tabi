import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Sighting } from '../types';
import { getMunicipalityLocation } from '../utils/geo';

interface JourneyMapProps {
  sightings: Sighting[];
  height?: string;
  interactive?: boolean;
}

export const JourneyMap = ({
  sightings,
  height = '360px',
  interactive = true,
}: JourneyMapProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // 既存の地図インスタンスをクリーンアップ
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // デフォルトの中心（日本列島中央付近）
    const defaultCenter: [number, number] = [36.2048, 138.2529];
    const defaultZoom = 5;

    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: interactive,
      dragging: interactive,
      touchZoom: interactive,
      scrollWheelZoom: false, // ページスクロールの邪魔にならないよう初期オフ
    });

    mapInstanceRef.current = map;

    // 美しいOpenStreetMapタイル
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    if (sightings.length === 0) {
      return;
    }

    const locatedSightings = sightings
      .map((s) => ({ sighting: s, location: getMunicipalityLocation(s.prefecture, s.municipality) }))
      .filter((entry): entry is { sighting: Sighting; location: NonNullable<typeof entry.location> } => Boolean(entry.location));
    if (locatedSightings.length === 0) return;
    const latLngs: [number, number][] = locatedSightings.map(({ location }) => [location.lat, location.lng]);

    // 軌跡のポリラインを描画
    if (latLngs.length > 1) {
      L.polyline(latLngs, {
        color: '#9f3b2f',
        weight: 4,
        opacity: 0.85,
        dashArray: '8, 8',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
    }

    // 各地点のピンマーカーを生成
    locatedSightings.forEach(({ sighting: s, location }, idx) => {
      const isFirst = idx === 0;
      const isLatest = idx === sightings.length - 1 && sightings.length > 1;

      const bgColor = isLatest ? '#9f3b2f' : isFirst ? '#365d4a' : '#a6813d';
      const label = isFirst ? '起点' : isLatest ? '最新' : `${s.step}`;

      // カスタムHTMLアイコン（丸いバッジ）
      const customIcon = L.divIcon({
        className: 'custom-journey-pin',
        html: `
          <div style="
            background: ${bgColor};
            color: #ffffff;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 12px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.25);
            border: 2px solid #ffffff;
            transform: translate(-50%, -50%);
          ">
            ${label}
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const formattedDate = new Date(s.createdAt).toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      });

      const popupContent = `
        <div style="font-family: inherit; font-size: 13px; line-height: 1.5; padding: 4px;">
          <div style="font-weight: 700; color: #1e293b; font-size: 14px; margin-bottom: 2px;">
            第${s.step}の足跡: ${s.prefecture} ${s.municipality}
          </div>
          <div style="color: #64748b; font-size: 12px; margin-bottom: 6px;">
            登録日: ${formattedDate}
          </div>
          ${
            s.distanceFromPrevKm && s.distanceFromPrevKm > 0
              ? `<div style="color: #2563eb; font-weight: 600; font-size: 12px; margin-bottom: 4px;">
                  前の街から: 約${s.distanceFromPrevKm}km移動 (${s.daysFromPrev ?? 0}日)
                </div>`
              : ''
          }
          ${
            s.userNote
              ? `<div style="margin-top: 6px; padding: 6px 8px; background: #f8fafc; border-radius: 6px; font-style: italic; color: #334155; font-size: 12px; border-left: 3px solid #cbd5e1;">
                  “${escapeHtml(s.userNote)}”
                </div>`
              : ''
          }
        </div>
      `;

      L.marker([location.lat, location.lng], { icon: customIcon })
        .bindPopup(popupContent)
        .addTo(map);
    });

    // 全ての地点が収まるようにズーム・パン
    if (latLngs.length === 1) {
      map.setView(latLngs[0], 10);
    } else {
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, {
        padding: [45, 45],
        maxZoom: 12,
      });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [sightings, interactive]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height,
        overflow: 'hidden',
        boxShadow: 'none',
        border: '1px solid #d8d1c4',
        borderRadius: '5px',
      }}
    >
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', zIndex: 1 }} />
      {sightings.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            right: '12px',
            zIndex: 10,
            background: '#fbf9f3',
            backdropFilter: 'none',
            padding: '4px 10px',
            borderRadius: '3px',
            fontSize: '15px',
            color: '#282a27',
            fontWeight: 500,
            boxShadow: 'none',
            pointerEvents: 'none',
          }}
        >
          {sightings.length}箇所の経由地
        </div>
      )}
    </div>
  );
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
