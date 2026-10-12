# 本番バックアップ用・全Firestoreクライアント書き込み停止

この資料はローカル実装・Emulator検証と将来の操作設計。今回、本番への接続、Rules公開、設定変更、バックアップ、commit/push/deployは行わない。Sparkを維持する。

## 基準と生成

適用済みv1ソースは `f2e5f26:firestore.strict.rules`。本番設定メタデータ取得で一致を確認したSHA-256:
`b48b4884ae3e8a92bd72d1ab0ee7864aeaa902be15e59f4aaf3d8bb01d198107`。
生成器 `scripts/all-writes-paused-rules.mjs` はこのSHA不一致を拒否する。既存のcreate/update/delete/writeのallowをすべてfalseへ置換し、read/get/list条件、match階層と関数を保持する。読み書き混在の許可がfalse以外なら自動変換を拒否する。末尾denyの追加だけではない。元のv1/v2 Rulesは変更しない。

```sh
# ローカルのみ。Git履歴が必要。
node scripts/all-writes-paused-rules.mjs
node test/run-all-writes-paused-emulators.mjs
shasum -a 256 firestore.all-writes-paused.rules
```

Emulatorはdemo-osatsu-all-writes-paused、Firestore127.0.0.1:28080、Auth127.0.0.1:29099。既存LAN実機環境とは別ポート。ポート競合なら中止し、他のプロセスを停止しない。テストは専用runner/環境以外で実行を拒否する。ログはprivate tmp側。本番データを使わない。

v1の公開一覧・詳細・publicBillIdで絞った履歴、認証済みserialIndexの完全一致get、owner trackedBills/rateLimits読み取りを維持する。v1で未許可のappConfig/v2索引/逆引き読取は追加許可しない。全停止中のv2サービスがappConfig/索引読取でpermission-deniedになるのは意図した安全な拒否である。
読み取り画面のbaseline/既読自動更新は失敗する。データは変わらないが、既読更新のUIエラーが出る可能性がある。バックアップ完了まで通常画面の閲覧を「書き込みのない操作」とは扱わない。

## 承認後の公開方法（今回は実行禁止）

本番はgeorge-69c3a、DB(default)。既定release cloud.firestoreを対象とする専用config `firebase.all-writes-paused.json` はRulesのみを指定する。index/アプリ公開を含めない。

1. 公開直前の適用Rulesソース・Ruleset IDを再取得し、基準v1と一致を確認。不一致なら中止して差分レビュー。
2. 生成物一致、SHA、全停止テストと読み取り回帰を確認。専用configのrulesパスを人が照合。CLIのproject aliasに依存しない。
3. 別承認を得た場合だけリポジトリrootで次を実行:

```sh
# 実行しない。対象と専用configを明示する将来コマンド。
firebase deploy --only firestore:rules --config firebase.all-writes-paused.json --project george-69c3a
```

4. Rules管理APIのGET `projects/george-69c3a/releases/cloud.firestore` と、そのrulesetNameのGETを用いて、適用済みソースを保存。ローカル生成物のUTF-8 SHA-256とバイト単位で照合。Ruleset IDも記録。CLI成功だけでは合格にしない。
5. apply失敗時は適用済みreleaseを照合して中止。失敗前のv1が継続しているなら「停止済み」と判断しない。誤適用時の修正公開は別承認。

## 停止・収束確認

- 旧/v2・別ブラウザ・offline queueも同じRulesに従う。未反映の先行writeがあり得るので公開時刻だけで停止完了とはしない。
- 登録/再発見、4設定フィールド、baseline、tracked削除、users、appConfig、未知subcollectionの全書き込みを拒否。全停止版に他のallowを合成しない。
- Consoleのデータ編集、Admin SDK/RESTのIAM writer、CLI/batch、外部job、TTL等はRulesを迂回する。担当者が処理一覧・稼働/予定・終了確認を記録し、バックアップと照合が終わるまで使用しない。必要な設定/IAM変更は別承認。
- 適用ソース照合、利用可能なwrite指標/監査ログと遅延・網羅性、writer終了確認、先行処理の収束を組み合わせる。本番の指標・ログの利用可否は未確認。時間経過だけ・ログなしだけで停止済みと断定しない。
- 本番へ拒否確認の書き込みプローブを自動送信しない。未収束ならcount/backupを開始しない。全writer停止・収束の証拠は既存approval fileへ記録する。
- 実取得の2走査では文書集合・値・updateTimeを比較。これ自体はsnapshot isolationを保証しない。変化・不明・権限/通信エラーは失敗。

## 管理者config更新：設計のみ

バックアップ専用SA `osatsu-backup-reader@george-69c3a.iam.gserviceaccount.com` は変更せず、config更新に使わない。通常Web SDKは全停止/v2 Rules双方でappConfigを書けない。

