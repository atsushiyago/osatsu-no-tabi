export type Language = 'ja' | 'en';

const ja = {
  appTitle: 'お札の旅 | 日本円紙幣の移動をみんなで追跡するプロジェクト',
  appDescription: '手元のお札はどこからやってきて、どこへ旅するのか？日本円紙幣の記番号と市区町村を記録し、みんなで紙幣の旅路を可視化する参加型トラッキングサービスです。',
  firebaseEnvWarning: '⚠️ Firebase環境変数が未設定です。Cloudflare (Workers Builds) の環境変数を設定してください。',
  brand: 'お札の旅', social: '外部リンク', home: 'ホーム', register: '登録する', search: '検索', tracked: '登録したお札',
  newDiscoveryKicker: 'あなたの旅ノートに新しい足跡', newDiscoveryTitle: 'あなたのお札に新しい旅の記録があります',
  newDiscoveryOne: '1枚のお札が、また別の場所で見つかりました', newDiscoveryMany: '{count}枚のお札に新しい発見があります', rediscovery: '再発見',
  recentMove: '直近の移動 {from} から {to} へ', viewTracked: '登録したお札を見る', heroTag: '日本円紙幣の移動追跡プロジェクト',
  heroTitle: 'このお札、前はどこにいた？', heroDescription: '手元のお札の記番号を登録すると、同じお札を誰かが再び登録したとき、そのお札が日本をどう旅したのかを見ることができます。',
  registerBill: '手元にあるお札を登録する', returnNoteLabel: 'また旅の続きを見る楽しみ', returnNote: '登録後も、お札はいつも通りお使いください。', returnNoteFollowup: '数週間後、また旅の続きを見にきてください。',
  statsTitle: '全国の旅の統計', registeredBills: '登録された紙幣数', sightings: '総発見回数', rediscoveredBills: '再発見された紙幣', longestDistance: '最長移動距離',
  recentJourneys: '最近の旅', seeAll: 'すべて見る', mannerTitle: 'お札への書き込み・シール等は厳禁です', mannerText: 'このプロジェクトは、自然に市中を流通している紙幣の偶然の再会をみんなで見守る市民実験です。お札へのペンでの書き込み、スタンプ、シールの貼付等は、紙幣を傷め法律やマナーに反するため絶対にやめましょう。',
  publicBillsTitle: 'みんなのお札', publicBillsDescription: '登録されたお札を新しい順に表示しています。', loadingList: '一覧を読み込んでいます…',
  loadError: '一覧を読み込めませんでした。通信環境を確認してください。', retry: 'もう一度読み込む', noPublicBills: 'まだ登録されたお札はありません', publicListLabel: '登録された公開紙幣',
  nextPageError: '次の一覧を読み込めませんでした。もう一度お試しください。', loadingMore: '読み込んでいます…', loadMore: 'もっと見る',
  detailLoading: '旅の記憶を読み込んでいます...', billMissing: 'お札が見つかりませんでした', billMissingDescription: '指定された旅の記録は見つかりませんでした。', back: '戻る',
  copyFailed: 'URLのコピーに失敗しました', copied: 'リンクをコピーしました！', shareJourney: '旅をシェア', yenBill: '{amount}円札', journeyBill: '旅するお札 #{id}',
  ongoingJourney: '継続中の旅', firstDiscovery: '最初の発見', discoveryCount: '発見回数', firstRegistered: '最初の登録', totalDistance: '総移動距離', elapsedDays: '経過日数',
  registeredSuccess: '登録しました', useNormally: 'このお札を手元に保管する必要はありません。いつも通りお使いください。', visitAgain: '数週間したら、また旅の続きを見にきてください。',
  mapTitle: '日本列島の移動軌跡', mapHint: '地図の印を選ぶと詳細を確認できます', historyTitle: '移動履歴 ({count}地点)',
  stepLabel: '第{step}の足跡', origin: '起点', latest: '最新', registrationDate: '登録日', fromPrevious: '前の街から', moved: '移動', dayUnit: '日', routeStops: '{count}箇所の経由地',
  lastLocation: '最終発見地: {city}', discoveryNth: '{count}回目', approximateDistance: '約{distance}km', sample: 'サンプル', sampleJourney: 'サンプル旅 {id}', unknown: '不明',
  statsBillUnit: '枚', statsSightingUnit: '回', distanceUnit: 'km', shareTitle: 'お札の旅 - {amount}円札', shareDescription: 'この{amount}円札は{count}回発見され、日本を約{distance}km旅しています！',
  searchHeading: '記番号を検索する', searchDescription: '紙幣に印字されたアルファベットと数字を入力してください。', serialLabel: '記番号', serialPlaceholder: '例: AA123456BB', serialHelp: '全角・小文字でも自動変換します', serialExamples: '例：AA123456BB（新紙幣） / A123456B・AA123456B（従来券）', serialValid: '記番号の形式は正しいです', searching: '検索中...', executeSearch: 'このお札の旅を調べる', notFoundHeading: 'この記番号のお札は、まだ登録されていません。', notFoundText: '入力した記番号を最初に登録して、旅の記録を始められます。', firstDiscoverer: 'あなたが最初の発見者になりませんか？', registerThisSerial: 'この記番号で最初の登録をする',
  registerHeading: 'お札を登録する', registerDescription: '手元にある紙幣の情報を入力して、旅路を記録しましょう。', denominationStep: '1. 額面', registered: '登録済み', required: '必須', existingDenomination: 'このお札は {amount}円札 として登録済みです', fixedDenomination: '再発見となるため額面は固定されています（これまでの発見: {count}回）',
  denominationLabel1000: '千円札', denominationLabel5000: '五千円札', denominationLabel10000: '一万円札', serialStep: '2. 記番号を入力', normalizeHelp: '全角・半角・小文字は自動変換されます。ハイフンやスペースは不要です。', normalizedSerial: '正規化記番号:', checkingRegistration: '（登録状況を確認中...）', rediscoveryBill: '🎉 再発見のお札です！',
  locationStep: '3. 現在の地域（市区町村まで）', locationPrivacy: '位置情報の自動設定は任意です。保存するのは市区町村までで、GPS座標や正確な住所は保存・公開しません。', locating: '位置判定中...', locateFromDevice: '現在地から市区町村を自動設定', locationUnsupported: 'お使いの端末またはブラウザは位置情報取得に対応していません。', locationGetting: '位置情報を取得中（市区町村レベルに変換します）...', locationSet: '最寄りの「{prefecture} {city}」を設定しました', locationDenied: '位置情報の取得が許可されていないため、手動で選択してください', prefecture: '都道府県', municipality: '市区町村',
  memoStep: '4. 旅のメモ・出会った場所（任意）', optional: '任意', memoPlaceholder: '例: 駅前のカフェでお釣りとして受け取りました', memoPrivacy: '※最大60文字。個人情報や特定の日時・店舗名は避け、旅の雰囲気のみ記録してください。', submitting: '登録しています...', submitRegistration: 'お札の旅を登録する', cancel: 'キャンセル',
  serialRequired: '記番号を入力してください', serialInvalid: '記番号の形式を確認してください。', serialForbiddenLetters: '記番号の英字には I（アイ）と O（オー）は使われません', serialRange: '記番号の数字部分は000001〜900000です', serialCheckFirst: '記番号をご確認ください', checkingBill: '登録状況を確認しています。少し待ってからもう一度お試しください。', billCheckFailed: '旅の記録を確認できませんでした。もう一度検索してください。', cooldown: 'このお札はついさっき登録されています。あと約{minutes}分で再登録できます。',
  dailyLimit: '本日の登録回数が上限に達しました。時間をおいてからもう一度お試しください。', tooManySubmissions: '短時間に多くの登録が行われました。しばらく待ってからもう一度お試しください。', registrationDenied: '登録処理が許可されませんでした。しばらくしてからもう一度お試しください。', authNotReady: '認証の準備が完了していません。ページを再読み込みしてもう一度お試しください。', networkRetry: '通信環境をご確認のうえ、もう一度お試しください。', registrationFailed: '登録中にエラーが発生しました。再度お試しください。',
  trackedTitle: '登録したお札', syncedNote: 'Googleと同期した登録したお札の一覧です。同じGoogleアカウントで別の端末からも確認できます。', localNote: 'この端末・ブラウザから登録したお札の一覧です。', syncTitle: '別の端末でも登録したお札を見る', syncDescription: 'Googleアカウントと同期すると、別のブラウザや端末でも同じ一覧を確認できます。', syncProgress: 'Googleと同期しています…', syncButton: 'Googleで同期する',
  popupFallbackDescription: 'Googleアカウントを確認できませんでした。ボタンを押して、既存の同期データを開いてください。', popupFallbackButton: 'Googleアカウントのデータを開く', syncedTitle: 'Googleと同期しています', syncedDescription: '別の端末でも同じGoogleアカウントで利用できます。', newDiscoveries: '{count}枚のお札に新しい発見があります', trackedEmpty: '登録したお札はまだありません', trackedEmptyHint: '最初に登録したお札が、ここに表示されます。', trackedListLabel: '登録したお札の一覧', newDiscoveryBadge: '新しい発見あり +{count}', noRecord: '記録なし', previous: '前回', current: '現在', lastSighted: '最終発見: {date}', trackedNextError: '次のお札を読み込めませんでした。もう一度お試しください。',
  switchGoogleTitle: 'このGoogleアカウントには、すでに「お札の旅」のデータがあります。', switchGoogleWarning: 'このブラウザには未同期の「登録したお札」があります。既存のGoogle同期データへ切り替えると、このブラウザの一覧は自動では統合されません。', switchGooglePrompt: '既存のGoogle同期データへ切り替えますか？', trackedSaveFailed: '登録は完了しましたが、「登録したお札」の一覧には保存できませんでした。', trackedPrepare: '登録したお札を準備しています…', trackedUnavailable: '現在この機能を利用できません。公開中のお札の検索や閲覧は引き続き利用できます。',
  googlePopupBlocked: 'Google認証の画面を開けませんでした。ポップアップを許可して、もう一度お試しください。', googleNetworkError: '通信に失敗しました。ネットワークを確認して、もう一度お試しください。', googleNotEnabled: 'Googleログインがまだ有効になっていません。時間をおいて再度お試しください。', googleUnauthorizedDomain: 'このサイトではGoogleログインを利用できません。管理者へお問い合わせください。', googleGenericError: 'Googleとの同期に失敗しました。時間をおいて再度お試しください。',
  celebrationTitle: '奇跡の再発見！ (HIT)', celebrationHeading: 'このお札は以前にも登録されています！', celebrationCount: 'あなたはこのお札の第{count}人目の発見者です！', lastCity: '前回の街から', daysSince: '経過日数', daysAgo: '日ぶり', viewJourney: 'お札の旅の軌跡を見る', close: '閉じる',
} as const;

