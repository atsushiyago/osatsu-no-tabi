# 紙幣識別v2 第5-A段階：本番移行準備レビュー

調査日：2026-10-12。既存権限による設定メタデータと静的配信物の読み取りのみ。
**本番Firestore文書の読み書き、export/import、Rules公開、Firebase/Cloudflare設定変更、commit/push/deployは未実施。ソースコードは変更していない。**

## 結論

第1〜第4段階は保持。実装とEmulator検証の準備は完了しているが、**第5-Bの本番変更へはまだ進めない**。
課金が無効で、標準バックアップ/exportの実行条件を満たしていない。バックアップ/復元実証、Cloudflare Builds設定確認、実機確認、停止の判定方法が未完了。

## 1. Git・公開ファイル・保存計画

- ブランチ：`feature/english-i18n`
- HEAD：`f2e5f2681789b3f293a8a02c3f83fe71d9bcb95d`
- GitHub main：`git ls-remote`で同じSHAを確認。
- ローカルmainは`aff47ca`のままで1コミット遅れている。ローカルmainを最新本番と取り違えない。
- 調査開始時：追跡済み変更13ファイル、新規26ファイル（計39）。今回のレポートのみ新規追加。
- 第1〜第4段階の39ファイルはSHA-256 manifestで保全確認。今回は再テストせず、第4段階の結果を参照。
- `firestore.indexes.json`、`firestore.rules`、`package-lock.json`に差分なし。
- `.env`、`.dev.vars`、`firepit-log.txt`、`dist`はGit ignore対象で追跡されていない。

### リポジトリに含める

| 区分 | ファイル |
|---|---|
| 実行コード | 変更したApp/RegisterView/SearchView/i18n/CSS/firebase/types、BillIdentityFields、banknoteVariants、billIdentity/Selection/identityEnvironment/identitySearch、registry/UiService |
| 公開管理用 | `firestore.strict.rules`、`firestore.identity-paused.rules`、`firebase.identity-paused.json`、停止Rules生成script、`.env.example`、`package.json` |
| 検証用（Git保存するが本番実行しない） | `firebase.identity-v2.json`、`test/`内のv2/移行/ブラウザ/OCR/履歴テストとEmulator helper/runner |
| 資料 | emulator/ui/rollout資料、本レポート |

Wranglerは`dist`だけを静的配信する。Rules/テスト/docs/Emulator設定はフロント配信物としてアップロードしない。
通常のFirebase CLI configは`firebase.json → firestore.strict.rules`、停止公開専用は`firebase.identity-paused.json → firestore.identity-paused.rules`。

### 含めない

実環境の`.env`/`.dev.vars`、OAuth/サービスアカウント鍵、App Check debug token、Firebase/Wranglerログ、`dist`/node_modules/キャッシュ、`/tmp`の画面・設定取得用script・生レスポンス、実データbackup/manifest。
公開設定の証跡は本レポートの非秘密メタデータだけにする。

### 将来の保存計画（今回実行しない）

1. 現在の変更を保持したまま`codex/bill-identity-v2`をローカルで作成する。
2. 上表の明示的なファイル一覧をステージし、差分・秘密情報・停止Rules生成物一致を確認。
3. 全依存を揃えた1つの保存コミットを作成。公開前にソース、Rules、テスト、資料を再現可能にする。
4. 公開準備の追加修正は同じブランチで追加コミット。mainへはまだ反映しない。
5. Workers Buildsのproduction/previewのbranchとdeploy commandを確認するまで、保存ブランチもpushしない。previewが本番Firebaseを参照することを避ける。
6. 最終公開時はremote main再確認とfast-forward条件を確認し、停止Rulesの適用確認後にのみmainへ通常push。強制pushは禁止。

保存コミット作成は別途指示が必要。現在は未コミットのまま保持している。

## 2. Firebase：APIで確認済みの設定

設定取得には既存Firebase CLI OAuthをメモリ上で使用。Firestore document endpointは呼んでいない。

