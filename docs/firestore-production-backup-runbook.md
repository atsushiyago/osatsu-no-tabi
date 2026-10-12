# 本番読み取り専用バックアップ：実行手順（別途承認後のみ）

## 実装と今回の検証範囲

本番専用コマンドは `npm run backup:production -- ...`。今回、本番接続・gcloud認証実行・IAM設定・Firestore取得は一切していない。
GETと列挙POST（listCollectionIds/testIamPermissions）だけを使い、Firestore commit/batchWrite/patch/delete/import/exportは実装しない。既存Admin SDKの型付き保存形式/AES-GCMを共用し、REST値を同形式へ変換する。
通常ADC/鍵/metadata認証は使わない。gcloudの**明示したSAへのimpersonation**で短期tokenをメモリ取得。失敗時に別identityを使わない。[公式コマンド](https://docs.cloud.google.com/sdk/gcloud/reference/auth/print-access-token)。userinfo.email scopeでtokeninfoのemailと承認済みSAを照合。[公式token仕様](https://cloud.google.com/docs/authentication/token-types)。tokeninfoはTLSのquery parameterを使うため、URLを記録するproxy/debug/traceを使わない。token値をCLI引数やログには表示しない。gcloud source credentialを新規設定していない。

DB/project metadataと番号/region/type、get/list権限の存在、代表的write/admin権限の不在を確認してから列挙開始。
**選択したtestIamPermissionsだけでは全IAMを証明できない。** 継承・条件・group含むbindingの人手レビュー証跡を必須とし、effectiveIamReadOnly=trueを承認fileで要求する。ローカル承認JSONはセキュリティ証明書ではなく、操作者の確認記録。
Spark実使用量は機械取得しない。人が確認した15分以内の使用量とreserveを承認fileで入力し、合計が50,000未満かチェック。停止やFileVaultも人手確認項目。実行権限を持つ人が虚偽の承認fileを書けることまで防ぐ仕組みではない。

2走査でdoc値・パス・updateTimeまで照合。欠落親もshowMissingで再帰探索。文書全体をlistDocumentsで取得するので個別getの二重取得を避ける。
ページ100件につき101read unitを**送信前に保守的予約**、その他のRPCは1unit予約、再試行なし。予約量は実請求read量ではなく上限計画用。root/各refのcollection列挙も計数。小さいsubcollectionが多い場合は過大予約で早期停止する。必要budgetが残枠より大きければ実行不可と判断し、Blazeへ切り替えない。
返却された全HTTP payloadの合計maxBytes（上限128MiB）と1走査のmaxDocumentsを制限。期限超過／太平洋時間の日境界跨ぎを拒否。全データはメモリ保持するため、ホストの十分な空きメモリも人が確認する。

## 人が行う操作順

1. **この実行について別途承認を得る。** Spark維持、project `george-69c3a`、default DB、project number/regionをConsoleで再確認。今回の禁止事項が解除されたと推測しない。
2. IAM管理者が専用SAを確認する。roles/datastore.viewerまたは必要なget/list/DB metadata/project metadata権限のみ。継承したwrite/admin、Auth管理、Rules/index変更、import/export等がないことを確認。操作者には対象SAへのtoken発行だけを許可する。設定が必要なら別承認を得る。鍵JSONは作らない。
3. gcloudのインストールと承認済み操作者の認証、impersonation API/policy/scopeが利用可能なことを確認。gcloudのデバッグ／HTTPログを使わず、token出力コマンドを端末へ直接実行しない。ツールがstdoutをメモリへ捕捉する。
4. 全writerを棚卸しして停止する。ブラウザ登録だけでなく既読/通知/baseline、Console、Admin job、TTL等を含む。v2 pausedだけでは不十分。全write停止Rulesの別承認・Emulator検証・適用確認、Admin処理停止、先行commitと伝播の収束を確認する。今回はRules変更なし。詳細はpreflightの停止節を参照。
5. 使用量・列挙規模・期間中の他利用・遅延余裕を確認し、予約read budgetを設定する。太平洋時間の同一quota day、実行期限1時間以内、usage確認15分以内。送信量枠も人が別確認する。予算不足／全停止不明なら中止。
6. FileVault有効の非同期・非共有ディレクトリをrepo外に作成、0700にする。強い乱数passphraseをKeychain等に別保管し、一時passphrase fileは0600。backup fileはツールが0600で作成する。十分な容量、保持期限と別暗号化媒体を決める。
7. 承認JSONを同private directoryへ0600で保存する。下記例は**未承認テンプレート**。実測値・証跡・実行日時を埋め、不明項目をtrueにして進めない。JSONにtokenや個人データを入れない。
8. 下記コマンドを実行する。成功ログは文書数と予約unitのみ。失敗は固定メッセージで終了し、部分ファイルを成功と扱わない。自動再実行しない。
9. 暗号化コピーを別媒体へ保存し、verifyと空の隔離Emulator復元を行う。GCM/SHA/全パス/型/全値を照合。実データを共有Emulator/UIへ公開しない。参照はsource DBのパスをtarget demoの同パスへ再結合。
10. 成功証跡を非機微な件数/hashだけで記録。Auth UID/Google providerは削除・変換しない。全停止の解除とv2移行は別の承認済み手順に従う。backup成功だけでv2公開しない。
11. 一時passphrase/ローカル実データ/Emulatorログを保存方針に従って削除、短期token/操作者認証の後処理を行う。バックアップと鍵は別管理。Auth自体は今回のbackupに含まれない。

## 承認fileの例（このままでは必ず拒否）

```json
{
  "version": 1,
  "project": "george-69c3a",
  "projectNumber": "人が確認した番号",
  "database": "(default)",
  "region": "人が確認したregion",
  "serviceAccount": "backup-reader@george-69c3a.iam.gserviceaccount.com",
  "approvedBy": "承認者",
  "iamReviewedBy": "IAM確認者",
  "iamEvidence": "継承含むIAM確認の記録参照",
  "freezeEvidence": "全writer停止と収束確認の記録参照",
  "allWritersStopped": false,
  "writesConverged": false,
  "effectiveIamReadOnly": false,
  "sparkConfirmed": false,
  "privateStorageConfirmed": false,
  "validFrom": "実行許可開始ISO日時",
  "validUntil": "開始から1時間以内の終了ISO日時",
  "usageCheckedAt": "15分以内のUsage確認ISO日時",
  "quotaDay": "太平洋時間のYYYY-MM-DD",
  "usedReads": 0,
  "otherReadsReserve": 1000,
  "marginReads": 5000,
  "maxReadUnits": 10000,
  "maxBytes": 33554432,
  "maxDocuments": 1000,
  "output": "/private/path/to/backup.osatsu-backup"
}
```

数値例は本番推定ではない。使用済み+他利用reserve+余裕+maxReadUnitsが50,000未満であることをツールが要求。Console遅延／他利用をゼロと勝手に仮定しない。

```sh
# 実行承認後のみ。順序を含め全引数必須。今回未実行。
npm run backup:production -- \
  --project george-69c3a \
  --database '(default)' \
  --service-account backup-reader@george-69c3a.iam.gserviceaccount.com \
  --approval-file /private/path/to/approval.json \
  --output /private/path/to/backup.osatsu-backup \
  --passphrase-file /private/path/to/key.passphrase

# 本番sourceを許可しても接続/復元先は常にdemo Emulator。
FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 npm run backup:emulator -- verify demo-isolated /private/path/to/backup.osatsu-backup /private/path/to/key.passphrase --source-project george-69c3a
FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 npm run backup:emulator -- restore demo-isolated /private/path/to/backup.osatsu-backup /private/path/to/key.passphrase --source-project george-69c3a
```

source指定なし／不明source／本番target／非空target／破損は拒否。restoreは全体で原子的でない。途中失敗なら別の空demoで再試行する。create/updateTimeのサーバーメタデータは証跡のみで復元不可。

## v2機能フラグ（今回変更・設定しない）

Productionの**ビルド環境変数**は `VITE_BILL_IDENTITY_V2=true`（文字列、完全一致）。`src/services/firebase.ts`が `identityV2Enabled` に渡し、`src/utils/identityEnvironment.ts` は `flag === 'true'` のときだけ有効化する。未設定/false/TRUE等は無効。
Viteが `npm run build` 時に埋め込むため、既存配信物へWorker runtime変数だけを追加しても反映しない。Cloudflare Workers BuildsのProduction build環境に設定後、承認されたアプリ再ビルドが必要。
Emulatorフラグは独立した `VITE_USE_FIREBASE_EMULATORS`。本番接続はDEVチェックでEmulatorを無効化。Productionでこのフラグを有効にする必要はない。
`src/services/billIdentityUiService.ts` のv2登録ガードが機能フラグを確認する。さらに実際の登録許可にはv2 RulesとappConfigが必要。フラグだけを先に設定して公開しない。
ユーザー確認済みCloudflare Builds: repo atsushiyago/osatsu-no-tabi、Production main、npm run build、npx wrangler deploy、自動ビルドあり、Production v2フラグ未設定。今回はDashboardへ接続せず、設定を変えていない。

## 未確認事項

実SAのtoken発行・tokeninfo/IAM API応答、実効継承IAM、DB metadata、全writer停止/収束、実文書数と無料枠・送信量・メモリ、実データからの復元は未確認。2走査/updateTime一致だけでsnapshot isolationは保証しない。Auth/Rules/indexのbackupは対象外。
既存依存のhigh警告は今回変更していない。本番機微データを扱う前の評価は残る。

## ローカル検証結果

- 本番RESTモック14件、backup/restore Emulator14件成功。
- 既存単体115件、strict Rules56件、v2整合性152件、参照回数13件、移行11件成功。歴史的MVP45／rate-limit20件も維持。
- typecheck/lint/build/diff check成功。既存lint警告2件、大チャンク警告維持。
- 本番projectを持つ合成ファイル（sourceVersions/SHA含む）はexplicit source指定がある場合のみ空demoへ復元でき、全型・全パス・全値一致。実データは使用していない。
- 本番認証gcloud/API経路は実行せず、requestを差し替えたモックで成功／権限不足／write権限／誤project/region/identity／期限切れ／通信失敗／更新／予算超過を確認した。
- proxy/debug環境も拒否。全実効IAMと停止・Spark使用量の人手確認を置き換えるものではない。
