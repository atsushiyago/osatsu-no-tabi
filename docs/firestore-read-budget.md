# Spark無料枠：バックアップ前の件数・予算確認

今回、本番への接続・データ取得・認証実行・設定変更・backup・commit/push/deployはしていない。追加コマンドはモックだけで検証。
ユーザー確認済みSA：`osatsu-backup-reader@george-69c3a.iam.gserviceaccount.com`、短期認証とproject roles/datastore.viewer。継承したwrite権限の人手確認は既存runbookどおり必要。

## 結論

事前の全件再帰走査は行わない。まず既存の非機微な件数記録があればそれを使い、なければ**limit付きcount aggregation**で既知のscopeだけを確認する。
countは文書を返さず、1000 index entriesまでの集計が1 document read相当、0件でも最低1read。無料・無制限ではない。[公式](https://firebase.google.com/docs/firestore/pricing#aggregation_queries)。別のindex課金を二重に足すのでなく、このindex entry走査をread換算して日枠へ含める。
今回のqueryはfilter/orderByなし、structuredQuery.limit=1000、count(*)。追加field indexの複数走査を要求しない。**count結果1000は総件数として採用しない**（1000以上の可能性）。処理を停止し、別途の上限計画をレビューする。より大きい無制限countやgetDocsでの代用はしない。
IAM/backend/collection-group indexエラーでも停止する。indexは自動作成しない。課金・Query Explain・実SA応答は本番でまだ未確認。

## 範囲

既知の5root：serialIndex / publicBills / sightings / rateLimits / appConfig。
users root自身もcountし、親不存在でcount(users)=0でもtrackedBillsを見落とさないようcollection-group集計を別に行う。
さらにv2のbillIdentityIndex / billIdentities、旧MVP bills、将来/fixtureで使われるsettingsも含める。

| scope | query数 |
|---|---:|
| 上記5root＋users＋v2の2root＋bills | 9 |
| collection-group trackedBills / settings | 2 |
| 合計 | 11 |

collection-groupはDB全域の同じcollection IDを数える。users以外に同じIDがある場合、後述の構造仮定が成立しない。未知のroot・別名subcollection・深い階層をcountだけで検出することはできない。
`schemaReviewed` を未確認のままtrueにしてはいけない。**この11集計は完全なコレクション棚卸し／バックアップではない。** 不明なデータ構造が残れば、完全バックアップの予約量は確定できない。

## コマンドと安全装置

- `queries`：集計のREST bodyを表示するだけ。通信・認証なし。
- `plan FILE`：既存件数/Usageからオフライン計算。通信・認証なし。不明値・未確認schema・予算超過ならexit 2/失敗。出力ready=trueも条件付きの計画評価であり、backupを起動しない。
- `count ...`：将来人が別途許可した場合だけ、短期impersonationで11集計を実行する。本番backupの2走査や暗号化fileの作成は呼ばない。token/project/DB/IAM確認は既存コードを共有。

countはメタデータ・token・IAM確認4unitsと、各aggregateに2unitsを送信前予約する（見積りは1でも余裕を持たせる）。**合計26 reserved read units**。4つすべてがFirestoreの請求readという意味ではない。再試行なし。
既存の承認fileは最新Usage/同一Pacific quota day、期限、明示project/DB/SA、read-only IAM、Spark確認を要求する。countも既存validateApprovalを使うため、**全writer停止・収束確認が必要**。停止前に使えるのは既存記録に基づくplanだけ。未停止なのに承認fileのflagsをtrueにしない。
`maxReadUnits >= 26`、`usedReads + otherReadsReserve + marginReads + maxReadUnits < 50000` が開始条件。少なくとも26unitsの余裕がなければ認証／集計を開始しない。
バックアップ側も既存の送信前予約上限を維持。未知/通信失敗/permission/quota/期限切れは成功扱いにしない。

## バックアップの予約計算

現行backupは、listDocuments pageSize100に毎回101unit、listCollectionIds各pageに1unit、初期確認4unitを予約し、2回走査する。

```text
Rbackup = 4 + 2 × (101 × P + C)
P = 1走査の文書一覧page数の上限
C = 1走査のcollection ID一覧page数の上限
Rtotal = 使用済みU + 他利用B + 余裕H + 26（事前集計） + Rbackup
条件: Rtotal < 50,000
```

**実請求readとreservationを混同しない。** このコマンドは過大でも既存backupが途中で上限に達しない保守的な計画を優先する。すでにUsageへ事前集計を反映した場合、26を再加算すると二重計上になるが安全側である。

計算の仮定:

- rootsは指定9ID以外になく、全subcollectionはusers/{uid}/trackedBillsまたはsettingsのみ、さらに深い階層はない。
- 親欠落usersの上限Mは trackedBills件数T＋settings件数S。実在usersの件数Uuserだけを親数にしない。
- root文書ページは `ceil((root件数＋usersの場合M)/100)+1`（0件なら0）。最後の空pageの余裕を含む。
- group t件について具体的なcollection数Aは `min(t,Uuser+M)` 以下。分布不明なので `ceil(t/100)+2A` をpage上限にする（各collectionと終端の余裕）。全ユーザーを1collectionと見なさない。
- C上限はroot1page＋全実在文書数＋M。reviewed schemaならrootは9、各userのchild IDは2以下で1page、child文書にはsubcollectionがない。
- データが増えるとcount結果は未来の上限ではなくなる。全停止・収束の確認と最新件数が前提。

例：5rootにそれぞれ100件、users=0、trackedBills=100、settings=0、v2/MVP=0を仮定すると、P上限=213、C=701、Rbackup=44,432。
usedReads=0、B=1000、H=5000なら合計50,458で**拒否**。これは実本番の件数ではなく、終端page/ユーザー分散を含む予約例。実readが少なくても、現行コマンドの保守的予約では開始しない。
件数だけではサイズ・ネットワーク転送・メモリを見積もれない。既存maxBytes/文書数制限と人手確認も別途必要。

## Macで人が実行する順序

1. まずFirebase ConsoleのUsageと既存件数記録を人が確認。Consoleのデータ一覧を延々スクロールして数えない。現在の使用量と表示遅延・通常利用の余裕を入力する。
2. オフラインplanから開始。不明なcountは0とせず未入力にして停止させる。
3. 件数記録がない場合、全writer停止・収束の別承認/実施後、count実行の承認fileをprivate dirに0600で作成。serviceAccountはユーザー指定のosatsu-backup-reader。初回countだけならmaxReadUnits=26でよい。他の必須値はrunbookどおり実確認して記入。
4. 26unitsの枠と同一日の余裕が確認できた場合だけ、**人が以下のcountコマンドを実行**。今回は未実行。失敗したcounts fileを入力に使わない。
5. count出力のcountsをplan JSONへコピー、schemaの網羅性と無料枠を再確認してplan。無条件にバックアップへ続くshell chainは作らない。
6. ready=false/不明/1000上限/予算不足ならbackupを開始しない。ready=trueでも全停止・認証・保存先・サイズ・実行時Usageの承認は別途必要。

```sh
# いずれもリポジトリrootで実行
# 今すぐ使えるオフライン確認
node scripts/backup/check-budget.mjs queries
node scripts/backup/check-budget.mjs plan /private/path/to/plan.json

# 追加承認・全停止確認後に人が実行する集計のみのコマンド（今回未実行）
# 出力fileもprivate directoryに保存。token/個人データは出力しない。
umask 077
node scripts/backup/check-budget.mjs count \
  --project george-69c3a \
  --database '(default)' \
  --service-account osatsu-backup-reader@george-69c3a.iam.gserviceaccount.com \
  --approval-file /private/path/to/count-approval.json \
  > /private/path/to/counts.json
```

plan.jsonの形式（0は確認済み0の場合のみ使用）：

```json
{
  "counts": {
    "roots": {"serialIndex":0,"publicBills":0,"sightings":0,"rateLimits":0,"appConfig":0,"users":0,"billIdentityIndex":0,"billIdentities":0,"bills":0},
    "groups": {"trackedBills":0,"settings":0}
  },
  "usedReads": 0,
  "otherReadsReserve": 1000,
  "marginReads": 5000,
  "schemaReviewed": false
}
```

本番free quota/resetは[公式quota](https://firebase.google.com/docs/firestore/quotas)を参照。今回は本番件数/使用量を取得していないので、実際に無料枠内でバックアップ可能かはまだ未判定。

## ローカル検証

モック22件成功（既存本番専用14件＋count統合1件＋予算7件）。count scope/limit、集計しか呼ばないこと、親欠落、分散による大きな予約、unknown schema/不足count/無料枠超過拒否、集計通信失敗を確認。本番への接続はしていない。
