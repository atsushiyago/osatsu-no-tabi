# appConfig/billRegistration 管理者更新（未本番実行）

今回の実装はローカル/モック/demo Emulatorのみ。本番Firestore/Auth/IAM/Rules/Cloudflareには接続・変更しない。Spark維持。TTL 0件は利用者の確認結果として受領し、再照会していない。

## 固定境界と承認

コマンド `scripts/admin/registration-config.mjs` は project george-69c3a、DB(default)、path appConfig/billRegistration に固定。任意path/hostのCLI引数はない。許可する遷移は未作成→paused/2、paused/2→v2/2、v2/2→paused/2だけ。未知schema/version/追加field/同値遷移は拒否する。旧記録を推測で補完しない。
認証はgcloudの明示したSAへの短期impersonationのみ。バックアップ/readerの名を持つSAは拒否、tokeninfoのemail/残存時間、project ID/number、DB名/region/type、getとcreateまたはupdateのIAMを照合。代表的なdelete/import/export/Rules/IAM変更権限は拒否。実効IAM全体は人によるレビューが必要。一般的なIAMで単一documentにwrite権限を限定できるとは仮定しない。ユーザーADCや別主体へのfallbackはない。鍵ファイル・proxy/debug環境は既存assertRuntimeで拒否。tokenを表示/保存しない。
利用者確認済みの本番SAはosatsu-config-manager@george-69c3a.iam.gserviceaccount.com。今回、本番接続やIAMの再確認は行っていない。既存backup SAの権限を増やさない。

操作ごとにrepo外・0600のversion 2承認JSONが必要（有効期間最大15分）。actionをinspectまたはapplyへ固定する。version 1、action欠落/不一致、未知fieldは拒否し、互換読み込みはしない。例は未承認で、そのままでは拒否される:

```json
{
 "version":2,
 "action":"apply",
 "project":"george-69c3a",
 "database":"(default)",
 "path":"appConfig/billRegistration",
 "projectNumber":"確認済み番号",
 "region":"確認済みregion",
 "serviceAccount":"osatsu-config-manager@george-69c3a.iam.gserviceaccount.com",
 "operationId":"操作ごとのUUID v4",
 "approvedBy":"承認者",
 "iamEvidence":"継承を含むIAMレビュー証跡",
 "maintenanceEvidence":"バックアップと復元照合完了・他writer停止証跡",
 "rulesEvidence":"適用Rulesetと停止状態の確認証跡",
 "backupInProgress":true,
 "backupVerificationInProgress":true,
 "adminIamReviewed":false,
 "sparkConfirmed":true,
 "validFrom":"許可開始ISO時刻",
 "validUntil":"15分以内の期限ISO時刻",
 "from":"paused",
 "to":"v2",
 "expectedUpdateTime":"承認時に読み取った正確なupdateTime"
}
```

applyで未作成ならfrom/expectedUpdateTimeはJSON null、toはpausedのみ。inspect承認ではfrom/to/expectedUpdateTimeの3フィールドをすべて省略する（含めると拒否）。inspectは旧状態の推測を要求しない。再開はpausedからの別承認。approvalのfalse/trueは人による実確認記録であり、書いた内容自体が停止/IAMの証明になるわけではない。

## 将来の利用コマンド（今回は実行禁止）

```sh
# inspectはGET/metadata/IAM確認のみ。承認と短期認証は必要。
node scripts/admin/registration-config.mjs inspect --project george-69c3a /private/path/inspect-approval.json --approval-sha256 'INSPECT_APPROVED_SHA256'
# 個別承認後のみapply。引数にtoken/秘密値を渡さない。
node scripts/admin/registration-config.mjs apply --project george-69c3a /private/path/apply-approval.json --approval-sha256 'APPLY_APPROVED_SHA256'
```

SHA-256は承認者が最終ファイルの内容・actionを確認した時点で記録し、ファイルと別の信頼できる承認記録で照合する。CLIの--approval-sha256は必須で、読み込んだ生bytes全体を検証する。改行や空白の変更も拒否する。実行時にファイルから再計算して自動的に引数へ渡すと改ざん検知を失うため、その使い方は禁止。ハッシュは秘密情報ではないが、秘密トークンは承認fileに入れない。

mainはactionとhashを認証/maintenance lockより前に検証する。apply用のmode/条件だけを許可し、inspect承認でchangeConfigを直接呼んでもネットワーク前に拒否する。inspectのIAMチェックはgetだけ（create/updateを要求しない）。inspectはGETだけ、Commitはapply側に限定。

operationIdごとにapproval-<id>.jsonへaction/sha256の対応を0600で保存し、同じIDの別action/別bytesへの付替えを拒否する。applyの既存operation-<id>.json試行記録も維持する。期限切れinspect承認の再発行は新IDを使う。

applyではGETで期待する旧mode/version/updateTimeを照合し、単一write Commitを送る。未作成はcurrentDocument.exists=false、既存はcurrentDocument.updateTimeを本文に指定。updateMaskはmode/identityVersionだけ、削除はない。更新後はGETで新mode/version/updateTimeを照合する。
operationIdの試行記録をCommit送信前に0600で作り、同じIDのapply再利用は拒否する。timeout/5xx/通信断で自動再送せず、GETだけで確認する。結果はverified、observed-target-after-uncertainty、not-confirmed、unknown、verification-failed。verified以外はexit 2で人の判断を要求する。targetが観測されても、自分の失われたrequestが変更したと断定しない。明示的拒否や認証/権限/旧値不一致はexit 1。
inspectはapply試行記録を作らず、同じ承認内容/IDで再確認できる。ただし期限切れ承認は再利用できず、必要なら新たなinspect承認を用意する。再applyは新しい状態を確認した別承認/IDでのみ行う。再開結果が不明なら既にv2になった可能性があり、事前承認した再停止手順が必要。ツール自体はRulesを変更しない。