| 項目 | 確認結果 |
|---|---|
| Project | `george-69c3a`（ACTIVE） |
| Database | `(default)`、FIRESTORE_NATIVE、`asia-northeast1` |
| 適用Rules | `projects/george-69c3a/rulesets/9ea76148-d5e8-467e-8db9-1fb47c3b358f` |
| Rules最終更新 | 2026-09-27 10:21:42 UTC |
| Rulesソース | `firestore.strict.rules`、494行。HEAD v1とバイト単位で一致 |
| 適用Rules SHA-256 | `b48b4884ae3e8a92bd72d1ab0ee7864aeaa902be15e59f4aaf3d8bb01d198107` |
| ローカルv2候補 | 238行。適用中Rulesとは異なる |
| v2候補 SHA-256 | `8a5dd740cdc10589fff78e7f28b20be91238b7ac576bc70f20f11fa1b709ef68` |
| 停止Rules SHA-256 | `a40203f0345813468f436fa4c856f9f9552dc64e2f0bae5300eb32b2b792117f` |
| App Check / Firestore | ENFORCED |
| App Check / Auth | UNENFORCED |
| Anonymous Auth | 有効 |
| Google provider | 有効（secretを取得しないfield maskで照会） |
| Auth承認済みdomain | localhost、Firebase既定2domain、`osatsu-no-tabi.ayago.workers.dev` |
| 課金 | `billingEnabled=false`。Firebase Consoleのプラン表示自体は未確認 |
| Scheduled backup | 0スケジュール |
| Native backup | 当該DB/locationの一覧0件。手動GCS exportや外部コピーの有無は未確認 |
| PITR | 無効、現在のversion retentionは3600秒 |
| Delete protection | 無効（変更していない） |

### 本番v1とローカルv2の重要な差

- 本番は旧serialIndexの登録とv1紙幣/発見の書き込みを許可する構成。
- 本番にはbillIdentityIndex/billIdentities、登録停止config判定がない。
- v2候補は双方向索引、6文書の整合性、v2属性検証、旧登録拒否、paused判定を加える。
- 公開/owner-only境界と既存UUIDは維持。旧trackedの個人設定だけ更新を許可する。
- **旧Rulesのままconfigをpausedにしても停止しない。最初の停止Rulesを先に適用する必要がある。**

### 権限確認

Projectの`testIamPermissions`（権限照会のみ）で、backup list/get/schedule create/restore、DB export/import/create、Rules release update/ruleset create、projectのbilling assignment createが返った。
これは作成を実施したという意味ではなく、課金条件、Cloud Storage bucket IAM、課金アカウント側の使用権限、条件付きIAM等は別確認が必要。

### 人が確認する画面（今回は保存/有効化しない）

1. Firebase Console → project `george-69c3a` → Project settings：Project ID/現在のプラン、登録Web Appを確認。
2. Firestore → Rules：上記Ruleset/ソースを照合。Publishは押さない。
3. App Check → APIs：Firestore enforcement、Web AppのreCAPTCHA Enterprise登録、対象domain/metricsを確認。Debug tokenは表示・共有しない。
4. Authentication → Sign-in method/Settings：Anonymous/Googleとauthorized domainsを照合。provider secretは開かない。
5. Google Cloud → Firestore Databases → `(default)` → Backups/Disaster recovery、Import/Export履歴：外部backupの有無と利用条件を確認。
6. Billing/IAM：利用するbilling account、操作主体とservice agentの最小権限を確認。変更は別途承認後。

## 3. Cloudflare：確認済みと未確認

| 項目 | 結果 |
|---|---|
| Worker | `osatsu-no-tabi`（設定ファイル/API双方で確認） |
| 現行deployment | `aa13fd9e-938a-4d05-9604-d06058662e8e` |
| 現行version（100%） | `a9449a97-5f81-48f1-a9d4-ba2b7b186a5a`（Version 61） |
| 配信時刻 | 2026-10-12 07:32:09 UTC / 16:32:09 JST |
| 配信source | APIではwrangler。これだけでGitHub連携の有無を判断しない |
| 直前のdeployable version | `c32f7ad4-24bb-4c61-a4bd-37d905c02d55`（Version 60） |
| さらに前 | `34d6955c-bb6c-478c-8c50-6c87b6294676`（Version 59） |
| 現行公開JS | `/assets/index-Qq-pLslv.js`、SHA-256 `2a6a049db0bf3896b2078f9566b16d7680f45c2e4f78fcc34028976fcd42dc46` |
| 公開JSの接続設定 | project `george-69c3a`とauth domainを確認。API key/reCAPTCHA形式のsite keyは存在（値は出力しない） |
| GitHub main連携・Builds変数 | **未確認**。既存OAuthでBuilds triggers/build照会は403、code 10000 |
| 配信VersionとGit SHAの対応 | **未確認**。mainとローカルHEADは一致するが、Version 61との対応は断定できない |

