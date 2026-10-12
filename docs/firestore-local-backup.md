# Spark対応：ローカルFirestoreバックアップ（Emulator検証版）

## 現在の範囲

本番接続、認証設定、バックアップ、Authユーザー取得、復元、設定変更を行っていない。
今回のCLIはbackup/verify/restoreすべて **demo-* プロジェクト + 明示された127.0.0.1:portのFirestore Emulator** に限定。本番読み取り機能は未実装。v2ソース、Rules、UIは変更していない。
Node.js 24以上。Admin SDKは開発依存のみでフロントbundleに含めない。

## 対象の棚卸し

| コレクション | 内容 |
|---|---|
| serialIndex | v1記番号→UUID（非公開） |
| billIdentityIndex | v2複合識別→UUID（非公開） |
| billIdentities | UUID→識別情報、クライアント読取禁止 |
| publicBills | 公開紙幣、額面、発見数、距離等 |
| sightings | UUIDごとの発見履歴・地域・メモ |
| users/{uid}/trackedBills | owner記番号、UUID、初回登録、通知、既読等 |
| rateLimits | UIDごとの回数・登録操作参照 |
| appConfig | 登録停止／v2許可 |
| bills | 古いMVP記録。現行Rulesでdeny、存在すれば保全 |

現在のサービスはこの集合を使用。ツールはホワイトリストに限定せず、すべてのルートと任意深さのサブコレクションを走査する。将来の追加コレクションも含む。
`listCollections → collection.listDocuments → ref.get + ref.listCollections` を再帰実行。
listDocumentsはshowMissingを使用するため、親文書が存在しなくても子に到達できる。[公式SDK資料](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/collectionreference)。
欠落した親は文書として保存／新規作成しない。Firestoreに永続的な「空コレクション」は存在しないため、未書き込みのcollection referenceはバックアップ対象にならない。

## 保存形式と完全性

AES-256-GCM暗号化の `.osatsu-backup`。パスワード由来の鍵はscrypt（N=16384,r=8,p=1）、ランダム16byte saltと12byte nonce。パスフレーズは16byte以上、十分な乱数を利用。SHA単独では改ざん防御にならないためGCM認証を併用。
外側は暗号方式・salt/nonce/tag・暗号文のみ。manifestを含め機微情報はすべて暗号文内。

内部JSON:

```text
format: osatsu-firestore-backup
version: 1
project: demo-...
database: (default)
createdAt: ISO timestamp
consistency: two-equal-scans-not-a-snapshot
snapshot:
  collections: 全コレクションのパス
  documents: [{path, data: 型付き値, sha256: 型付きdataのSHA256}]
manifest:
  count: 総文書数
  collections: {collectionPath: 文書数}
  sha256: snapshot全体（パス含む）のSHA256
```

型付き値はタグ付き配列。mapもフィールド名と値の配列にするため、利用者データと型タグが衝突しない。フィールド順は整列。
Timestampはseconds/nanoseconds、GeoPointはlat/lng、Bytesはbase64、ReferenceはDB内の完全パス（復元先の同パスへ結び直す）、array/map/null/string/bool/numberを保持。
`useBigInt:true` でint64を10進文字列化。最大／最小int64を丸めない。NaN/±Infinity/-0、Vectorも対応。
別DBへのReference、未知の型、不正値は黙って文字列化せず停止。現時点でdefault DBのみ。createTime/updateTimeというサーバー文書メタデータは復元できない。ユーザーフィールドのcreatedAt等は保持。

2回の全件走査で内容／パス／件数が等しいことを確認してから保存。取得失敗・不明な型・変化があれば成功としない。
保存ファイルは排他的作成、mode0600、リポジトリ外、シンボリックリンク拒否。既存バックアップを上書きしない。書込後にも復号して内容を照合。
ログは成功時の件数または固定の失敗メッセージだけ。SDK例外本文、文書パス、記番号、UID、メール、トークンをCLIから出力しない。
失敗／クラッシュ時に未完成ファイルが残る可能性がある。verify成功前のファイルは使わない。

**2回一致は同時点スナップショットの保証ではない。** 両走査の合間に変化して元に戻る更新等は検出できない。完全バックアップの前提は全書込み停止と収束。登録停止だけでは既読／通知／管理者更新が残る。
現在は全データ／パスをメモリ上に保持。大規模DBにはストリーミング形式・ページング・メモリ上限・read予算の追加が必要。

## 実行（Emulatorのみ）