推奨方式は、別の明示的な運用主体による鍵なし短期認証と、Firestore RESTの条件付き単一書き込みCommit。必要なIAMは対象DBでの文書get・create（未作成時）・update、および対象metadataの確認。IAM最小化の具体的な付与は別レビュー/承認で行う。一般的なFirestore IAMでは単一ドキュメントだけのwrite権限に限定できると仮定しない。DB単位の範囲、条件等の実効権限は実環境で確認する。専用固定パスのツールガードもIAMの代わりではない。Console編集は人手ミス/条件付き更新の不足があるため第一候補にしない。

将来のツール/操作条件:

1. 操作ごとの別承認fileでproject george-69c3a、DB(default)、path appConfig/billRegistration、操作主体、許可時刻、期待する旧値・新値を固定する。tokenや鍵は記録しない。backup中/照合中は実行不可。
2. subject/token/project number/DB/regionを照合。既存read-only SA・ADC/別identityへのfallbackを拒否する。Rulesデプロイ主体とも用途を区別する。
3. GETして存在とmode/identityVersion、未知フィールド、updateTimeを確認。不一致/権限・通信エラーなら書かず停止。未知フィールドを消して合わせない。
4. 未作成なら `currentDocument.exists=false`、既存なら `currentDocument.updateTime=<確認値>` をCommitのcurrentDocument事前条件とする。updateMaskはmodeとidentityVersionだけ。状態は未作成/旧許可状態→paused/2、paused/2→v2/2、v2/2→paused/2の明示承認済み遷移のみ。
5. 成功後は再GETし期待値・更新時刻を照合。timeoutなら成功を推測せず、再GETで判定し、自動再試行しない。応答/値が不明なら全停止Rulesを維持して中止する。
6. v2再開Commitが曖昧に終了した場合は登録が再開済みの可能性がある。即時の再停止を別の事前承認された障害対応手順で行う必要がある。既に全停止版ならconfigがv2でもclient writeは拒否される。

今回のEmulatorテストは別管理者のRules迂回によるconfig更新と、Commit本文のupdateTime事前条件による競合拒否を再現する。REST PATCHのqueryパラメータ方式はEmulatorで必要なbase versionが0と解釈され400になったため、条件を外さず単一writeのCommit本文方式を採用した。未作成時のexists=falseは後続ツールで別途検証が必要。実IAM/短期token/REST条件付きCommitの本番操作ツールは未実装・未検証。これを本番操作承認とみなさない。

## 切替順序

1. 全停止Rulesを別承認で公開、全writer停止・反映と収束を確認。
2. 読み取り予算確認→暗号化backup→隔離した空Emulatorへの復元・全件照合。管理者config操作もこの期間は禁止。
3. 保全完了後に別承認された管理者がconfigをpaused/2へ設定し、再GETで確認。
4. v2 Rulesを別承認で公開。旧登録が拒否され、pausedでv2登録が停止することを確認。この段階で個人設定の書き込みは再び許可される。
5. Cloudflareビルド環境のVITE_BILL_IDENTITY_V2=true、正常な本番Firebase参照、Emulator/debugなしを確認。まだmainへpushしない。
6. 別承認後mainへpushして自動公開。Build SHA/Version、閲覧・検索・旧UUID/追跡を確認。
7. 別承認されたconfig操作でv2/2へ再開。未知/失敗なら停止維持、異常ならpausedと必要な全停止Rulesを再適用。旧Rulesに戻さない。

停止解除とbackupは別の承認。Auth UID/provider link/ユーザーを変更しない。Firestore backupにAuthは含まれない。本番の停止伝播、指標/IAM/TTL棚卸し、実backup/復元と管理者Commit実装・検証は未完了で、本番適用可とはまだ判定しない。

## ローカル検証結果（2026-10-13）

- 新規Emulator/生成物検証23件成功。旧5文書登録をv1で先に成功させ、v2の6文書登録も先に成功させた上で同じclientを停止版へ切り替え、再登録/再発見/事前計画済みバッチを拒否。複数文書transaction、CRUD、4設定フィールド、baseline、owner削除、private read境界、元データ不変を確認。
- 条件付き管理者Commitの正しいupdateTimeでpaused変更成功、古いupdateTimeでのv2変更拒否。管理者変更後も一般clientの書き込みは拒否。IAMの実効権限を検証したという意味ではない。
- 既存単体/モック150件成功。typecheck（build内tsc -b）、build、lint、差分チェック成功。既存lint警告2件とチャンクサイズ警告のみ。
- 既存firestore.strict.rules/firestore.identity-paused.rules/srcは差分なし。本番リクエスト、backup、commit/push/deployなし。検証Emulatorは終了、既存LAN実機サーバーは操作していない。
- 全停止版SHA-256: `d15092968ada04ce150efb9cac32ceb6cf7dc71f8fddca0f624fb2c0016d7195`。
