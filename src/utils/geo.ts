export interface CityLocation {
  pref: string;
  city: string;
  lat: number;
  lng: number;
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

// 47都道府県および主要市区町村の代表点（概算緯度経度）
export const JAPAN_CITIES: CityLocation[] = [
  // 北海道・東北
  { pref: '北海道', city: '札幌市', lat: 43.0642, lng: 141.3469 },
  { pref: '北海道', city: '函館市', lat: 41.7687, lng: 140.7288 },
  { pref: '北海道', city: '旭川市', lat: 43.7706, lng: 142.3649 },
  { pref: '北海道', city: '釧路市', lat: 42.9849, lng: 144.3818 },
  { pref: '青森県', city: '青森市', lat: 40.8244, lng: 140.7400 },
  { pref: '青森県', city: '八戸市', lat: 40.5123, lng: 141.4884 },
  { pref: '岩手県', city: '盛岡市', lat: 39.7036, lng: 141.1527 },
  { pref: '宮城県', city: '仙台市', lat: 38.2682, lng: 140.8694 },
  { pref: '秋田県', city: '秋田市', lat: 39.7186, lng: 140.1024 },
  { pref: '山形県', city: '山形市', lat: 38.2404, lng: 140.3633 },
  { pref: '福島県', city: '福島市', lat: 37.7503, lng: 140.4676 },
  { pref: '福島県', city: '郡山市', lat: 37.3999, lng: 140.3888 },

  // 関東
  { pref: '茨城県', city: '水戸市', lat: 36.3418, lng: 140.4468 },
  { pref: '茨城県', city: 'つくば市', lat: 36.0835, lng: 140.0766 },
  { pref: '栃木県', city: '宇都宮市', lat: 36.5658, lng: 139.8836 },
  { pref: '群馬県', city: '前橋市', lat: 36.3911, lng: 139.0608 },
  { pref: '群馬県', city: '高崎市', lat: 36.3225, lng: 139.0131 },
  { pref: '埼玉県', city: 'さいたま市', lat: 35.8617, lng: 139.6455 },
  { pref: '埼玉県', city: '川越市', lat: 35.9251, lng: 139.4858 },
  { pref: '千葉県', city: '千葉市', lat: 35.6074, lng: 140.1065 },
  { pref: '千葉県', city: '船橋市', lat: 35.6946, lng: 139.9825 },
  { pref: '千葉県', city: '成田市', lat: 35.7767, lng: 140.3188 },
  { pref: '東京都', city: '千代田区', lat: 35.6938, lng: 139.7536 },
  { pref: '東京都', city: '新宿区', lat: 35.6938, lng: 139.7034 },
  { pref: '東京都', city: '渋谷区', lat: 35.6580, lng: 139.7016 },
  { pref: '東京都', city: '港区', lat: 35.6586, lng: 139.7514 },
  { pref: '東京都', city: '中央区', lat: 35.6707, lng: 139.7719 },
  { pref: '東京都', city: '世田谷区', lat: 35.6466, lng: 139.6533 },
  { pref: '東京都', city: '八王子市', lat: 35.6554, lng: 139.3239 },
  { pref: '神奈川県', city: '横浜市', lat: 35.4437, lng: 139.6380 },
  { pref: '神奈川県', city: '川崎市', lat: 35.5309, lng: 139.7029 },
  { pref: '神奈川県', city: '大和市', lat: 35.4883, lng: 139.4628 },
  { pref: '神奈川県', city: '鎌倉市', lat: 35.3192, lng: 139.5467 },
  { pref: '神奈川県', city: '箱根町', lat: 35.2324, lng: 139.0436 },

  // 中部
  { pref: '新潟県', city: '新潟市', lat: 37.9161, lng: 139.0364 },
  { pref: '富山県', city: '富山市', lat: 36.6953, lng: 137.2113 },
  { pref: '石川県', city: '金沢市', lat: 36.5613, lng: 136.6562 },
  { pref: '福井県', city: '福井市', lat: 36.0652, lng: 136.2216 },
  { pref: '山梨県', city: '甲府市', lat: 35.6639, lng: 138.5683 },
  { pref: '長野県', city: '長野市', lat: 36.6513, lng: 138.1810 },
  { pref: '長野県', city: '松本市', lat: 36.2380, lng: 137.9720 },
  { pref: '岐阜県', city: '岐阜市', lat: 35.4233, lng: 136.7607 },
  { pref: '静岡県', city: '静岡市', lat: 34.9756, lng: 138.3828 },
  { pref: '静岡県', city: '浜松市', lat: 34.7108, lng: 137.7261 },
  { pref: '愛知県', city: '名古屋市', lat: 35.1815, lng: 136.9066 },
  { pref: '愛知県', city: '豊田市', lat: 35.0827, lng: 137.1561 },

  // 近畿
  { pref: '三重県', city: '津市', lat: 34.7303, lng: 136.5086 },
  { pref: '三重県', city: '伊勢市', lat: 34.4875, lng: 136.7094 },
  { pref: '滋賀県', city: '大津市', lat: 35.0045, lng: 135.8686 },
  { pref: '京都府', city: '京都市', lat: 35.0116, lng: 135.7681 },
  { pref: '京都府', city: '宇治市', lat: 34.8893, lng: 135.8005 },
  { pref: '大阪府', city: '大阪市', lat: 34.6937, lng: 135.5023 },
  { pref: '大阪府', city: '堺市', lat: 34.5733, lng: 135.4830 },
  { pref: '兵庫県', city: '神戸市', lat: 34.6901, lng: 135.1955 },
  { pref: '兵庫県', city: '姫路市', lat: 34.8152, lng: 134.6853 },
  { pref: '奈良県', city: '奈良市', lat: 34.6851, lng: 135.8048 },
  { pref: '和歌山県', city: '和歌山市', lat: 34.2260, lng: 135.1675 },

  // 中国・四国
  { pref: '鳥取県', city: '鳥取市', lat: 35.5011, lng: 134.2351 },
  { pref: '島根県', city: '松江市', lat: 35.4723, lng: 133.0505 },
  { pref: '岡山県', city: '岡山市', lat: 34.6618, lng: 133.9344 },
  { pref: '広島県', city: '広島市', lat: 34.3853, lng: 132.4553 },
  { pref: '山口県', city: '山口市', lat: 34.1784, lng: 131.4737 },
  { pref: '徳島県', city: '徳島市', lat: 34.0703, lng: 134.5548 },
  { pref: '香川県', city: '高松市', lat: 34.3401, lng: 134.0433 },
  { pref: '愛媛県', city: '松山市', lat: 33.8416, lng: 132.7661 },
  { pref: '高知県', city: '高知市', lat: 33.5597, lng: 133.5311 },

  // 九州・沖縄
  { pref: '福岡県', city: '福岡市', lat: 33.5904, lng: 130.4017 },
  { pref: '福岡県', city: '北九州市', lat: 33.8835, lng: 130.8752 },
  { pref: '佐賀県', city: '佐賀市', lat: 33.2494, lng: 130.2988 },
  { pref: '長崎県', city: '長崎市', lat: 32.7503, lng: 129.8777 },
  { pref: '熊本県', city: '熊本市', lat: 32.7898, lng: 130.7417 },
  { pref: '大分県', city: '大分市', lat: 33.2382, lng: 131.6126 },
  { pref: '宮崎県', city: '宮崎市', lat: 31.9111, lng: 131.4239 },
  { pref: '鹿児島県', city: '鹿児島市', lat: 31.5966, lng: 130.5571 },
  { pref: '沖縄県', city: '那覇市', lat: 26.2124, lng: 127.6809 },
  { pref: '沖縄県', city: '石垣市', lat: 24.3448, lng: 124.1572 },
];

export const PREFECTURES = Array.from(new Set(JAPAN_CITIES.map(c => c.pref)));

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
