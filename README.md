# お札の旅 (Where's George? 日本版)

日本国内を巡る日本円紙幣（1000円札・5000円札・10000円札）の移動をみんなで記録・追跡し、可視化する市民参加型のWebアプリケーションです。

**Live demo:** [https://osatsu-no-tabi.ayago.workers.dev/](https://osatsu-no-tabi.ayago.workers.dev/)

米国の著名な追跡プロジェクト「Where's George?」を原案に、現代のスマートフォン利用および日本の紙幣流通・プライバシー基準に最適化して再構築しています。

---

## 🌟 主な特徴

- 📱 **スマートフォン最優先UI**: 片手で扱いやすいモバイルファースト設計。
- 🗺️ **無料オープン地図 (OpenStreetMap + Leaflet)**: 有料APIを一切使わず、紙幣の旅の軌跡（地点ピン＆移動ポリライン）を鮮やかに表示。
- 🔒 **プライバシー保護**: 正確なGPS座標は保持・公開せず、市区町村レベルに自動丸め。
- 🎊 **再発見（HIT）の特別演出**: 過去に登録されたお札が再び見つかった際、「第N人目の発見者」演出と紙吹雪エフェクトで感動を共有。
- 🛡️ **自然な流通の保護（マナー啓発）**: お札への書き込み・押印・シール貼り等の禁止を明記し、自然な流通を皆で見守る設計。
- ⚡ **Firebase & ゼロコンフィグ フォールバック**: Firebase環境変数が未設定の場合でも、即座にローカルストレージ＆代表的な旅データで動作。

---

## 🛠️ 技術構成

- **フロントエンド**: React 19, TypeScript, Vite
- **地図ライブラリ**: Leaflet, OpenStreetMap (CartoDB Positron / OSM tiles)
- **アイコン**: Lucide React
- **演出**: Canvas Confetti
- **バックエンド / データベース**: Firebase Firestore
- **スタイリング**: Vanilla CSS（デザインシステム・トークン定義、外部ユーティリティ不要）
- **デプロイ対象**: Cloudflare Workers (Static Assets)

---

## 🚀 ローカル起動方法

### 1. リポジトリの準備
```bash
git clone <repository-url>
cd George
```

### 2. 依存関係のインストール
```bash
npm install
```

### 3. 開発サーバーの起動
```bash
npm run dev
```
ブラウザで表示されたURL（例: `http://localhost:5173/`）を開きます。
※ Firebaseの環境変数が設定されていなくても、内蔵のローカルリポジトリ＆サンプルデータですべての機能を即座にお試しいただけます。

### 4. プロダクションビルドとCloudflare Workers環境での動作確認
```bash
# Viteビルド
npm run build

# Cloudflare Workersローカル環境（Wrangler）での静的アセット配信テスト
npm run preview:cf
# (または npm run preview でViteプレビューサーバー起動)
```

---

## ⚙️ Firebase設定方法

本格的な永続化を行う場合は、無料枠で利用できるFirebaseプロジェクトを作成します。

1. [Firebase Console](https://console.firebase.google.com/) にアクセスし、新規プロジェクトを作成。
2. 左メニュー「Firestore Database」を選択し、「データベースの作成」を実行（本番モードまたはテストモード）。
3. プロジェクトの設定 > マイアプリ > 「ウェブアプリ（</>）」を追加し、表示される `firebaseConfig` の値を確認。
4. プロジェクト直下の `.env.example` をコピーして `.env` を作成し、値を入力します。

### 環境変数 (`.env`)
```ini
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-app.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:...
```

---

## 📐 Firestore データ構造

紙幣情報（`bills`）と各発見履歴（`sightings`）を分離し、1対多の関係を効率的かつ安全に管理できる構造にしています。

### コレクション: `bills`
各紙幣の基本情報および最新の集計ステータス。

```typescript
{
  id: string,               // 正規化された記番号（例: "AA123456B"、将来ハッシュ化も可）
  serialNumber: string,     // 正規化記番号
  denomination: number,     // 額面 (1000 | 5000 | 10000)
  createdAt: string,        // 初回登録日時 (ISO8601)
  updatedAt: string,        // 最新発見日時 (ISO8601)
  sightingsCount: number,   // 発見回数 (1, 2, 3...)
  totalDistanceKm: number,  // 累計移動距離 (km)
  firstSightedAt: string,   // 最初の発見日時
  lastSightedAt: string,    // 最新の発見日時（表示用ISO8601）
  lastSightedAtServer?: Timestamp // クールダウン判定用。移行中は旧billでは未設定の場合がある
}
```

### コレクション: `sightings`
各ユーザーによる紙幣の発見記録。

```typescript
{
  id: string,               // ドキュメントID
  billId: string,           // 対象紙幣のID
  step: number,             // 第Nの足跡 (1st, 2nd, 3rd...)
  prefecture: string,       // 都道府県（例: "神奈川県"）
  municipality: string,     // 市区町村（例: "大和市"）
  latitudeApprox: number,   // 代表緯度（概算）
  longitudeApprox: number,  // 代表経度（概算）
  userNote?: string,        // 旅のひと言メモ（任意、60文字以内）
  createdAt: string,        // 発見日時 (ISO8601)
  distanceFromPrevKm?: number, // 直前の発見地からの移動距離 (km)
  daysFromPrev?: number     // 直前の発見地からの経過日数
}
```

### 📈 大規模化に向けた将来改善（統計専用ドキュメント方式への移行）
現在のトップページ統計は、Firestoreのサーバー側集計機能（`getAggregateFromServer` / `getCountFromServer`）および `orderBy + limit(1)` の並列実行により、ドキュメントの全件ダウンロードを一切行わない高効率な構成となっています。
将来的に登録紙幣が数十万〜数百万枚規模に成長し、集計クエリ自体のスキャンコストやレイテンシが問題となる場合には、`stats/global` のような専用集計ドキュメント（または分散カウンター）を用意し、紙幣登録トランザクション実行時にインクリメント更新する方式へ移行可能です。

---

## 🔒 プライバシー & セキュリティ設計

1. **位置情報の市区町村丸め**
   - ユーザーのデバイスから正確なGPS座標を取得した場合でも、直ちに最寄りの市区町村代表地点（全国主要自治体データテーブル）に変換・丸め込みを行います。ピンポイントの番地・座標データは一切メモリやサーバーに保持しません。
2. **紙幣画像の非保存**
   - 本サービスでは紙幣の写真や画像データをサーバーにアップロード・保存しません。
3. **いたずら・連投抑制**
   - 新クライアントはFirestore Security Rulesで同一紙幣の再発見を15分制限し、別の紙幣は制限しません。
   - 移行期間中の旧クライアント互換Rules経路では15分制限を完全には保証できません。移行完了後はstrict Rulesへ切り替えてください。
   - App Check (reCAPTCHA Enterprise) とFirestore Security Rulesを併用します。
4. **紙幣への書き込み厳禁の明示**
   - 米国等で見られるお札へのURLスタンプや落書きを明確に禁止し、自然な流通を観察する市民科学プロジェクトとしての健全性を維持します。

---

## 🚢 Cloudflare Workers (Static Assets) へのデプロイ方法

本プロジェクトは **Cloudflare Workers Static Assets** を採用しています。
Cloudflare公式の最新推奨（2026年基準）に準拠し、Cloudflare PagesやレガシーなWorkers Sitesを使用せず、Viteでビルドされた静的アセット（`dist/`）を直接Workers基盤から高速・グローバルに配信します。

本アプリはHash Router方式（`#/register`、`#/bill/:serial`）を採用しているため、エッジ側の特別なSPAリライト・リダイレクト設定は不要です。

---

### 方法 A. Cloudflare Dashboard + GitHub連携（推奨・最優先）

GitリポジトリとCloudflareを連携させて自動CI/CDを構築する手順です。

#### 1. GitHubリポジトリへのプッシュ
ローカルの変更をGitHubなどのリモートリポジトリへプッシュします。
```bash
git remote add origin <あなたのGitHubリポジトリURL>
git branch -M main
git push -u origin main
```

#### 2. Cloudflare Dashboardでプロジェクトを作成
1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログインします。
2. 左側メニューから **Compute (Workers & Pages)** を選択します。
3. **Create**（または「アプリケーションの作成」）をクリックし、**Workers** タブを選択。
4. **Connect to Git**（Gitに接続）を選択し、GitHubアカウントを連携して対象リポジトリを選択します。

#### 3. ビルド設定
リポジトリのルートにある `wrangler.jsonc` を自動認識しますが、設定画面で以下を確認・指定してください:
- **Project Name**: `osatsu-no-tabi`
- **Framework Preset**: `Vite` (または None)
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Root directory**: `/`

#### 4. Firebase環境変数の設定（最重要）
本番環境でFirestoreと通信するために、ビルド時環境変数を設定します。

> [!IMPORTANT]
> **ビルド時環境変数（Build Environment Variables）として設定してください**
> `VITE_FIREBASE_*` はViteが `npm run build` 実行時に静的ファイル（JSバンドル）内へ埋め込む変数（`import.meta.env`）です。
> Worker runtimeのSecretではなく、**ビルド設定画面の Environment Variables (ビルド環境変数)** に登録してください。

設定場所:
**Cloudflare Dashboard** → 対象プロジェクト → **Settings** → **Builds**（または作成画面の「Environment variables」）

| 変数名 | 説明 |
| :--- | :--- |
| `VITE_FIREBASE_API_KEY` | Firebase Web APIキー |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Authドメイン |
| `VITE_FIREBASE_PROJECT_ID` | Firebase プロジェクトID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storageバケット |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | 送信者ID |
| `VITE_FIREBASE_APP_ID` | Firebase アプリID |
| `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | reCAPTCHA Enterprise Web公開Site Key（スコアベース） |

※ 未設定の場合、本番環境ではデータの誤保存事故を防ぐため、localStorageへのフォールバックを行わずエラー画面が表示される安全設計になっています（App Checkキー未設定時は警告を表示しつつ移行フェーズとして動作）。

#### 5. デプロイと動作確認
- **Save and Deploy** をクリックします。
- 数十秒でビルド・静的アセット配置が完了し、`https://osatsu-no-tabi.<your-subdomain>.workers.dev` のような本番URLが発行されます。

---

### 方法 B. Wrangler CLI による直接デプロイ

ターミナルから直接デプロイする場合の手順です。

#### 1. Cloudflareへのログイン
```bash
npx wrangler login
```

#### 2. ビルド＆デプロイ
`.env` に本番用 `VITE_FIREBASE_*` が設定されていることを確認し、以下を実行します:
```bash
npm run deploy
```
（`npm run build && wrangler deploy` が実行され、`dist/` ディレクトリがCloudflare Workers Static Assetsとして即座に公開されます。）

### Firestore Rulesのデプロイ

本番の標準Rulesは `firestore.strict.rules` です。`firebase.json` もstrict Rulesを指しているため、通常のデプロイコマンドを使用できます。

```bash
firebase deploy --only firestore:rules --project <Firebase project ID>
```

移行用compat Rules（`firestore.rules`）は過去の旧frontend移行用です。**本番へdeployしないでください。** compat Rulesは旧clientの未認証writeを許容し、UID rate limitを迂回できる期間限定の設定です。参照や過去移行の記録のためファイルは残しています。

### 匿名Authと「この端末で登録したお札」

Firebase AuthenticationのAnonymous providerはFirebase Consoleで手動有効化してください。コードは既存Auth userを再利用し、未作成の場合だけ匿名userを作ります。Authが利用できなくても公開検索・閲覧と互換期間中の登録画面は引き続き開けます。「この端末で登録したお札」はAuth UIDがある場合だけ利用できます。

個人用の一覧は `users/{uid}/trackedBills/{billId}` に `billId`, `createdAt`, `firstRegisteredByMe`, `notifyOnRediscovery` と既読状態の `lastSeenSightingsCount`, `lastSeenAt`, `lastSeenMunicipality` を保存します。自分が新しいbillを初回登録したtransactionの成功後にだけ記録し、検索や再発見登録では追加しません。新着は `sightingsCount > lastSeenSightingsCount` で判定します。旧trackedBillsでcountがない場合、一覧の初回読み込み時に現在countをbaselineとして保存し、その場で新着にはしません。既存baselineは一覧を開いただけでは更新せず、詳細を開いて履歴を表示した後にprivate stateだけ既読更新します。Rulesは本人UIDに限定してread/writeを許可し、新fieldsはoptionalなので旧形式も有効です。公開 `bills` / `sightings` にはUID、email、FCM token、既読情報を保存しません。ブラウザデータ削除や端末変更では現状の一覧を引き継げません。将来は匿名userへGoogle等のcredentialをlinkする形で引き継ぎを検討できます。

MVPでは通知ではなく、「この端末で登録したお札」を再訪した際に新しい発見を表示する方式です。Push通知・メール通知・Cloud Functionsは実装していません。

段階展開の移行期間は終了しており、本番はstrict Rulesを標準とします。匿名Auth、trackedBillsの新着表示、bill/sighting書き込みのAuth必須化とrate limitはstrict Rulesで運用します。旧client用compat Rulesへ戻さないでください。

#### UID単位rate limit

strict Rulesでは、匿名Auth UIDごとに10分あたり10操作、24時間あたり50操作を制限します。`rateLimits/{uid}`にwindow start、count、updatedAtを保存し、登録・再発見のtransactionでbill、sightingと一緒に更新します。Rulesは`request.time`でcountと期間遷移を検証し、`getAfter()`で同じrate-limit更新がbill/sightingの両方と同一transactionに含まれることを確認します。rate-limit文書のoperation bill/sighting IDも照合するため、1つのcount増加で複数billをまとめて書き込むことはできません。cooldown clockの初期化だけの更新は登録操作ではないためrateを消費しません。

この制限は匿名UID単位です。匿名アカウントを作り直せば回避できるため完全な荒らし防止ではなく、App Check + Anonymous Auth + UID rate limitの多層防御として扱います。Strict Rules Emulatorの確認は`npm run test:rules:strict`で実行できます。

#### 将来の再発見通知

`notifyOnRediscovery` は通知設定用の保存場所だけを用意し、今回は送信しません。将来はbill再発見時にCloud Functions Firestore triggerから対象userのtrackedBillsを参照して通知する案、またはcallable Functionで登録を受けてから処理する案を比較します。Callable FunctionsではFirebase Auth tokenとApp Check tokenを検証する構成にします。

通知先はWeb Push、email、または両方を比較して決めます。Web PushはAndroid等でFirebase Cloud MessagingとService Workerを使う案があります。Appleの現行仕様ではiOS/iPadOS 16.4以降のWeb Pushはホーム画面に追加したWeb app向けです。そのためQRから一度だけアクセスする利用者に追加操作を求める負担を評価します。emailを導入する場合もemailはpublic bill dataへ置かず、private user dataまたは認証基盤側に保存します。今回はFCM、Service Worker、通知permission、Cloud Functions、email送信は実装していません。

---

## 📱 公開後の実機確認チェックリスト（10項目）

デプロイ完了後、スマートフォンおよびPCから以下の手順で本番動作を確認してください。

- [ ] **1. スマホでトップページを開く**: モバイル表示が崩れておらず、キャッチコピーやボタンが正しく表示されること。
- [ ] **2. 新しい記番号を1枚登録**: 例（`BB123456B`・千円札・東京都新宿区など）を手元のスマホから登録。
- [ ] **3. Firestore Consoleで保存を確認**: Firebaseコンソールの `bills` コレクションおよび `sightings` コレクションにドキュメントが正しく生成されていること。
- [ ] **4. 同じ記番号を別地域で再発見登録**: 再度登録画面を開き、同じ記番号を入力。額面が自動固定されることを確認し、別の地域（例: 愛知県名古屋市）で登録。
- [ ] **5. HIT演出確認**: 紙吹雪アニメーションと「第2人目の発見者」モーダルがポップアップすること。
- [ ] **6. 発見回数が2になる**: 紙幣詳細画面で「発見回数: 2回」と表示されること。
- [ ] **7. 移動距離が増える**: 総移動距離が計算され（例: 約260km）、経過日数が反映されていること。
- [ ] **8. 地図に2地点が出る**: Leaflet地図上に2つのピン（起点・最新）と、それらを結ぶ点線ポリラインが表示されること。
- [ ] **9. ページを閉じて再度開いてもFirestoreから表示される**: ブラウザのキャッシュをクリアするか別タブで `/bill/BB123456B` を直接開いても、同じデータがFirestoreから取得できること。
- [ ] **10. PCとスマホの両方から同じ紙幣を参照できる**: スマホで登録した記番号をPCブラウザの「検索」に入力し、同一の移動履歴が表示されること（マルチデバイス同期の確認）。

---

## 🛡️ Firebase App Check + reCAPTCHA Enterprise 導入と運用ガイド

本プロジェクトでは、正規のWebアプリ経由以外のトラフィック（curlや自動化スクリプト等によるFirestore直接呼び出し・大量投稿）のハードルを上げるため、**Firebase App Check（reCAPTCHA Enterprise）** を導入しています。

### 1. セキュリティ上の位置付け（できること・できないこと）

App Checkは強力な防御層ですが、万能ではありません。Firestore Security Rulesと組み合わせた「多層防御」として機能します。

* **期待できること**:
  * curl、Pythonスクリプト、PostmanなどからFirestore Web APIを直接叩く単純な自動化・連投を効果的に遮断・抑止。
  * 正規のWebアプリドメイン以外からの悪意ある乱用リクエストを大幅に低減。
  * Firestore Security Rulesと連携した多層防御の実現。
* **完全に防げないこと**:
  * 実ブラウザ（Headless Chrome / Playwright等）を自動操作する高度なボット。
  * 有効なApp Checkトークンを正規に取得した上での攻撃。
  * 実在する紙幣を装った虚偽データの入力。
  * 正規ユーザーによる仕様内のいたずら。
  * ※「100%完全に不正をゼロにする」ものではなく、攻撃者のコストと難易度を劇的に引き上げる仕組みです。

---

### 2. Google Cloud & Firebase Console での設定手順（10ステップ）

管理者の方がGoogle Cloud ConsoleおよびFirebase Consoleで実施する手順です。

1. **Google Cloud Console**（[console.cloud.google.com](https://console.cloud.google.com/)）にアクセスし、Firebaseプロジェクトと同じGoogle Cloudプロジェクトを選択。
2. 左メニュー「セキュリティ」または検索バーから **reCAPTCHA Enterprise**（Fraud Defense）を開く。
3. 「**キーを作成**（Create Key）」をクリック。
4. **プラットフォームの種類**: 「**Webサイト**」を選択。
5. **キータイプ**: **スコアベースのキー**（Score-based key）を選択。（※チェックボックス型は使用不可）
6. **ドメインの確認**: 「ドメインの確認を使用する」にチェックを入れたままにする。
7. **ドメインリストに本番ドメインを追加**:
   * Cloudflare Workersの本番URL（例: `osatsu-no-tabi.<your-subdomain>.workers.dev`）
   * 将来カスタムドメインを設定する場合はそのドメイン（例: `osatsu.example.com`）
   * ⚠️ **`localhost` は本番用reCAPTCHAキーの許可ドメインに絶対に追加しないでください**（後述のDebug Providerを使用します）。
8. 「キーを作成」をクリックし、生成された **サイトキー（Site Key）** をコピー。
9. **Firebase Console**（[console.firebase.google.com](https://console.firebase.google.com/)）を開き、左メニュー「**すべてのプロダクト**」>「**App Check**」を選択。
10. 「アプリ」タブで対象のウェブアプリを選択し、プロバイダとして「**reCAPTCHA Enterprise**」を選択して、コピーしたサイトキーを入力して保存。

---

### 3. Cloudflare Workers Builds の環境変数設定

Cloudflare Workers Buildsの設定画面で、ビルド時環境変数としてサイトキーを登録します。

* 設定場所: **Cloudflare Dashboard** → 対象プロジェクト → **Settings** → **Builds**（または作成画面の「Environment variables」）
* 変数名: `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`
* 値: Google Cloud Consoleで取得したサイトキー
* ※ Worker runtimeのSecretではなく、**Build Environment Variable** として設定してください（Viteビルド時にJSバンドルへ埋め込まれます）。

---

### 4. Enforcement（適用）有効化の手順とメトリクス確認

> [!WARNING]
> **デプロイ直後は絶対に「Enforce（適用）」をクリックしないでください。**
> まずはメトリクス収集モードで正常なトラフィックがVerifiedになることを確認します。

#### ロールアウトの流れ:
1. コードを `main` へプッシュし、Cloudflareへ再デプロイ。
2. 手持ちの **iPhone・Android・Mac** から本番サイトにアクセスし、紙幣の閲覧・登録を実際にテスト。
3. URLに `?debug=timing` を付けてアクセスし、右下の計測モニタで `App Check: reCAPTCHA Enterprise 有効` と表示されることを確認。
4. **メトリクスの確認**:
   * **Firebase Console** → **App Check** → **Cloud Firestore** を選択。
   * **Request metrics（リクエスト メトリクス）** グラフを確認。
   * **Verified requests**（検証済みリクエスト）が正常に記録されていることを確認。
   * **Unverified requests**（未検証リクエスト）やエラーが問題ない水準であることを確認。
5. **Enforcement 有効化**:
   * 正規端末からの通信がVerifiedとして安定して記録されていることを確認後、Firebase ConsoleのCloud Firestoreの行で「**適用（Enforce）**」をクリックします。

#### Enforcement 前と後で起きること:
* **Enforcement前（導入フェーズ）**:
  App Checkトークンが付与されていないリクエスト（curl等の直接通信やサイトキー未設定クライアント）もFirestoreを通過しますが、メトリクス上に「Unverified」として記録されます。本番サービスを停止させずに安全に動作確認できます。
* **Enforcement後（本番運用フェーズ）**:
  有効なApp Checkトークンを持たないリクエストは、Firestoreバックエンド側で即座に拒否（`permission-denied`）されます。正規Webアプリ以外からの直接呼び出しが完全に遮断されます。

---

### 5. localhost 開発環境での Debug Provider 利用手順

本番用reCAPTCHAキーの許可ドメインに `localhost` を含めることなく、Enforcement後もローカル開発を継続するための公式デバッグ手順です。

1. ローカルの `.env` ファイルに以下を追加:
   ```ini
   VITE_FIREBASE_APPCHECK_DEBUG=true
   ```
2. `npm run dev` でローカルサーバーを起動し、ブラウザで開発コンソール（F12 / Console）を開く。
3. 初回アクセス時にコンソールへ以下のようなDebug Tokenが出力されます:
   ```text
   App Check debug token: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX. You will need to add it to your app's App Check settings in the Firebase console for it to work.
   ```
4. **Firebase Console** → **App Check** → 「**アプリ**」タブ → 対象ウェブアプリの三点リーダー（︙） → 「**デバッグ トークンを管理**」を開く。
5. コンソールに表示されたデバッグトークンを貼り付けて登録（名前は例: `Localhost Mac`）。
6. これで、ローカル開発環境からのFirestoreアクセスも正規の「Verified」として認証されます。
* ※ `VITE_FIREBASE_APPCHECK_DEBUG` の処理は `import.meta.env.DEV` で保護されており、本番バンドル（`npm run build`）からは完全に除去されます。

---

### 6. トークンTTL・自動リフレッシュ・料金について

* **自動リフレッシュ**: `isTokenAutoRefreshEnabled: true` を設定済みです。SDKがバックグラウンドで期限切れ前に自動でトークンを更新します。
* **トークンTTL（有効期限）**:
  Firebase側のデフォルト値（標準1時間、設定可能範囲: 30分〜7日）をそのまま維持します。短すぎるTTLはレイテンシとassessment回数を増加させるため、デフォルト維持が推奨されます。
* **料金**:
  * reCAPTCHA Enterprise は月間 **10,000 assessments（評価）まで無料** です。
  * **「1ページビュー = 1 assessment」ではありません**。App Checkトークンは有効期間内キャッシュされ再利用されるため、1訪問者のセッション内でのassessment発生は通常1回（長時間滞在時のリフレッシュ時のみ追加）です。
  * ※料金体系は変更される可能性があるため、詳細は[Google Cloud reCAPTCHA Enterprise 料金公式ページ](https://cloud.google.com/recaptcha-enterprise/pricing)をご確認ください。

---

### 7. iPhone性能（Long Polling対策）との両立

App Check導入後も、iPhone（iOS WebKit）での30秒ハングを防止する `initializeFirestore(app, { experimentalForceLongPolling: true })` は完全維持されています。

本番URLに `?debug=timing` を付けてアクセスすることで、右下の「Firestore 計測ログ」パネルから、App Check導入前後でクエリ所要時間（通常200〜600ms程度）に悪化がないことをいつでも実機検証できます。

---

## 📷 端末内OCR機能の実機確認チェックリスト

ブラウザ内Tesseract.jsによる紙幣記番号OCRを試験したが、iPhone/Android実機で十分な安定性が得られなかったためMVPでは非公開。将来は別OCR方式を検討する。

OCRコードと診断UIは将来の再検討用に保持し、`?debug=timing` を付けた場合のみ利用できます。通常の登録では従来どおり記番号を手入力します。

> [!CAUTION]
> **プライバシー・セキュリティ注意**:
> OCRテスト・動作確認に使用した紙幣の画像ファイルは、Gitリポジトリへコミットしないでください。

---

## 🔮 今後の開発ロードマップ & OCR将来改善案

### 📐 OCR機能の将来改善案（MVP以降）
- [ ] **記番号OCRの認識条件比較**: 必要になった場合にRAW_LINEを候補として実画像で比較する（文字分割OCRや推測による自動補完は行わない）。
- [ ] **ライブカメラプレビュー (`getUserMedia`)**: 撮影シャッターを押さずに映像ストリーム上でリアルタイム認識。
- [ ] **記番号位置のガイド枠（オーバーレイ）**: ファインダー上に記番号を合わせる枠線を表示し、手ブレと誤撮影を防止。
- [ ] **自動クロップ / 透視補正**: 紙幣の輪郭検出を行い、記番号領域だけを自動切り出しして認識精度向上。
- [ ] **複数フレーム認識**: 複数コマを連続解析し、多数決でOCR誤認識を極小化。
- [ ] **OCR信頼度（Confidence）表示**: 各候補文字の確信度を視覚化し、補正候補を分かりやすく提示。
- [ ] **画像からの金種自動認識**: 記番号だけでなく、紙幣券面の「1000」「5000」「10000」意匠を検出して金種を自動判定。

### 🗺️ アプリ全体のロードマップ
- [ ] **端末内記番号OCR**: 実機で安定性が得られずMVPでは非公開。将来、別方式を検討。
- [x] **最近の旅のサンプル表示**: 固定のサンプル約45件をホームの最近の旅枠でのみ表示。実データより後に並べ、統計・Firestore・検索・地図には含めない。
- [x] **同一紙幣の投稿クールダウン**: 同じ紙幣の再発見登録は15分以内を拒否。サーバーTimestampとFirestore Rulesで検証し、別の紙幣は制限しない。
- [ ] **紙幣再発見通知**: 自分が登録したお札が他のユーザーに再発見された際のメール/Web Push通知。
- [x] **この端末で登録したお札**: Anonymous Authとprivate trackedBillsを使った一覧を実装。通知送信は未実装。
- [ ] **全国移動ヒートマップ**: 日本全国でお札がどのように流動しているかのマクロ動態マップ。
- [ ] **ランキング機能**: 最長旅行距離ランキング、最長生存日数ランキング、都道府県別流入・流出統計。
- [ ] **オープンデータ / 研究用途API**: 貨幣流通や地域経済の移動パターンの研究用匿名化オープンデータ提供。
