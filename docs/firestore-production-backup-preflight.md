> 更新：本番読み取り専用コマンドと本番source→Emulator復元をローカル実装済み。現在の操作手順は [実行手順書](firestore-production-backup-runbook.md) を参照。以下の未実装記述は実装前の記録です。本番実行・実接続は未確認／未承認です。

# Spark維持：一度だけの本番read-onlyバックアップ実施前レビュー

2026-10-12。今回はローカル成果物の確認・Git保存と設計のみ。
**本番Firebase/Cloudflareへの接続、Auth取得、Firestore read/write、Rules変更、認証設定、export、push、deployは実施していない。Spark→Blazeの変更は不要かつ対象外。**

## 1. 判定と実装境界

現行Emulatorツールは合成21文書の完全復元を検証済み。バックアップ実装・テスト・手順書はローカル保存できる。
ただし**現時点では本番バックアップの実行準備完了とはしない**。次の不足がある。

- `assertEmulator` / `scan` / `capture` はdemo project+loopback以外を拒否。本番read-onlyコマンドはまだない。
- `validate` はバックアップのsource projectもdemo限定。本番source projectのファイルは、空のdemo Emulatorを指定しても現行restoreで拒否する。
- 本番の実効IAM、全書込み停止、当日の無料枠残量／文書数／列挙RPC量／データサイズは今回未確認。

既存ガードを外して実行してはいけない。本書は次のローカル開発と人手承認に向けた仕様。本番用実行コマンドは未実装のため提示しない。
既存v2コード・Rules・UIは変更しない。Authenticationの取得・復元機能も追加しない。

## 2. 認証：実行主体を本番read-only identityに固定