export type TranslationKey = keyof typeof ja;
const en: Record<TranslationKey, string> = {
  appTitle: 'Banknote Journey | Track Japanese banknotes together',
  appDescription: 'Where has the banknote in your hand been, and where will it go? Record its serial number and municipality to follow its journey across Japan.',
  firebaseEnvWarning: '⚠️ Firebase environment variables are missing. Configure them in Cloudflare Workers Builds.',
  brand: 'Banknote Journey', social: 'External links', home: 'Home', register: 'Register', search: 'Search', tracked: 'My banknotes',
  newDiscoveryKicker: 'A new mark in your journey journal', newDiscoveryTitle: 'There is a new journey update for your banknote',
  newDiscoveryOne: 'One of your banknotes was found in another place', newDiscoveryMany: '{count} banknotes have new discoveries', rediscovery: 'Rediscovered',
  recentMove: 'Latest move: {from} to {to}', viewTracked: 'View my banknotes', heroTag: 'A project tracking Japanese banknotes',
  heroTitle: 'Where has this banknote been?', heroDescription: 'Register the serial number of a banknote you have. When someone finds the same note, you can see its journey across Japan.',
  registerBill: 'Register a banknote', returnNoteLabel: 'Enjoy following the journey', returnNote: 'Use the banknote as you normally would after registering it.', returnNoteFollowup: 'Come back in a few weeks to see where its journey has taken it.',
  statsTitle: 'Journey statistics across Japan', registeredBills: 'Banknotes registered', sightings: 'Total discoveries', rediscoveredBills: 'Banknotes rediscovered', longestDistance: 'Longest journey',
  recentJourneys: 'Recent journeys', seeAll: 'See all', mannerTitle: 'Please do not write on or attach anything to banknotes', mannerText: 'This community project follows the unexpected reunions of banknotes circulating naturally. Writing, stamping, or attaching stickers can damage banknotes and violate laws or etiquette. Please do not alter them.',
  publicBillsTitle: 'Community banknotes', publicBillsDescription: 'Banknotes are listed from newest to oldest.', loadingList: 'Loading banknotes…',
  loadError: 'Could not load the list. Please check your connection.', retry: 'Try again', noPublicBills: 'No banknotes have been registered yet', publicListLabel: 'Public banknotes',
  nextPageError: 'Could not load more banknotes. Please try again.', loadingMore: 'Loading…', loadMore: 'Load more',
  detailLoading: 'Loading this banknote’s journey…', billMissing: 'Banknote not found', billMissingDescription: 'We could not find the requested journey.', back: 'Back',
  copyFailed: 'Could not copy the URL', copied: 'Link copied!', shareJourney: 'Share journey', yenBill: '{amount} banknote', journeyBill: 'Traveling banknote #{id}',
  ongoingJourney: 'Journey in progress', firstDiscovery: 'First discovery', discoveryCount: 'Discoveries', firstRegistered: 'First registered', totalDistance: 'Total distance', elapsedDays: 'Days elapsed',
  registeredSuccess: 'Registered', useNormally: 'You do not need to keep this banknote. Please use it as you normally would.', visitAgain: 'Come back in a few weeks to follow its journey.',
  mapTitle: 'Journey across Japan', mapHint: 'Select a marker on the map to see details', historyTitle: 'Discovery history ({count} locations)',
  stepLabel: 'Stop {step}', origin: 'Start', latest: 'Latest', registrationDate: 'Date', fromPrevious: 'From previous location', moved: 'traveled', dayUnit: 'days', routeStops: '{count} stops',
  lastLocation: 'Last found: {city}', discoveryNth: 'Discovery {count}', approximateDistance: 'Approx. {distance} km', sample: 'Sample', sampleJourney: 'Sample journey {id}', unknown: 'Unknown',
  statsBillUnit: '', statsSightingUnit: '', distanceUnit: 'km', shareTitle: 'Banknote Journey - ¥{amount} banknote', shareDescription: 'This ¥{amount} banknote has been found {count} times and traveled about {distance} km across Japan!',
  searchHeading: 'Search by serial number', searchDescription: 'Enter the letters and numbers printed on the banknote.', serialLabel: 'Serial number', serialPlaceholder: 'Example: AA123456BB', serialHelp: 'Full-width characters and lowercase letters are converted automatically', serialExamples: 'Example: AA123456BB (new design) / A123456B or AA123456B (previous designs)', serialValid: 'Serial number format is valid', searching: 'Searching...', executeSearch: 'Find this banknote’s journey', notFoundHeading: 'This serial number has not been registered yet.', notFoundText: 'Register this serial number to start its journey record.', firstDiscoverer: 'Would you like to be the first to find it?', registerThisSerial: 'Register this banknote first',
  registerHeading: 'Register a banknote', registerDescription: 'Enter the details of a banknote you have to record its journey.', denominationStep: '1. Denomination', registered: 'Already registered', required: 'Required', existingDenomination: 'This banknote is already registered as a ¥{amount} banknote', fixedDenomination: 'The denomination is fixed for rediscoveries (discoveries so far: {count})',
  denominationLabel1000: 'Banknote', denominationLabel5000: 'Banknote', denominationLabel10000: 'Banknote', serialStep: '2. Enter the serial number', normalizeHelp: 'Full-width characters and lowercase letters are converted automatically. Hyphens and spaces are not needed.', normalizedSerial: 'Normalized serial:', checkingRegistration: '(Checking registration...)', rediscoveryBill: '🎉 This banknote has been rediscovered!',
  locationStep: '3. Current location (municipality)', locationPrivacy: 'Using your location is optional. We store only the municipality; GPS coordinates and exact addresses are never stored or published.', locating: 'Finding location...', locateFromDevice: 'Set municipality from my location', locationUnsupported: 'Location is not supported by this device or browser.', locationGetting: 'Getting your location and converting it to a municipality...', locationSet: 'Nearest location set to “{city}, {prefecture}”', locationDenied: 'Location access was not granted. Please choose a location manually.', prefecture: 'Prefecture', municipality: 'Municipality',
  memoStep: '4. Journey note or where you found it (optional)', optional: 'Optional', memoPlaceholder: 'Example: Received as change at a café near the station', memoPrivacy: 'Up to 60 characters. Avoid personal information, exact dates, and business names; describe the general feel of the journey.', submitting: 'Registering...', submitRegistration: 'Register this journey', cancel: 'Cancel',
  serialRequired: 'Enter a serial number.', serialInvalid: 'Check the serial number format.', serialForbiddenLetters: 'The letters I and O are not used in Japanese banknote serial numbers.', serialRange: 'The number portion must be between 000001 and 900000.', serialCheckFirst: 'Please check the serial number.', checkingBill: 'Checking registration. Please wait a moment and try again.', billCheckFailed: 'Could not verify the journey. Please search again.', cooldown: 'This banknote was registered just recently. You can register it again in about {minutes} minutes.',
  dailyLimit: 'You have reached today’s registration limit. Please try again later.', tooManySubmissions: 'Too many registrations were submitted in a short time. Please wait and try again.', registrationDenied: 'Registration was not allowed. Please wait a moment and try again.', authNotReady: 'Authentication is not ready. Reload the page and try again.', networkRetry: 'Check your connection and try again.', registrationFailed: 'Registration failed. Please try again.',
  trackedTitle: 'My banknotes', syncedNote: 'Your banknotes synced with Google. Open the same list on another device with the same Google Account.', localNote: 'Banknotes registered from this device and browser.', syncTitle: 'See your banknotes on other devices', syncDescription: 'Sync with a Google Account to see the same list in other browsers and devices.', syncProgress: 'Syncing with Google…', syncButton: 'Sync with Google',
  popupFallbackDescription: 'We could not confirm your Google Account. Select the button to open your existing synced data.', popupFallbackButton: 'Open Google Account data', syncedTitle: 'Synced with Google', syncedDescription: 'Use the same Google Account to access this list on other devices.', newDiscoveries: '{count} banknotes have new discoveries', trackedEmpty: 'You have no registered banknotes yet', trackedEmptyHint: 'Banknotes you register will appear here.', trackedListLabel: 'My registered banknotes', newDiscoveryBadge: 'New discoveries +{count}', noRecord: 'No record', previous: 'Previous', current: 'Current', lastSighted: 'Last found: {date}', trackedNextError: 'Could not load more banknotes. Please try again.',
  switchGoogleTitle: 'This Google Account already has Banknote Journey data.', switchGoogleWarning: 'This browser has unsynced banknotes. Switching to the existing Google data will not merge this browser’s list automatically.', switchGooglePrompt: 'Switch to the existing Google data?', trackedSaveFailed: 'Registration succeeded, but this banknote could not be saved to your personal list.', trackedPrepare: 'Preparing your banknotes…', trackedUnavailable: 'This feature is currently unavailable. You can still search and view public banknotes.',
  googlePopupBlocked: 'Could not open Google sign-in. Allow pop-ups and try again.', googleNetworkError: 'A network error occurred. Check your connection and try again.', googleNotEnabled: 'Google sign-in is not enabled yet. Please try again later.', googleUnauthorizedDomain: 'Google sign-in is not available on this site. Contact the administrator.', googleGenericError: 'Could not sync with Google. Please try again later.',
  celebrationTitle: 'A remarkable rediscovery! (HIT)', celebrationHeading: 'This banknote has been registered before!', celebrationCount: 'You are discovery number {count} for this banknote!', lastCity: 'Since the previous location', daysSince: 'Time since last discovery', daysAgo: 'days ago', viewJourney: 'View this banknote’s journey', close: 'Close',
};

export const dictionaries = { ja, en } as const;
export const LANGUAGE_STORAGE_KEY = 'osatsu-no-tabi-language';

export function detectLanguage(browserLanguage?: string | null): Language {
  return browserLanguage?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function getInitialLanguage(savedLanguage: string | null | undefined, browserLanguage?: string | null): Language {
  return savedLanguage === 'ja' || savedLanguage === 'en' ? savedLanguage : detectLanguage(browserLanguage);
}

export function saveLanguagePreference(storage: Pick<Storage, 'setItem'>, language: Language): void {
  storage.setItem(LANGUAGE_STORAGE_KEY, language);
}

export function translate(language: Language, key: TranslationKey, values: Record<string, string | number> = {}): string {
  return dictionaries[language][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

export function formatNumber(language: Language, value: number): string {
  return new Intl.NumberFormat(language === 'ja' ? 'ja-JP' : 'en-US').format(value);
}

export function formatDate(language: Language, value: string | number | Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', options).format(new Date(value));
}

export function formatYen(language: Language, value: number): string {
  return new Intl.NumberFormat(language === 'ja' ? 'ja-JP' : 'en-US', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(value);
}