```sh
npm run test:backup
# 別途Emulatorを起動し、demoデータだけを用意する場合:
# passphraseファイルをリポジトリ外の私有ディレクトリに作成しchmod 600。
# パスワード自体はコマンド引数・履歴・環境変数に書かない。
FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 node scripts/backup/firestore-backup.mjs backup demo-source /private/tmp/sample.osatsu-backup /private/tmp/key.passphrase
FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 node scripts/backup/firestore-backup.mjs verify demo-source /private/tmp/sample.osatsu-backup /private/tmp/key.passphrase
FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 node scripts/backup/firestore-backup.mjs restore demo-empty-target /private/tmp/sample.osatsu-backup /private/tmp/key.passphrase
```

GOOGLE_APPLICATION_CREDENTIALSを指定した場合も拒否。接続環境とSDK実効host/port/ssl、project一致を再確認。本番project、未指定host、外部host、非demoDBは拒否。本番の復元機能はない。
復元前にGCM、バージョン、タグ、パス重複、各doc SHA、manifestを検証。空DB限定。200文書ごとのcreate batchで既存文書の上書きを防ぐ。
復元後に全件を再走査し、型・全フィールド・パス・件数を含め完全比較。全体の復元は原子的ではない。途中失敗は部分復元として失敗終了し、同DBへの再実行も空DBチェックで拒否。専用demoDBを人が確認して破棄し、新規隔離DBで再試行する。勝手な削除／ロールバックはしない。
復元中は他クライアントを接続しない。照合後の更新まで防げる保証はない。
Admin SDKはRulesをバイパスするので、復元後にWeb SDKから公開読取・owner-only・逆引き拒否を別に検証する。Rules、index、Auth設定自体はデータファイルに含まれない。Gitの候補設定とデプロイ時の適用版を別保全する。

## Emulatorテスト

旧v1紙幣1件、同番号のE券黒／褐色2件、発見履歴4件、匿名／Google相当UIDの追跡、settingsサブコレクション、rate/config、古いbills、2階層の欠落親、全型fixture: 計21文書。
全フィールド比較後に、公開3紙幣／旧紙幣の履歴2件・owner追跡の読取、private reverse／他owner拒否、通知変更、旧紙幣への発見追加拒否を確認。
ここでのGoogle相当UIDはfixture識別子で、Authアカウントがこのバックアップで作成されることを意味しない。
暗号破損／パスワード誤り／SHA・manifest破損／重複／取得失敗／走査中変化／部分復元失敗／非空DB再試行拒否も確認。
既存Rules・移行テストは同じEmulator起動内で別demo namespaceを用いて回帰する。

## Authenticationの追加保全（設計のみ）

