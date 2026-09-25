# お札の旅 (Where's George? 日本版)

日本国内を巡る日本円紙幣（1000円札・5000円札・10000円札）の移動をみんなで記録・追跡し、可視化する市民参加型のWebアプリケーションです。

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
  lastSightedAt: string     // 最新の発見日時
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
   - 同一端末から同一記番号の短時間（15分以内）の重複送信をクライアント側でブロック。
   - サービス層（`billService.ts`）に抽象化レイヤーを設けており、将来的にFirebase AuthやCloud FunctionsでのRate Limit、App Check (reCAPTCHA Enterprise)、記番号のSHA-256ハッシュ化をシームレスに差し替え可能です。
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

※ 未設定の場合、本番環境ではデータの誤保存事故を防ぐため、localStorageへのフォールバックを行わずエラー画面が表示される安全設計になっています。

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

## 🛡️ 次のセキュリティ強化ステップ: Firebase App Check

本番公開完了後の次工程として **Firebase App Check** の導入を推奨します。
未認証のスクリプトや不正なクライアントからのFirestore直接呼び出しを遮断し、正規のWebアプリ経由のトラフィックのみを許可します。

> [!NOTE]
> **最新公式推奨: reCAPTCHA Enterprise の利用**
> Firebase公式ドキュメントでは、新規Web統合におけるApp Checkプロバイダとして従来のreCAPTCHA v3ではなく **reCAPTCHA Enterprise**（`ReCaptchaEnterpriseProvider`）の利用が推奨されています。
> Cloudflare公開後、Firebase ConsoleおよびGoogle Cloud ConsoleでreCAPTCHA Enterpriseキーを取得し、アプリ初期化コード（`firebase.ts`）に統合する予定です。

---

## 🔮 今後の開発ロードマップ

- [ ] **カメラによる記番号OCR**: スマートフォンのカメラをかざすだけで記番号を自動読み取り。
- [ ] **紙幣再発見通知**: 自分が登録したお札が他のユーザーに再発見された際のメール/Web Push通知。
- [ ] **マイページ・旅するマイ紙幣一覧**: 自分が過去に登録したお札が現在どこまで旅をしているかの一覧。
- [ ] **全国移動ヒートマップ**: 日本全国でお札がどのように流動しているかのマクロ動態マップ。
- [ ] **ランキング機能**: 最長旅行距離ランキング、最長生存日数ランキング、都道府県別流入・流出統計。
- [ ] **オープンデータ / 研究用途API**: 貨幣流通や地域経済の移動パターンの研究用匿名化オープンデータ提供。
