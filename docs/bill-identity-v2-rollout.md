# 紙幣識別v2：第4段階 総合検証・公開手順書

**未公開・未実行の本番操作手順。今回、本番Firestore・Firebase Console・Cloudflareの設定にはアクセス／変更していない。commit/push/deployなし。**
第2・第3段階の資料は当時の記録。本書の機能フラグ分離が第3段階のDEV限定方式を置き換える。

## 1. 接続・機能・書き込み許可の分離

| 条件 | 意味 |
|---|---|
| DEVかつ `VITE_USE_FIREBASE_EMULATORS=true` | demo専用App、Auth19099/Firestore18080、App Checkを初期化しない |
| `VITE_BILL_IDENTITY_V2=true` | v2登録・複数候補検索UIを利用（DEV/PRODから独立） |
| 上記featureが未設定/false/不正値 | 新アプリの登録を停止。旧登録処理へフォールバックしない |
| `appConfig/billRegistration` が `{mode:'v2',identityVersion:2}` | v2トランザクションとRulesが登録を許可する必要条件 |
| configなし/paused/不整合 | v2登録拒否。読み取りは維持 |
| 停止用Rules | configをv2にしてしまっても全登録経路を拒否 |

本番では既存の `VITE_FIREBASE_*` とApp Check設定を使う。Emulator設定は本番ビルドで無効。
`npm run dev:identity` は両フラグを明示してdemoプロジェクトを使う。v2の通常接続サービスも同じトランザクションを使用するが、今回実行したのはEmulatorのみ。
停止の最終責任はRulesにある。キャッシュ済み旧JavaScriptはフラグを理解しないため、フロント更新だけでは遮断できない。

## 2. レビュー結果・修正

- 第3段階はv2 UIとEmulator接続が同じフラグだった。分離し、本番用v2サービスを同一トランザクションで利用できるようにした。
- 新アプリの登録画面から旧 `registerBillSighting` 呼び出しを除去。機能フラグなしでは登録ボタン／submitとも停止。
- Emulator専用サービスのガードは残した。共通コアは同じFirebase AppのAuth/Firestoreを要求し、UI接続チェックはdemo/通常接続の混在を拒否する。
- 公開メモの旧検査は大文字記番号のみだった。サービスでNFKC/大文字/空白・ハイフン除去後に拒否、Rulesで小文字・全角・区切り・改行を含む既知形式も拒否する。
- 本書用の停止Rulesをv2候補から機械生成。生成箇所が変わるとエラーで停止し、無言の不完全生成を避ける。
- 新旧索引は共存。v2双方向1対1、逆引き非公開、不変索引、6文書の原子的作成は維持。
- 旧記録へ識別属性を付与せず、曖昧一致時は独立登録の確認だけを行う。acknowledgementは本人性証明ではない。
- 登録→詳細、検索→登録のURLは記番号を含まない。詳細／共有URLはUUIDだけ。
- 索引自体は記番号を含む非公開データであり、認証済み完全一致getが可能。Firestore通信内の索引パスまで無記番号になるとは主張しない。
- メモの意図的な難読化をすべて検出する保証はない。今回の検査は既知の通常入力形式を対象とする。

## 3. Emulator移行リハーサル

`test/identity-rollout.test.js`、project `demo-osatsu-identity-rollout`、ループバックのみ。

1. ローカルの既存安定コミット `f2e5f26` のv1 Rulesをロードし、v1クライアント相当の5文書登録を実際に成功させる。
2. publicBill、sighting、tracked、旧索引を保存して比較。Google Emulator credentialを匿名UIDにリンクし、別クライアントで同UIDへログイン。
3. 停止Rulesをロード。configがv2でもpausedでもv1/v2新規・v1再発見を拒否。
4. 意図的なRules構文エラーの更新失敗後も、直前の停止Rulesで登録拒否が続くことを確認。
5. paused configを保存してv2 Rulesへ変更。旧索引・公開履歴・Google同期済み追跡の読み取りと統計を確認。
6. configをv2へ変更。旧一致の確認待ちでは書き込みなし、確認後の新UUIDは旧4文書を変更しない。
7. 完全一致の再発見で新UUIDを維持。異なる額面・券種・色の同番号を別UIDから同時登録し3UUIDになることを確認。
8. 同じ旧クライアントのSDKインスタンスを維持したまま新規・旧/v2紙幣の旧方式再発見を拒否。
9. pausedへ戻し、6文書の非空部分集合63通りをすべて拒否。通知・既読の許可フィールドだけ更新できる。
10. 停止Rulesへ戻して閲覧・履歴・統計・Google UIDと設定維持、v1/v2登録拒否を確認。

