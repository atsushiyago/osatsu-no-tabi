# 紙幣識別v2：家庭内LAN実機テスト

本番Firebase/Auth/Firestore/Cloudflare/Rulesにはアクセス・変更しない。demoデータのみ。
2026-10-13のMac miniのLAN IPv4は192.168.1.13。DHCP等で変わったら現在のIPを再確認する。

## 接続構造

```text
Android / iPhone 同一家庭内LAN
  → http://192.168.1.13:5174 （Viteだけをこのアドレスにbind）
    → Viteの開発限定proxy → 127.0.0.1:19099 Auth Emulator
    → Viteの開発限定proxy → 127.0.0.1:18080 Firestore Emulator
```

スマートフォンのlocalhost/127.0.0.1は使わない。EmulatorのLAN bind、0.0.0.0、公開tunnel、router forwardingは使わない。UI/HUB/logging/Websocketもloopbackのまま。LAN内の信頼できる端末にだけアクセスさせ、ゲストWi-Fi／公衆Wi-Fiでは起動しない。
LANアクセスには認証を要求しない開発サーバーなので、家庭内LANの他端末もアクセスできる。本番由来backup/個人情報をこのEmulatorにimportしてはいけない。fixtureしか入れない。

## 起動と停止

Node.js24以上と既存Firebase CLI/Javaを使用。ルーター・macOS firewall設定の自動変更はしない。

```sh
# MacのIPv4確認（通常はen1、環境次第でen0）
ipconfig getifaddr en1
# リポジトリで起動
npm run dev:identity:lan -- --host 192.168.1.13
```

launcherはhostがMac自身に割り当てられたRFC1918 IPv4であること、各portが空いていることを確認。別のEmulator／Viteが使っていれば停止し、勝手に終了しない。
Emulatorは既存candidate Rules/indexを読み、project `demo-osatsu-public-serial`。新規のメモリDBにv2 configと合成v1紙幣をseedする。import/exportはしない。
Auth/Firestore readyを確認してからViteを起動。失敗すると両方停止する。ログ場所は起動時に表示するprivate tmp directory。Ctrl+Cでこのlauncherが起動した両processを止める。
Macスリープ/電源断で利用できなくなる。スマートフォンテスト終了後は停止する。起動中の同portへ別起動コマンドを重ねない。

## スマートフォンから開くURL

- 登録：`http://192.168.1.13:5174/#/register`
- 検索：`http://192.168.1.13:5174/#/search`
- 公開一覧：`http://192.168.1.13:5174/#/bills`
- 自分の一覧：`http://192.168.1.13:5174/#/my-bills`

同じ家庭内ネットワークに接続する。guest isolation、VPNやOSのlocal network permission、Mac firewallで遮断される場合がある。到達できない場合にrouterポート開放や公開tunnelで回避しない。Mac firewall許可が必要なら、人がVite/Nodeのこの開発通信だけを検討する。今回は変更していない。
HTTPの開発originなので、camera/geolocation等のsecure-context限定APIは使わない。発見地は手動選択。カメラOCRは今回不要で、debug=timing等を付けない。
HTTP LANではcrypto.randomUUIDが無いブラウザがあるため、LAN DEV serverのHTMLだけにcrypto.getRandomValuesを使う標準UUID v4互換shimを挿入する。紙幣識別の生成・照合・登録ロジックは変えない。Production buildにはshim/proxyを入れない。

## フラグと本番接続防止

launcherがprocess envへ明示設定:

- VITE_USE_FIREBASE_EMULATORS=true
- VITE_BILL_IDENTITY_V2=true
- VITE_IDENTITY_LAN_HOST=指定したMacのprivate IPv4

Firebase app名はidentity-v2-emulator、projectはdemo-osatsu-public-serial、apiKeyはfake-api-key。実FirebaseのVITE_FIREBASE_*は空で上書き、App Check site key/debugも空。App CheckはEmulator使用時に初期化しない。
LAN hostが指定されているのにEmulator opt-inがfalse/不正なら、起動／初期化を拒否し、本番へfallbackしない。
App/SDK接続はAuth/FirestoreともMac IP:5174、proxy先はloopback固定。v2サービスはprojectとAuth hostが一致することを確認。登録前に両Emulatorへ3秒のavailability probeを行い、停止／通信失敗ならemulator-unavailableで登録を拒否。
DEV以外ではLAN overrideを無視、Emulator接続はDEV条件で無効。通常localhost開発は従来の127.0.0.1:18080/19099のまま。

## 実機操作手順（本物の紙幣情報ではなく合成記番号）