公開HTML/JSはfetchしただけで実行していない。匿名ログイン・Firestore documentの読取を発生させていない。
Version 60/59はdeployable履歴にあるが、v2データ互換性を確認した復旧版ではない。

### 人がCloudflare Dashboardで確認

Workers & Pages → `osatsu-no-tabi` → Settings → Builds：

- 接続repoが `atsushiyago/osatsu-no-tabi`、production branchがmainか。
- build/deploy command、root、production/previewのbranch設定。
- build-time Variables & Secretsに次の名前があるか、Firebase参照先が一致するか（秘密値をコピーしない）。
  - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
  - `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`
- 将来のv2公開では`VITE_BILL_IDENTITY_V2=true`、`VITE_USE_FIREBASE_EMULATORS`はfalse/未設定、App Check debug変数は未設定。
- Firebase deployがbuild hook等に含まれず、Rulesとアプリを別工程にできるか。
- Deployments → Activeと履歴でVersion/Build SHAを照合。復旧時の自動Build再上書きも確認。

[公式Builds設定](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)。
Build-time値はViteの静的JSに固定される。runtime binding設定だけでは切り替わらない。
ソース上Emulator接続はDEVかつ明示flagだけで、本番buildでは無効。
新featureが未設定なら登録停止し、旧登録へfallbackしない。旧キャッシュJSはfeatureを知らないため停止/v2 Rulesで拒否する。

## 4. バックアップ方針（操作は未実施）

### 推奨

**課金・費用承認後、標準のManaged export/importと復元検証を利用する。**
日次Native backupも長期保全として検討する。課金を有効化しない場合、移行は停止し、独自dumpを標準backup同等と見なさず別設計/復元実証を行う。