FirestoreバックアップはAuthユーザー・provider link・Googleログイン設定を保存しない。trackedBillsを元通りにしてもAuth UIDが変わるとアクセスできない。
Admin SDK `listUsers(1000,pageToken)` で全ページを走査しUID、providerData（google.comのprovider UID等）、disabled、emailVerified、metadata、必要なcustomClaimsを別の暗号化manifestへ保存できる。[公式](https://firebase.google.com/docs/auth/admin/manage-users#list_all_users)。
匿名ユーザーはproviderData空だけでは厳密に判別できないため、記録を推測で変換しない。個人情報（email/displayName/photoURL/phone）も機微情報。生OAuth access/refresh tokenは不要、取得・保存しない。
email/passwordが将来追加された場合、password hash/saltの取得には追加の権限とhash設定保全が必要。今回の匿名／Googleと同じ扱いにしない。
ユーザー単位／総数／SHA、UIDとtrackedBillsのowner集合照合、取得失敗／ページ漏れ検出を設計する。FirestoreとAuthの取得は同一時点ではないため、アカウント作成・削除・linkも停止／収束が必要。
`importUsers` はUIDとOAuth provider情報を指定可能だが、1回1000件まで、部分失敗の精査、provider UID/email重複、provider設定／承認domainの再現が必要。[公式](https://firebase.google.com/docs/auth/admin/import-users)。
ブラウザセッションや既存refresh tokenの継続は保証しない。Googleユーザーは再認証が必要になり得る。匿名ユーザーはUIDを復元しても別ブラウザで本人として再ログインする手段がないため、残るデバイスセッションとの関係を別途検証する。
本番Auth取得／復元コードは追加していない。Auth Emulatorと別Firebase検証環境で別作業として検証する必要がある。

## Sparkのまま将来本番read-onlyへ進む準備（今回未実施）

managed exportではなく通常SDK readでローカル保存する案。Sparkのプラン／課金設定は変更しない。
Firestore Standardの無料枠は(default) DBについて50,000 reads/日、ネットワーク転送等にも無料枠制限がある。managed backup/PITR等は課金有効化が必要。[公式枠](https://firebase.google.com/docs/firestore/quotas)、[read課金](https://firebase.google.com/docs/firestore/pricing)。この方法も「読み取り無制限」ではない。
現在の走査はN文書+M欠落親を2回getするので**少なくとも2(N+M) readを予算化**。listDocuments/listCollectionsのAPI・ページ数、SDK retry、追加確認、空読取と通常利用分も監視に含める。将来版は実測RPC/Usage、停止予算、残枠余裕を設ける。費用0を机上計算だけで保証しない。Emulatorは本番quotaを再現しない。

必要な人手確認:

1. 本番project/default DB、実際のRules/index、対象全コレクション、サイズ、残無料枠、バックアップ先の空き容量を確認。
2. 短期の認証で読み取りだけ可能な専用identityを使用。IAMのdatastore.entities.get/listとコレクション列挙に必要なメタデータ権限を含め、書込/delete/export/import権限を与えない。候補はdatastore.viewerまたは最小custom role。IAMを人が確認する。Rules/App CheckはAdmin SDKへの安全装置にならない。
3. サービスアカウント鍵JSONを新設せず、既存の承認されたWorkload Identity Federation／サービスアカウントimpersonationによる短期ADC等を検討。[鍵なし認証](https://cloud.google.com/docs/authentication/use-service-account-impersonation)。Node SDK・組織policy・Spark projectで使えることは未検証。権限を持つ通常の管理者ADCの流用は避ける。Authは別の読み取りidentity/権限を設計。
4. このEmulator専用ツールのdemoガードを安易に外さない。将来、本番read-onlyコマンドを別に実装し、project allowlist、予算、権限、接続先、出力先をレビュー。restoreは引き続きEmulator限定。
5. 登録、再発見、既読/通知、管理者/外部batch、Auth link等、全更新を止める。現在のv2 pausedだけでは不十分。停止用Rulesの追加設計・Emulator検証・別途承認が必要。既存データを変更せず、先行writeの収束を確認する。
6. 安定状態で列挙と2走査、既知コレクション・UUID/index/history/owner関係・独立した前後の件数/内容manifestで照合。2走査だけでAPIが返さなかったデータの存在まで証明はできない。列挙権限、missing祖先、DB選択、書込停止の保証をレビュー。
7. privateなMacローカル領域、FileVault、暗号化外部媒体を使う。親dir0700、file0600、強いパスフレーズをKeychain/承認済みpassword managerで別管理。iCloud/共有フォルダ、ログ、shell履歴に平文を置かない。パスフレーズtemp fileは作業後削除。SSD/APFS/snapshotでsecure eraseを保証できないため、暗号化と鍵廃棄を中心に保持期限を管理する。メモリ内平文・Nodeのコピー完全消去は保証しない。
8. 暗号化コピーを別の暗号化媒体に保管、両方復号／SHA検証。実データはアクセス制限した隔離Emulatorへ復元（ネット公開しない）。保存期限、アクセス権、復旧責任者、削除時期を記録。
9. FirestoreとAuthのUID保全、復元リハーサル、read quota、依存脆弱性、全停止の実証が揃うまで本番のバックアップ成功／移行準備完了とは判断しない。

## 残る制約

本番IAM/無料枠/Firestore列挙規模/全write停止/Auth復元/Google実認証は未検証。安全な本番接続・Authバックアップ実装は後続作業。
追加依存は開発用Admin SDK。npm auditは既存Firebase/grpcとWrangler系のhigh advisoryを報告している。強制的な旧Firebaseへの変更や無関係な自動fixは行わない。将来本番データを扱う前に依存監査を別途解消／評価する。

## 今回の検証結果（2026-10-12）

| 検証 | 結果 |
|---|---|
| 新規backup suite（親test含む） | 13成功 |
| 21文書の再帰取得・暗号化・復元 | 全パス／型／値／manifest一致 |
| CLI backup / verify / restore | 件数のみの成功ログ、全件照合成功 |
| 既存単体 | 115成功 |
| strict Rulesシナリオ | 56成功 |
| v2整合性 | 152成功 |
| Rules参照回数 | 13成功 |
| 移行リハーサル | 11成功 |
| 歴史的MVP / rate-limit契約 | 45 / 20成功（現行v2互換性とは別） |
| TypeScript / lint / build / diff check | 成功、既存lint警告2件・大チャンク警告維持 |

npm auditのhigh警告9 packageはすべてHEADのlockfileにも同じバージョンが存在する。今回追加したAdmin SDK専用依存への新規advisoryは当該auditで報告されていない。既存grpc等の警告は本番実データの取扱い前に評価が必要。今回auto fix／ダウングレードはしない。
テストデータ・暗号化ファイル・パスフレーズはOSの一時privateディレクトリ内で作成し、試験後削除。スクリーンショット、実データ、認証鍵をGitに追加していない。