これは**キャッシュ済み旧クライアントのFirestore操作契約**の検証で、旧配信HTML全体や実ネットワークのRules伝播を再現したものではない。
管理者SDKはRulesをバイパスする。移行作業中の管理者書き込み・バッチ・外部自動処理も別途棚卸しして停止する必要がある。

## 4. 保全・セキュリティ

旧UUID、旧sighting全フィールド、旧tracked全フィールド、旧索引を変更前後でdeepEqual比較。
通知・既読の明示的な更新後は、識別・所有・作成・初回登録属性を個別比較。
Google匿名昇格のUIDと別クライアントログインUIDは同一。公開統計の停止・復旧前後、地図用地域／履歴も比較する。

第2段階の152整合性テスト、56strictシナリオ、参照回数13件は維持。
参照回数の論理上限は初回15、再発見11/12、単操作最大4。今回のメモ検査／機能分離は参照回数を増やさない。
Emulatorのキャッシュ込み初回3回という実測に安全性を依存しない。
[Firebase公式の参照回数制限](https://firebase.google.com/docs/firestore/security/rules-structure)。

旧MVPテストは `firestore.rules`、旧rate-limitテストは追加時の `c0d492b:firestore.strict.rules` で独立実行する。
後者は現在のv1 Rulesでも既に不整合（`bills`読取拒否、rate未作成→TypeError）であり、旧仕様の成功をv2の互換性成功とは数えない。
元の期待値を緩めていない。全スイート再現には上記Git履歴が必要。

## 5. 公開前：成功条件と中止条件

以下は第5段階で、人が対象を確認して実施する。本書中のコマンドは今回実行していない。

### A. 現状特定・バックアップ

- Firebaseプロジェクト／DB、**実際に適用中**のRulesソースとバージョン／ハッシュ、indexを取得・保存。ローカルHEADを適用済みRulesと同一だと仮定しない。
- Cloudflare WorkersのActive DeploymentとVersion ID、GitHub main SHA、ビルド環境変数の名前・参照プロジェクトを記録。APIキーやトークンをログへ出さない。
- 本番Firestore全体を管理者権限でバックアップ。publicBills/sightings/serialIndex/users配下/率制限/configを含め、アクセスを制限した暗号化バケット等に保管。
- 複数コレクションのexportを無条件に同時点スナップショットと扱わない。先行バックアップ後、停止が確認できた時点で最終バックアップ／整合性確認をやり直す。
- 別の隔離環境で復元手順・旧UUIDから索引／履歴／tracked参照が辿れることを確認。実データを公開用Emulatorへ持ち込まない。
- 保全対象全UUID・各sighting・trackedの識別属性／通知／既読／Google UID、件数・発見回数合計・距離合計等のmanifestをアクセス制限下で作る。記番号を公開レポートに掲載しない。
- 既存孤立文書、壊れた索引、想定外schemaや管理者書き込み経路が見つかれば中止。削除・自動補完で解消しない。

将来の読み取り用コマンド例：

```sh
npx wrangler deployments list --name osatsu-no-tabi
npx wrangler versions list --name osatsu-no-tabi
# <PROJECT_ID>/<BACKUP_URI>は人が照合したもののみ使用
# gcloud firestore export <BACKUP_URI> --project=<PROJECT_ID>
```

**成功条件**：バックアップ／復元手順と実際の配信Version/Rules/参照先が確定。
**中止条件**：どれか不明、対象違い、復元不可、想定外のデータ構造。

### B. 最初の停止バリア

- `node scripts/identity-paused-rules.mjs` で停止用Rulesを生成、差分・ハッシュ・Emulator全テストを再確認。
- まず停止Rulesだけを適用する。旧Rulesにconfigの停止判定がない場合、先にconfigをpausedにしても旧クライアントは止まらない。
- 将来のコマンド例（明示的にproject指定）：

```sh
firebase deploy --only firestore:rules --config firebase.identity-paused.json --project <PROJECT_ID>
```

- 実際の適用済みRulesが停止版であることを確認する。登録停止の開始はコマンド実行時刻ではなく、拒否確認・伝播・先行書き込み収束後。
- [Firebase公式](https://firebase.google.com/docs/firestore/security/get-started)は新規query/listenerへの反映に最大1分、既存listenerには最大10分と記載している。これはwriteの厳密な伝播保証ではないため、CLI成功／時間経過だけでは完了としない。
- 停止前に開始したコミットや伝播中のv1書き込みが残り得る。v2を開始せず、収束後に最終manifest／バックアップを採り直す。
- 本番への書き込みプローブは既存データを使って行わない。将来別途承認された専用の安全な負例プローブまたは運用ログ・適用済みRules照合を使う。今回、本番プローブは実行していない。

**成功条件**：全旧登録経路が停止し、未確定コミットが収束、最終保全基準が確定。
**中止条件**：停止Rules失敗／伝播不明／書き込み継続。この状態で次段階へ進まない。
初回停止Rulesが適用される前の失敗まで即時停止できる保証はない。

### C. paused config → v2 Rules → 新アプリ

- 管理者が対象Firebaseプロジェクトの `appConfig/billRegistration` を `mode:'paused', identityVersion:2` にする（clientの書き込みは禁止）。
- v2 Rulesを適用する。

```sh
firebase deploy --only firestore:rules --config firebase.json --project <PROJECT_ID>
```

- 読み取りを確認し、旧登録が拒否されることを確認。Rules適用失敗なら停止Rulesを維持して中止。
- Cloudflare Productionビルドに `VITE_BILL_IDENTITY_V2=true`、Emulatorフラグはfalse/未設定、既存本番Firebase/App Checkを設定。
- 対象コミットだけをGitHub mainへ通常pushしてWorkers Buildsに配信させる。強制push／無関係差分は含めない。本書作成時は未コミットなので、公開対象SHAは未確定。
- 実際のビルドSHA／Version、HTML・JS、日英、読み取り、旧UUID、地図、Google同期を確認。
- ビルド変数はViteのビルド時に固定される。Cloudflareランタイムの変数変更だけでは既存静的JSは切り替わらない。

**成功条件**：v2 UI／検索を配信、pausedで書き込み拒否、旧データの閲覧とGoogle同期を確認。
**中止条件**：ビルド失敗／誤Firebase参照／Emulator接続／旧方式にフォールバック／読み取り破壊。

### D. v2再開

- 実機確認と保全・遮断のレビューを通過した場合だけ、管理者が `mode:'v2', identityVersion:2` に変更する。
- 新規6文書の対応、再発見UUID、旧記録未変更、公開情報に記番号なし、通知・既読、エラー率、quota・費用を観測。
- 本番での検証用データ作成は禁止のまま。新規/再発見の運用確認は実際の利用記録を承認された読み取りで確認するか、別途承認を得た実施計画に従う。
- キャッシュされた旧JSを消せたことを条件にせず、v2 Rulesの旧経路拒否を維持。

**成功条件**：新旧の整合性と主要機能が維持され、異常なし。
**中止条件**：誤統合、UUID変更、旧履歴更新、秘密情報公開、索引不一致、Rules拒否増加、認証失敗増加。

## 6. 問題時の停止・復旧

1. 管理者がconfigをpausedへ。client config変更は不可能。
2. 必要なら停止Rulesを再適用して、config依存なしの拒否にする。反映・先行コミット収束を確認する。
3. 新しいv2記録を含む保全バックアップ／manifestを取得。既存v1バックアップを本番へ全面上書きしない。
4. 閲覧を維持する互換性ある安定版へWorkersを戻す。旧版検索は新索引を知らず、二千円対応も未確認なので、v2互換の読取専用復旧版を優先。
5. [Cloudflare公式のrollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)に従い、事前記録したVersionを指定する。自動Buildが再上書きしないようGitHub連携も確認する。

将来の例：`npx wrangler rollback <VERIFIED_VERSION_ID> --name osatsu-no-tabi`

旧Rulesへ単純に戻すと、キャッシュ済み旧クライアントがserialだけで登録／再発見し、v2の色別・券種別記録と共存して誤統合する危険がある。**UIを戻してもv2/停止Rulesは戻さない。**
停止中はownerの通知／既読更新だけ許可し、新規履歴や識別情報は不変。復旧版はfeatureをtrueのままpausedにし、v2検索を維持する。feature OFFや古い安定版のserialIndex検索だけでは新v2記録を検索できない。
原因修正→Emulator全テスト→pausedのままアプリ／Rules再配信→読取・保全照合→明示的承認後再開。
安全な停止・保全が確認できない場合、自己判断で復旧書き込み・削除・移行をしない。

## 7. 未確認・判断が必要

- 実際に適用中の本番Rules、全実データのmanifest、Cloudflare Active Version/ビルド設定、バックアップ復元は未確認（今回禁止対象／未アクセス）。
- 実機iPhone/Androidのカメラ・OCR、Google OAuth popup、通常/シークレット・Braveの認証は未確認。
- Emulator Google credentialでのリンク／別端末相当ログインは実Google OAuth検証ではない。
- Rulesは入力された4情報の一致を保証するが、利用者が正しい券面／色を選んだこと、物理紙幣の真贋・同一性まで保証しない。
- 過去にv1で誤統合済みだった履歴を自動修復しない。
- 第一停止バリアの本番伝播と安全な拒否確認方法、管理者処理停止の責任者・再開承認者は第5段階前に確定する。

**現時点では本番公開可とは判定しない。第5段階の準備レビューには進めるが、上記運用／実機の必須ゲートを解消してから実際の移行を承認する。**

## 8. 最終検証結果（2026-10-12）

| 検証 | 結果 |
|---|---:|
| 単体（既存114＋フラグ／接続境界1） | 115成功 |
| 現行strictシナリオ | 56成功 |
| v2整合性 | 152成功 |
| Rules参照上限 | 13成功 |
| 移行リハーサル（親test含む） | 11成功 |
| 歴史的MVP Rules契約（現行v2の成功件数に含めない） | 45成功 |
| 歴史的rate-limit Rules契約（c0d492b時点） | 20成功 |
| 停止用ファイルとテスト対象生成物の一致・リハーサル再実行 | 11成功 |
| 日英320/375/390/430/1280px | 10組合せ成功 |
| OCR候補転記（認識結果スタブ）日英320/375/390/430px | 8組合せ成功 |
| feature OFFのボタン／synthetic submit | 書き込み0 |
| typecheck、lint、feature OFF/ONのproduction build、diff check | 成功 |

lint既存警告2件、500KB超チャンク警告は残る。通常表示の横スクロール／新規identity項目の文字欠けは検出なし。
狭幅の詳細履歴等には既存の複数行折り返しがある。OCRデバッグUIの日本語は既存仕様として変更せず、通常公開画面への露出は増やしていない。

画面126枚と結果: `/tmp/osatsu-v4-ui/results.json`。
OCR転記8枚と結果: `/tmp/osatsu-v4-ocr-ui/results.json`。
認識をスタブしたOCR検証は画像選択→切り抜き→候補表示→手動転記→F券選択までで、実認識worker／カメラの成功ではない。
Google連携済み表示はAuth Emulatorの偽credentialでリンク後に再読み込みして検証。
Googleの実popup／実機認証を確認済みとはしていない。
全ブラウザテストは本番Firebase宛てを遮断し、試行0を確認。

初回の補助テスト失敗は、旧rate-limitテストと現在のRulesの不整合、テスト用同一Googleメールの再利用、テスト初期化が手動言語選択を上書きしたことによる。
期待値を緩和せず、対応Rulesの分離／一意ダミーメール／初回だけの言語初期化で再現環境を修正し再実行した。
公開コードのAuthや言語管理はそのために変更していない。

### 第4段階の変更ファイル

- `.env.example`, `package.json`
- `src/utils/identityEnvironment.ts`
- `src/services/firebase.ts`, `src/services/billIdentityRegistry.ts`, `src/services/billIdentityUiService.ts`
- `src/components/RegisterView.tsx`, `src/components/SearchView.tsx`, `src/i18n.ts`
- `firestore.strict.rules`（公開メモ検査の追加のみ）
- `firestore.identity-paused.rules`, `firebase.identity-paused.json`, `scripts/identity-paused-rules.mjs`
- `test/identity-ui.test.js`, `test/identity-rollout.test.js`, `test/identity-ui.browser.mjs`
- `test/identity-ocr.browser.mjs`, `test/identity-feature-off.browser.mjs`
- `test/run-identity-emulators.mjs`, `test/run-historical-rules.mjs`
- `test/rules.test.js`, `test/strict-rules.test.js`（接続先をループバック環境変数で指定可能にしただけ。期待値は不変）
- `docs/bill-identity-v2-ui.md`（第4段階への案内）, `docs/bill-identity-v2-rollout.md`

第1〜第3段階の他の未コミット変更は保持。本番Rules/index/schema/データへの反映なし。