推奨：専用サービスアカウントに本番Firestore読取り権限だけを付与し、鍵なしの短期impersonationまたは既存WIFを利用する。
候補の `roles/datastore.viewer` はFirestore/Datastore読取り用。`datastore.entities.get/list` とDB metadata等の必要権限を確認する。[公式IAM権限](https://docs.cloud.google.com/iam/docs/roles-permissions/firestore)。
独自最小roleを使う場合、listCollections/listDocuments/showMissing/BatchGetに対応する権限をEmulatorだけで検証したとは扱わない。本番を読む前にIAM管理者がレビューする。

サービスアカウントはproject/folder/organizationで継承したOwner/Editor/Firebase Admin/Datastore User等のwrite権限も持たないこと。特定roleを1つ追加しただけではread-onlyにならない。
IAM policy（継承・条件・group・deny含む）、Policy Analyzer/Troubleshooter、read/get/list権限とentities.create/update/delete等の `testIamPermissions` を組み合わせて実効権限を確認する。negative書込みによる確認は行わない。少数の権限照会だけでは未知の権限不在を証明できないため、全bindingも確認する。
Auth管理、Rules公開、index変更、import/export/restore、IAM変更権限を実行主体に与えない。

人間のアカウントは短期token発行だけに使い、データ読取りのHTTP/gRPC要求は必ず専用SAのtokenで行う。
[公式impersonation資料](https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation)はNode.jsのimpersonated local ADCに対応する。一方、今回のSDK構成と実際のIAMでは未検証。鍵なし方式に必要なAPI/policy/権限の確認・設定は将来別途承認が必要。
サービスアカウント鍵JSONを新設しない。既存の管理者ADCやFirebase CLI OAuthをデータ取得用に流用しない。

将来のread-onlyコマンドは、明示的なimpersonation構成（またはWIF構成）と対象SAの一致を要求し、通常user ADC/metadata serverへのfallback、別identityへのretry、鍵fileを拒否する。
source credentialやADCにも更新token等の機微情報があり得る。repo外のprivate directoryに短期間だけ保管し、内容をログに出さず、終了時に削除／失効する。IAM確認の管理者操作とバックアップ読取りプロセスの資格情報を分離する。
OAuth scopeだけの制限をread-onlyの証拠にしない。最終境界は実行SAのIAM。

## 3. 誤実行防止と保存先・鍵

過去のローカルpreflightに記録された本番projectは `george-69c3a`。**今回は再確認していない**。実行当日に人がFirebase Consoleとアプリ設定を照合し、project ID、project number、default DB、regionを承認する。

後続の本番read-onlyコマンド仕様:

- backup専用実行ファイル。restore/write APIを呼ぶ経路を持たせない。
- `--project`、`--database '(default)'`、`--expected-service-account`、`--approval-file`、`--output`、`--max-read-units`、`--max-bytes` を必須。デフォルトprojectなし。
- 手動承認済みの単一project allowlistと引数を二重照合。承認fileに実行日時範囲、project/DB、SA、読取り予算、保存先、停止記録、承認者を記載。秘密情報は入れない。
- `FIRESTORE_EMULATOR_HOST` や実際のendpointとの不整合、未指定値、予算不足、未知のsource DB/identityは開始前に停止。
- 選択したproject/DBへ固定、同一DB referenceだけを保存。project/DBを環境から推測しない。
- get/list以外の操作を実装しない。IAMでもwriteを拒否するため、コードのミスだけで書込みできない。
- 各RPC/ページ/再試行の読取り予算と最大ファイル／メモリ量を管理。期限切れやquota/permission/networkエラーは未完成扱い。無制限retryなし。
- 個人データやパスを含むSDK debug/gRPC trace、HTTP body/tokenログを無効にし、固定エラー分類・件数・予算だけ出力。
- 出力はrepo外、FileVault有効なローカルprivate dir（0700）、file0600、シンボリックリンク拒否、上書き禁止、クラウド同期／共有なし。
- 強い乱数パスフレーズをKeychain/承認済みpassword managerに保存。CLI引数・環境・shell履歴に値を書かない。復号鍵とバックアップ媒体を別管理。
- 今のpassphrase file方式を利用する場合はprivate dir内0600で一時作成し、使用後削除。メモリコピーとAPFS/SSDでの完全消去を保証しない。暗号化と鍵管理を中心にする。
- AES-GCM認証、doc SHA、manifest SHA、保存後再復号を必須。manifestにも記番号/UID等のパス情報があるため平文sidecarを作らない。
- 暗号化したコピーを別の暗号化媒体へ保存し、両コピーの検証と保持期限・責任者・鍵紛失時の扱いを記録。

## 4. 書込み停止と収束の成功条件

本番v1 Rulesはconfigだけのpausedでは止まらない。v2のpaused/停止Rulesでもownerの既読・通知更新は許可される。登録停止と「全データを静止させる停止」は区別する。

将来の作業（今回は実施しない）:

1. 全writerを棚卸し：ブラウザv1/v2、既読baseline、通知設定、Google切替後のmetadata更新、管理者SDK、CLI/batch、Console編集、外部job/TTL等。
2. 全クライアントwriteを拒否する一時Rulesを別途作成・Emulator検証する。読み取りと既存データは維持。移行再開用Rulesとhashを別保存する。
3. Admin SDKはRulesをバイパスする。writer jobを停止し、書込IAMを持つ管理者・SAの利用停止を運用で保証する。必要なIAM変更は別承認。RulesだけでAdmin停止とは判断しない。[公式](https://firebase.google.com/docs/firestore/security/rules-conditions#authentication)。
4. 実際の適用済みRulesの内容/hashを確認。CLI成功や待ち時間だけで停止完了とはしない。
5. 利用可能なFirestore write指標／監査ログ（未有効ならその欠落も記録）、job終了、管理者の作業停止確認、伝播・先行commitの収束を確認。メトリクス遅延やログ網羅性を考慮する。queue/offline pending writeは停止Rulesで拒否される必要がある。
6. 全writer停止の証跡を得てから2回走査する。docデータに加えて将来のscanではupdateTime等も検証メタデータとして比較し、同じ値への更新も検出する。manifestのcontentとdoc集合が一致し、観測期間にwriteがないことを確認。
7. 変化／監査欠落／停止不明／permissionエラーがあれば成功としない。データを修正して一致させない。自動再試行で無料枠を使い切らない。

2走査は snapshot isolation ではなく、更新→元に戻る等を見逃し得る。ログにwriteが見えないだけでも不十分。**全writer停止と収束の保証が得られなければ「完全な移行直前バックアップ」とは判定しない。**
一時Rules/IAM停止の追加承認が得られない場合、その点は実行阻害要因として残す。今回はRules候補も変更していない。

## 5. Spark無料枠の見積もり

Standard(default) DBの無料readは50,000/日。無料枠の日境界はPacific timeで、Firestore使用状況表示には遅延があり得る。送信量等も制限がある。[公式quota](https://firebase.google.com/docs/firestore/quotas)、[公式課金](https://cloud.google.com/firestore/pricing)。Blaze移行、managed export/backupの利用は提案しない。

現行scanはdocument.getだけでなく、collection.listDocuments（showMissing、field mask）と各ref.listCollectionsも使う。**2Nだけで見積もってはいけない。** collection ID list等の文書取得以外の要求にもread課金がある。field maskを空にしてもゼロ課金とは仮定しない。

- N = 実在文書数（全root/subcollection）
- M = サブコレクションに到達するために列挙される欠落親数
- L = 1走査分のlistDocumentsの予算（返された文書／missing、空結果、ページを含め保守的に評価）
- C = 1走査分のlistCollectionIdsの全RPCページ数。rootと全N+M refの呼出しを含む
- E = 件数調査・権限確認後の試験read等の予算
- T = retry／確認read等の上限予算
- U = 当日使用済みread、B = バックアップ中の利用者readの上限、H = 表示遅延／予想外利用等の余裕

保守的な実行計画: `R = 2 * ((N + M) + L + C) + E + T`。
必要条件: `U + B + R + H < 50,000`、送信量残枠／ディスク／メモリも十分。
Lの厳密な本番課金とページ挙動は未実測のため、上式だけで無料枠内を証明しない。EmulatorのRPC計数を追加して、実DB規模に合わせて上限化する必要がある。
例えばN=2,000、M=100、L=2,200、C=2,101を仮定すると2走査は12,802read（E/T/U/B/H別）。これは実データの推定値ではない。N=8,000等では列挙コスト次第で無料枠を超える可能性がある。

件数推定の取得順:

1. 人が既存の非機微な運用件数記録／過去manifest／ConsoleのUsageと現行schemaを確認（無料枠残量だけではNは分からない）。
2. 記録がなければ、別承認のread-only事前調査を予算付きで行う。rootのknown collectionのcount、trackedBillsはcollection-group count、旧bills等も含める。aggregation自体にも課金があり、countだけでは欠落親Mや未知のsubcollectionを証明できない。
3. 未知のコレクション／M／ページ数の見積もりには結局再帰列挙が必要。事前調査のreadをEに含め、二重列挙の費用を省略しない。巨大DBを無料枠内と仮定して探査しない。
4. 1日分の余裕ある上限で実行できなければ中止。日をまたいだ走査は長期の全停止と整合性設計が必要で、一度の安全な短時間バックアップとして安易に分割しない。

**今回は本番read禁止のためN/M/Uを取得しておらず、Spark無料枠内で実施可能かは未確定。** 残枠と上限見積もりを人が承認するまで実行しない。

## 6. 本番由来ファイルをEmulatorへ復元する手順（後続開発後）

不足するローカル変更の仕様:

- backup形式のsource metadataとして明示許可した本番projectを検証できるようにする。metadataは書込み先ではない。
- targetは現行のdemo+明示loopback+default+空DBガードを維持。source projectを使ったFirebase App作成を禁止。
- Referenceはsourceの同一DBパスを保持し、復元時にtarget DBの同パスへ再結合。source/targetの混同、cross-DBを拒否。
- 本番由来合成fixture（実データなし）で、source=george-69c3a／target=demo-restoredの成功、本番target／不明source／破損／不一致／非空targetの拒否をEmulatorでテスト。
- 文書データはmanifestどおり、createTime/updateTimeのサーバーメタデータは証跡のみで復元不可と明記する。

実施手順:

1. 本番バックアップと別媒体コピーをverifyし、version/GCM/SHA/manifest総数・各collection数を確認する。平文には書き出さない。
2. 共有LANに公開しない専用ローカルEmulatorを起動。demoの空DBを選び、他開発者／アプリを切断する。Emulatorログも機微情報扱い、repo外private dirに置く。
3. 承認済みsource allowlistを指定し、**常にdemo target**へ200件create batchで復元する。Admin経由の復元はRulesを回避するためtarget保護は接続ガードに依存。
4. 全再帰走査を行い、全doc path、型、全値、SHA、collection集合・件数がbackupと一致することを確認。UUID/索引/発見履歴/owner tracking/既読/通知の関係も検査。Unknown legacyの券種・色を推測補完しない。
5. read-only Web SDKで公開一覧・履歴・地図用データ・owner-only／逆引き拒否を確認。通常の画面閲覧は既読を更新し得るため全件比較完了前に起動しない。実データを使って登録やowner個人設定を変更しない。
6. 失敗した部分復元は成功扱いにせず、元backupを保護して隔離DBを破棄・別空demoで再試行。自動削除や本番復元は行わない。
7. 結果は非機微な件数／チェックサム／成功判定のみ記録。作業後、ローカル実データ・Emulatorログ・private temporary filesを管理手順で削除。Gitへ追加しない。

現行コマンドに本番source fileを渡しても手順3は実行できない。対応実装・合成テストが完了してからこの手順を承認する。

## 7. Authenticationの注意点（機能追加なし）

Firestore backupだけではAuth UID/provider link/セッション/認証設定は保存されない。今回は本番Auth取得・復元を追加しない。
同じ本番projectを維持し、Authユーザーの削除・再作成・provider変更をしないことがv2移行の前提。Firestoreのowner UIDは変換しない。
本番Authを失う災害まで復旧可能なbackupとは呼ばない。Googleユーザーの再認証、匿名ユーザーのセッション喪失・別端末でのUID復旧不能が残る。[Auth保全の設計](firestore-local-backup.md#authenticationの追加保全設計のみ)を別途レビューする。

## 8. 実行前の人手承認票

以下が1つでも未確認なら本番backupへ進まない。

- [ ] Spark維持、今回の対象は一度のread-only取得のみである
- [ ] 本番project ID/number、default DB、region、source allowlistを照合
- [ ] 本番read-onlyコマンドと本番source→demo restore対応をローカル実装／合成テスト済み
- [ ] 専用SAの継承含む実効IAMはget/listのみ。write/admin/export/import/restore権限なし
- [ ] 鍵なし認証と対象SAを確認、fallbackなし、token/ADCの保管・失効方法を承認
- [ ] 全writer棚卸し、全クライアントwrite停止Rules、Admin job/Console停止、収束の証跡を確認
- [ ] N/M/L/C/E/T/U/B/Hの上限計画を確認し、50,000read/日と送信量の残枠内
- [ ] 最大サイズ/メモリ/実行期限を確認、quota/変化/ネットワーク失敗時の中止条件を承認
- [ ] FileVault/private出力dir0700、暗号化file0600、十分な容量、別媒体コピー、保持期限を確認
- [ ] 強い鍵を別管理、秘密値を引数/ログ/Gitに残さない
- [ ] 復元先はローカル空demo限定、実データ/ログのアクセス制限・削除方法を確認
- [ ] Auth未保全という範囲を理解し、既存UID/providerを変更しない
- [ ] 依存関係の既存high警告について、本番機微データ取扱い前に評価／対策済み
- [ ] 操作者と承認者、停止開始/解除条件、失敗時の担当者を記録

この承認票は実際の権限や停止の代わりではない。設定・実装・観測と一致することを確認して初めて有効。