[Managed export/import公式](https://firebase.google.com/docs/firestore/manage-data/export-import)は課金有効化が前提。
現在`billingEnabled=false`なのでその前提を満たさない。scheduled backupもBlazeが必要。
[Native backup公式](https://firebase.google.com/docs/firestore/backups)。

### 必要な操作と影響：実施前の承認事項

- billing account関連付け/Blaze条件、予算通知、費用上限運用を決める（通知は支出の強制上限ではない）。
- private Cloud Storage bucketを作成/選定。public access prevention、uniform access、復元担当とFirestore service agentだけの権限を確認。
- exportには`roles/datastore.importExportAdmin`等、bucketの読み書きに必要なservice agent権限を確認。
  [IAM公式](https://firebase.google.com/docs/firestore/security/iam)、[service agent/bucket公式](https://firebase.google.com/docs/firestore/manage-data/export-import#service-agent-bucket-permissions)。service-agent用roleを一般ユーザーへ付与しない。
- scheduled backupはbackupSchedulesAdmin、閲覧はbackupsViewer、復元はrestoreAdmin等を用途別に確認。
- ローカルにgcloudはない。将来Google Cloud Console/Cloud Shellを使うか、別途インストールを承認する。

### 費用

exportは文書read、importは文書write、GCS保存/操作/転送、復元先DBの保存/index等が発生する。
Native backupは保存量、restoreはbackup容量に応じる。PITRにも保存費用がある。
文書件数/容量を今回は取得していないため金額は未算定。担当者がasia-northeast1の現行単価と想定量で見積もる。
[Firestore料金](https://firebase.google.com/docs/firestore/pricing)、[Google Cloud単価](https://cloud.google.com/firestore/pricing)。

### 保全範囲・整合性

- 全DB exportを基本とし、publicBills、serialIndex、sightings、**users配下のtrackedBillsを含む全subcollection**、rateLimits、config、存在するv2索引/逆引きも保全。
- collection filterでusersだけを指定するとtrackedBills等が落ち得る。全DB exportを選ぶ。
- UUID/path、Timestamp型、通知/既読、発見順序、距離、所有UIDをmanifestで照合する（manifest自体も非公開）。
- Managed exportにRules/index設定、Auth users/provider link、Cloudflare設定が含まれるとは扱わない。Rules/index/IAM/必要なTTL/config/build状態は別保存。
- Google同期のUID保全にはAuthも重要。本移行でAuthを変更しない。災害復元まで対象にする場合はAuth別backupを別途承認し、実ユーザーAuthをQAへ無断でimportしない。

### 同時点の保存

通常exportは開始時の厳密snapshotではなく、実行中の変更を含み得る。
現在の停止Rulesは登録だけを止め、通知/既読updateを許可する。**登録停止だけでtrackedBillsまで不変になるとは仮定しない。**

推奨する同時点確保は、課金/PITRを事前承認・準備した上で、停止確認後の有効な時刻Tを指定したPITR export。
Tは分単位で、`earliestVersionTime`等の有効範囲を実施直前に確認する。PITRは現在無効なのでこの方式はまだ準備できていない。
[時刻指定export公式](https://firebase.google.com/docs/firestore/use-pitr#export_pitr_data)。

PITRを使わない場合は、backup中だけ個人設定を含む全client writeを拒否する追加の停止Rulesと、管理者writer停止のレビューが必要。
これは現行の停止Rulesとは異なり、今回は実装も公開もしていない。どちらの方式か未決定のままbackupを「整合性確認済み」としない。

### 完了・復元の合格条件

1. operationがdoneかつerrorなし、処理件数/bytesと成果物metadataを記録。
2. private GCS exportの全成果物が存在し、`.overall_export_metadata`と階層を保全。開始できたことだけを成功としない。
3. **隔離した空のQA Firebase/GCP project/database**を用意。最初にclient read/write拒否、アクセスを管理者だけに限定。
4. 復元先を二者確認し、そこでのみimport。元DBへの上書きやproduction接続のpreviewは使わない。
5. 本番と同じindex設定を別適用し、path/UUID/型/履歴/統計/追跡/通知/既読のmanifestを比較。
6. Admin importはRulesをバイパスする。復元先のRulesだけで保護できたと判断せずIAMも確認。
7. 実データの復元先は人手のQAアプリへ公開しない。UI/Google認証用QAはsyntheticデータだけの別環境にする。
8. 復元実証が通ってから本番切替へ進む。元DBへrestoreを試さない。

保存期間案（未確定）：移行前/直後exportを30日、検証用の復元コピーを完了後7日以内に削除。監査・障害対応中は延長承認。
日次Native backupは14〜30日を候補に費用承認する。最終期間は担当者が決定。権限公開/Gitへの保存を禁止する。

## 5. 実機確認の境界

**今回、カメラ・Google popup・実機操作は行っていない。**

| 対象 | 本番writeなしで可能な方法 | 現状 |
|---|---|---|
| 券面/色/F/二千円/日英 | syntheticデータのEmulator/QAで操作 | desktop幅確認済み、実機未確認 |
| OCR | synthetic記番号の撮影/画像入力をQAで行い、候補を手動転記 | 候補転記スタブとparser単体のみ確認済み。実worker/カメラ未確認 |
| モーダル、新規、再発見、曖昧一致 | Emulator/独立QAのfixtureで実際に登録 | Emulator確認済み、実機未確認 |
| 実Google popup | 本番と分離したQA Firebase、QA domain、専用テストGoogle account | 未実施。Auth Emulatorのfake credentialと区別 |
| 既存追跡データ | IAMでread-onlyに制限した監査client、または非公開の隔離復元で比較 | 本番文書未調査 |

### 本番UIを読み取り専用と扱わない

`loadTrackedBillRows`は不足baselineをupdateし、`markTrackedBillSeen`は詳細表示時に既読をupdateする。
Googleログイン後のホーム/一覧でも追跡読み込みが起こり得る。したがって**本番でGoogleログインして一覧/詳細を開くことを、write禁止下の安全な検証手順にしない**。
strictな本番read-only確認には、これらの処理を呼ばないread-only監査client/IAMを用意するか、将来の追加検証計画を承認する。

### Android Emulator実機接続案（今回は未実施）

USB adb reverseで端末のloopbackをMacへ転送する方法なら、現行の127.0.0.1固定guardを維持できる。
Vite5174、Firestore18080、Auth19099をそれぞれ転送し、端末Chromeで`http://127.0.0.1:5174`へアクセスする。
必要なdeveloper/USB設定、adb導入、転送操作は人が別途承認して実施する。production URLは開かず、Emulator表示/demo projectを照合する。
これは実Google OAuth検証にはならない。

### iPhoneと実Google認証

現在の接続先は127.0.0.1固定なので、MacのLAN URLを開くだけでは端末自身のloopbackを参照して失敗する。
iPhoneにAndroidのadb reverseは使えない。
このため、syntheticデータだけの独立したHTTPS QA/Firebase環境を推奨する。QA側だけにprovider、domain、App Checkを設定し、Production変数を流用しない。
代替のDEV専用HTTPS proxy/接続host対応は別途設計・guardテストが必要で、今回はコードを変更していない。
復元実データ用の隔離DBと、実機/UI用QAを分ける。

## 6. 本番切替の時系列（承認後のみ、今回未実施）

| 段階 | 操作 | 成功条件 | 停止条件／復旧 |
|---|---|---|---|
| 1 状態確定 | Git main、Active Worker、実Rules、Build変数、IAM/費用/責任者を記録 | 全対応関係が確定 | SHA/参照先不明なら変更せず中止 |
| 2 先行保全 | 課金/backup方式承認、先行export、隔離復元 | 復元実証・manifest一致 | backup/restore不備なら切替しない |
| 3 登録停止 | 最初に停止Rulesを適用。configだけではv1は止まらない | 所定Rulesetが適用 | 失敗なら旧環境のまま。次段階禁止 |
| 4 停止検証＋最終保全 | 伝播/先行commit収束、T確定、同時点backup、writerの棚卸し | 旧/v2登録拒否が確認できる証拠と最終manifest | 不明/継続writeなら停止継続。誤成功する本番probeは実施しない |
| 5 v2 Rules | 管理者がconfigをpausedにし、v2 Rules公開 | 旧登録拒否・read維持 | 失敗/不整合なら停止Rulesを維持/再適用 |
| 6 v2アプリ | Production build flagをtrue、Emulator/debugはoff、確認済みmain commitを配信 | Build SHA/Version/接続先一致 | pausedを維持しアプリ修正/読取専用復旧版 |
| 7 read確認 | writeを呼ばない監査client＋実機QA結果で確認 | UUID/履歴/統計/追跡照合、Auth/domain確認 | 差異があればpausedを維持し調査 |
| 8 再開 | 最終承認後にconfig `mode:v2, identityVersion:2` | 正式再開、旧clientは引き続き拒否 | 異常なら即paused、必要なら停止Rules |
| 9 実利用観測 | テストデータを作らず、承認されたreadで実利用の原子的整合を観測 | 新規6文書・再発見UUID・旧履歴不変 | 誤統合/不整合/Auth・Rules障害で再停止 |
| 10 復旧 | paused/停止Rules、障害後backup、v2互換読取専用アプリへ復旧 | v2データを保全し閲覧維持 | unsafeな旧Rules/元backup全面上書きは行わない |

Rules変更には伝播とin-flight commitがある。CLI成功/経過時間だけで全端末の停止を断定しない。
停止確認は適用Rules照合・運用logs/書き込み収束と、Emulatorで検証済みの旧経路拒否を組み合わせる。
現行loggingで十分な証拠が取れるか未確認で、責任者が方法/判定時間/記録を決める必要がある。

最終backupを変更前に厳密に取りたい場合はPITR等の同時点方式が必要。そうでなければ停止収束後の最終保全を必須にし、先行backupのみで再開しない。

復旧ではconfigをpausedにし、必要なら停止Rulesを適用する。v2のreadを維持する復旧版はfeatureをtrueにしてpausedを維持する。
Version 60へのWorkers rollbackだけでは旧検索の限界があり、安全な復旧完了とはしない。旧Rulesを戻すとserialだけの誤統合経路が再開するため禁止。
新版の配信rollbackとFirestore data/Rules rollbackは別の操作で、無断のimportで新v2記録を失わせない。

## 7. 第5-Bへ進むための必須ゲート

- [ ] Cloudflare production/preview branch・build/deploy command・必要変数・現行VersionとGit SHAを人が照合
- [ ] billing/費用/backup bucket・service agent/復元先と保存期間を承認
- [ ] 同時点backup方式を決定（PITR準備または追加の全write停止設計）
- [ ] 先行backup/隔離復元とmanifest比較を完了
- [ ] 停止確認方法・管理者writer停止・変更/再開/復旧の責任者を確定
- [ ] iPhone/Androidと実Google popup、camera/OCR workerをQAで確認
- [ ] ローカル保存commit、最新の全テスト、公開ファイルとsecret検査を完了

**現在はゲート未完了。第5-Bの本番操作は保留する。**
今回確認できなかった項目はConsoleの人手確認／別途承認された準備作業で解消する。
