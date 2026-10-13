import { JAPAN_MUNICIPALITY_ROWS } from '../data/japanMunicipalities.ts';

export interface CityLocation {
  pref: string;
  city: string;
  lat: number;
  lng: number;
  code?: string;
}

const ENGLISH_PLACE_NAMES: Record<string, string> = {
  '北海道': 'Hokkaido', '青森県': 'Aomori', '岩手県': 'Iwate', '宮城県': 'Miyagi', '秋田県': 'Akita', '山形県': 'Yamagata', '福島県': 'Fukushima',
  '茨城県': 'Ibaraki', '栃木県': 'Tochigi', '群馬県': 'Gunma', '埼玉県': 'Saitama', '千葉県': 'Chiba', '東京都': 'Tokyo', '神奈川県': 'Kanagawa',
  '新潟県': 'Niigata', '富山県': 'Toyama', '石川県': 'Ishikawa', '福井県': 'Fukui', '山梨県': 'Yamanashi', '長野県': 'Nagano', '岐阜県': 'Gifu', '静岡県': 'Shizuoka', '愛知県': 'Aichi',
  '三重県': 'Mie', '滋賀県': 'Shiga', '京都府': 'Kyoto', '大阪府': 'Osaka', '兵庫県': 'Hyogo', '奈良県': 'Nara', '和歌山県': 'Wakayama',
  '鳥取県': 'Tottori', '島根県': 'Shimane', '岡山県': 'Okayama', '広島県': 'Hiroshima', '山口県': 'Yamaguchi', '徳島県': 'Tokushima', '香川県': 'Kagawa', '愛媛県': 'Ehime', '高知県': 'Kochi',
  '福岡県': 'Fukuoka', '佐賀県': 'Saga', '長崎県': 'Nagasaki', '熊本県': 'Kumamoto', '大分県': 'Oita', '宮崎県': 'Miyazaki', '鹿児島県': 'Kagoshima', '沖縄県': 'Okinawa',
  '札幌市': 'Sapporo', '函館市': 'Hakodate', '旭川市': 'Asahikawa', '釧路市': 'Kushiro', '青森市': 'Aomori City', '弘前市': 'Hirosaki', '八戸市': 'Hachinohe', '盛岡市': 'Morioka', '仙台市': 'Sendai', '秋田市': 'Akita City', '山形市': 'Yamagata City', '福島市': 'Fukushima City', '郡山市': 'Koriyama',
  '水戸市': 'Mito', 'つくば市': 'Tsukuba', '宇都宮市': 'Utsunomiya', '前橋市': 'Maebashi', '高崎市': 'Takasaki', 'さいたま市': 'Saitama City', '川越市': 'Kawagoe', '千葉市': 'Chiba City', '船橋市': 'Funabashi', '成田市': 'Narita', '千代田区': 'Chiyoda', '新宿区': 'Shinjuku', '渋谷区': 'Shibuya', '港区': 'Minato', '中央区': 'Chuo', '世田谷区': 'Setagaya', '八王子市': 'Hachioji', '横浜市': 'Yokohama', '川崎市': 'Kawasaki', '大和市': 'Yamato', '鎌倉市': 'Kamakura', '箱根町': 'Hakone',
  '新潟市': 'Niigata City', '富山市': 'Toyama City', '金沢市': 'Kanazawa', '福井市': 'Fukui City', '甲府市': 'Kofu', '長野市': 'Nagano City', '松本市': 'Matsumoto', '岐阜市': 'Gifu City', '静岡市': 'Shizuoka City', '浜松市': 'Hamamatsu', '名古屋市': 'Nagoya', '豊田市': 'Toyota', '会津若松市': 'Aizuwakamatsu',
  '津市': 'Tsu', '伊勢市': 'Ise', '大津市': 'Otsu', '京都市': 'Kyoto City', '宇治市': 'Uji', '大阪市': 'Osaka City', '堺市': 'Sakai', '神戸市': 'Kobe', '姫路市': 'Himeji', '奈良市': 'Nara City', '和歌山市': 'Wakayama City',
  '鳥取市': 'Tottori City', '松江市': 'Matsue', '岡山市': 'Okayama City', '広島市': 'Hiroshima City', '山口市': 'Yamaguchi City', '徳島市': 'Tokushima City', '高松市': 'Takamatsu', '松山市': 'Matsuyama', '高知市': 'Kochi City',
  '福岡市': 'Fukuoka City', '北九州市': 'Kitakyushu', '佐賀市': 'Saga City', '長崎市': 'Nagasaki City', '熊本市': 'Kumamoto City', '大分市': 'Oita City', '宮崎市': 'Miyazaki City', '鹿児島市': 'Kagoshima City', '那覇市': 'Naha', '石垣市': 'Ishigaki',
};

/** Translate only for display; Japanese names remain the canonical lookup and storage keys. */
export function getLocalizedPlaceName(name: string, language: 'ja' | 'en'): string {
  return language === 'en' ? ENGLISH_PLACE_NAMES[name] ?? name : name;
}

export function getLocalizedLocationLabel(prefecture: string, municipality: string, language: 'ja' | 'en'): string {
  const pref = getLocalizedPlaceName(prefecture, language);
  const city = getLocalizedPlaceName(municipality, language);
  return language === 'ja' ? `${pref} ${city}` : `${city}, ${pref}`;
}

// All local governments and designated-city wards, with bundled representative points.
export const JAPAN_CITIES: CityLocation[] = JAPAN_MUNICIPALITY_ROWS.map(
  ([pref, city, lat, lng, code]) => ({ pref, city, lat, lng, code }),
);

export const PREFECTURES = Array.from(new Set(JAPAN_CITIES.map(c => c.pref)));

export const EMPTY_LOCATION_SELECTION = { prefecture: '', municipality: '' } as const;

export function selectPrefecture(prefecture: string) {
  return { prefecture, municipality: '' };
}

export function isMunicipalitySelectionValid(prefecture: string, municipality: string): boolean {
  return Boolean(prefecture && municipality && getMunicipalityLocation(prefecture, municipality));
}

export function getCitiesByPrefecture(pref: string): CityLocation[] {
  return JAPAN_CITIES.filter(c => c.pref === pref);
}

/** Return the bundled municipality representative point; never store user GPS in Firestore. */
export function getMunicipalityLocation(pref: string, municipality: string): CityLocation | undefined {
  return JAPAN_CITIES.find((city) => city.pref === pref && city.city === municipality);
}

// ハバーサインの公式により2点間の距離(km)を計算
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  
  const R = 6371; // 地球の半径 (km)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Math.round(distance);
}

// ユーザーの位置情報(GPS等)から最も近い市区町村の代表点に丸める（プライバシー保護）
export function findNearestCity(lat: number, lng: number): CityLocation {
  let nearest = JAPAN_CITIES[0];
  let minDistance = Infinity;

  for (const city of JAPAN_CITIES) {
    const dist = calculateDistanceKm(lat, lng, city.lat, city.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = city;
    }
  }

  return nearest;
}