## バックアップ保護の共通ロック

同一Mac/同一OSユーザーの `$HOME/.osatsu-maintenance/george-69c3a`（0700）を使用。operation.lockのatomic mkdirでconfig/backup/restoreの同時実行を拒否する。
本番backup mainと本番source指定のverify/restore mainは、認証/処理前に共通lockと永続backup-lease.json（0600）を作る。終了・失敗時もleaseは残る。configはleaseがある限り、バックアップ終了後も復元照合期間も認証前に拒否する。既存backupのproject/SA/予算/停止承認/暗号化/空Emulator/完全性のガードは維持。

隔離Emulator復元・照合が終わり、人が証跡を確認した後だけ、別途承認したローカル操作でleaseを閉じる:

```sh
# leaseファイルのidを確認。秘密情報/実データを証跡文字列に書かない。
node scripts/admin/maintenance-lock.mjs finish-backup <lease-id> 'バックアップと隔離復元の照合完了を示す証跡参照'
```

これは本番APIを呼ばず、記録を残してleaseだけを閉じる。active operation中・ID不一致・空証跡では拒否。確認せずファイルを手動削除して回避しない。
process強制終了でoperation.lockが残る場合もfail closed。生存processと結果を人が確認するまで削除/再実行しない。誤操作回避のため自動stale lock削除はない。
このlockは別ホスト/別ユーザー/Console/独自Admin scriptには効かない。全運用主体の停止確認が依然必要。バックアップ関数を独自scriptから直接呼ぶ場合もCLI lockを迂回できるので、承認済みCLIだけを使用する。承認JSONを虚偽に書ける操作者まで技術的に阻止するものではない。

## ローカル検証

```sh
node --test test/registration-config.test.js
node test/run-registration-config-emulators.mjs
```

runnerは別ポート28080/29099、demo-osatsu-registration-configだけ。全停止Rules下でexists=false初回作成、双方遷移、競合、通信断後のGETと単一送信、追加field拒否、一般client拒否を検証。モックでは誤project/DB/主体/期限/IAM、backup中、共有lock、単一使用IDの拒否経路を確認。
競合テスト初回は同値更新でEmulatorのupdateTimeが変わらず、意図した競合にならなかった。異なる値へ変更して戻す実際の競合に修正し、期待する拒否を維持して再検証した。

## 本番利用前の未確認事項

- SA/IAM/短期認証は利用者確認済み。今回のツールでの本番到達性・実効権限再照合は未実施。
- approvalの実project number/region/適用Rules/旧config値とupdateTime。
- 外部writer停止・収束の観測方法、別ユーザー/別ホストの排他運用。
- 本番バックアップ/復元照合、Spark残枠/送信量、全停止Rulesの反映。
- 本番RESTの実応答・通信断後の運用復旧。Emulator/mock成功は本番確認ではない。

本番で自動試行しない。全停止下の初期paused設定はbackup/復元検証後、v2再開はアプリ/Rulesの確認後の別承認。旧Rulesへ戻さず、UID/Auth/provider/既存紙幣データは変更しない。

### 検証結果（2026-10-13）

- 新規単体/モック25件、既存150件と合わせて175件成功。
- config Emulator8件（親test含む）、既存backup/restore Emulator14件成功。
- typecheck/build/lint/diff check成功。既存lint2警告とチャンクサイズ警告のみ。
- 変更はadmin tool/テスト/手順書と既存backup CLIへの共通lock追加だけ。src/v2/UI/Rulesは無変更。本番/実Authへ未接続、IAM変更/Rules公開/commit/push/deployなし。

## 操作種別・改ざん防止の回帰確認（2026-10-13）

承認ファイルを作成する既存CLIはない。承認者がJSONを作成/確認し、別記録のSHA-256をCLIへ明示入力する方式。旧票の自動変換・actionの自動補完はしない。旧票は再承認・新IDで作り直す。

新規回帰は旧version/action欠落・種別不一致・inspectからapplyへの流用（未作成ケース含む）、action/path/遷移/ID/空白の改ざん、IDの付替え、CLIで認証前拒否を確認する。既存の条件付き更新、再送禁止、backup lease、固定pathのテストは維持する。

SHA-256は署名ではない。ファイルと期待hash双方を変更できる実行者や、ローカル記録を削除できるOS所有者まで技術的に防ぐ仕組みではない。承認記録の管理と操作者の分離が必要。無関係な本番設定、Rules、v2/UIは変更しない。

検証結果: 新規回帰7件を含む管理者単体32件、既存を含む全単体/モック182件、config Emulator8件成功。typecheck/lint/build/diff check成功（既存lint2警告・大チャンク警告維持）。上記CLIのSHA文字列はプレースホルダーで、承認記録の実際の64文字小文字SHA-256に置き換える。実票・本番データ・鍵・tokenは今回作成/取得していない。commit/push/mergeなし。