1. ヘッダーで日本語/Englishを切替。各言語で以下を確認する。
2. 登録画面で1000/2000/5000/10000を切替。2000はD/守礼門/黒の簡略表示。1000/5000/10000は旧形式でD/Eの券面を確認、新形式の完成記番号でFが自動判定されることを確認する。
3. D/Eを選び、許可色だけが表示されること、色見本/説明、「分からない」で登録保留になることを確認。
4. `LA123456BB` 等の完成したF形式を手入力。F券・黒が自動判定され、券面/色の選択ボタンが表示されないこと。未完成・不正な記番号では自動確定しないこと。`LA123456B` の旧形式ではD/Eと色の手動選択が必要。
5. 検索で `QA654321B` を入力。最初はv1の1000円1候補、券種/色は不明。
6. 1000円/E/黒/`QA654321B` を登録。旧記録との同一性不明の案内を確認し、まずキャンセルで書込みされないことを確認。その後明示確認して独立登録する。
7. 同じ `QA654321B`、1000円/E/褐色で登録。旧recordの確認後、黒と別UUIDになること。
8. 検索で同番号を入力し、旧＋E黒＋E褐色の複数候補を確認。公開詳細に完全記番号が出ないことを確認する。
9. 新規FまたはD2000（例 `LA123457B`）を登録し、detail、公開一覧、自分の一覧を確認。
10. 同じ4項目で再発見。既存仕様の15分以内は「最近登録済み」で新履歴を作らない。実際の再発見モーダルをすぐ確認したい場合、Macで**demoにだけ**以下のfixture時刻調整を行う。登録ロジック/Rulesは変えない。

```sh
# UUIDはLAN demo詳細URL #/bill/<UUID> から取得。本番UUIDでは実行しない。
node scripts/dev/identity-lan-age.mjs <DEMO_UUID>
```

時刻調整はloopbackの固定demo projectだけをPATCHし、既存docのみ更新する。再度スマートフォンで同じ識別を別地域で登録し、同UUIDの発見数増加・再発見CelebrationModalを確認。
11. Android/iPhone、縦横、狭幅で券面/色/説明/ボタン/モーダル/下部navを確認。viewport、routing、Firestore Rulesは今回変更していない。
12. Auth Emulatorは匿名UIDとそのブラウザの追跡を利用できる。2台は別の匿名UIDなので「自分の一覧」が別になるのは正常。Googleの実popup・実Google provider・端末間同期は必須対象外／未確認。Googleボタンを押して本番Googleで確認しようとしない。

## 接続確認

Mac browser DevTools NetworkでhostnameがMac IP:5174であること。Authは/identitytoolkit.googleapis.com/等を**LAN hostのpathname**として使うので、本物のGoogle domainアクセスとは異なる。
本物のfirestore.googleapis.com、identitytoolkit.googleapis.com、securetoken.googleapis.com、firebaseappcheck.googleapis.com、reCAPTCHAへのリクエストが出たらテストを中止する。

Mac browser consoleの確認例（LAN DEVページだけ）:

```js
const m = await import('/src/services/firebase.ts');
({emulator:m.useFirebaseEmulators,v2:m.isIdentityV2Enabled,project:m.db.app.options.projectId,endpoint:m.emulatorEndpoint,authHost:m.auth.emulatorConfig.host,appCheck:m.isAppCheckConfigured})
```

期待値: emulator/v2=true、demo project、endpoint host=Mac IP/ports5174、authHost=Mac IP、appCheck=false。キーやtokenを出力しない。
Phone remote debuggingが使えるなら同じNetwork確認を行う。iPhone/Android実機自体の操作はユーザーが行う。

## 今回の検証と限界

- MacのLAN URLをChromiumで日英×320/375/390/430px確認。匿名認証、read、登録、旧曖昧一致キャンセル、検索、Emulator unavailableで登録拒否。
- 全外部通信をbrowser routeで遮断して検証。本番Firebaseへのリクエスト試行0。地図tile等外部表示はこの試験では遮断。
- listener確認：Vite=Mac private IPv4:5174、Auth=127.0.0.1:19099、Firestore=127.0.0.1:18080、Firestore websocket=127.0.0.1:9151。
- Chromeシミュレーションは実機確認ではない。スマートフォンの到達性、local network/firewall permissions、実Safari/WebKit動作、実Google popupは未確認。
- 実Google認証・カメラOCR・Production設定は今回操作しない。既存Emulator suiteでのGoogle credential link相当の検証は本物のGoogle popup検証ではない。

### UI改善後の確認（2026-10-13）

Fは完成・有効な新形式から自動判定し、券面・色選択欄を表示しない。人物名・裏面説明は16px相当以上。未完成/不正/入力変換中ではFを自動確定しない。旧形式はD/Eの明示選択、D2000は自動を維持。
日英320/375/390/430pxの24スクリーンショットは `/tmp/osatsu-auto-f-ui`、全8ケースとFフォーム登録成功、本番Firebase試行0。単体123、バックアップモック22、strict56/v2整合152/参照13/移行11、歴史的45/20成功。typecheck/lint/build/diff check成功（既存警告維持）。実機の最終再確認・カメラOCRは未実施。

### 段階表示の実機操作（2026-10-13）

初期画面と入力途中は券面/色欄を表示しない。有効な記番号を最後まで入力したら、フォーカスを次へ移す、Enter/Done、または「記番号を確定」で確定する。9文字の旧形式から10文字のF形式へ続けて入力中には追加欄が出ない。
F/二千円は確定後の説明だけ、D/Eは券面→色の順。複数の色に初期選択はない。記番号を編集すると確定・券面・色を解除、額面変更では判定をやり直す。券面説明16px相当以上を維持。
日英320/375/390/430pxの段階表示・F/Eフォーム登録をEmulatorで確認。32画像と結果は `/tmp/osatsu-staged-registration`。単体150件（バックアップモック含む）、strict56/v2整合152/参照13/移行11、歴史的45/20成功。識別キー・登録トランザクション・Rulesは変更していない。カメラOCRは未検証／対象外。
