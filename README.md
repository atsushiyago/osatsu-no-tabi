# お札の旅

日本の紙幣の記番号を登録して、そのお札がどこを旅してきたのかを追いかけるWebアプリです。

Live Demo: [https://osatsu-no-tabi.ayago.workers.dev/](https://osatsu-no-tabi.ayago.workers.dev/)

<p align="center">
  <a href="https://osatsu-no-tabi.ayago.workers.dev/">
    <img src="docs/osatsu-no-tabi-qr.svg" alt="お札の旅 QRコード" width="220">
  </a>
</p>

## お札の旅とは

手元のお札の記番号と、見つけた市区町村を記録し、その後の移動をみんなで追いかけるサービスです。記録したお札は保管せず、いつも通りお使いください。別の人が同じお札を見つけると旅の履歴が増えます。登録したお札の一覧を、数週間後にまた開いて旅の続きを見ることができます。

## 主な機能

- 記番号の登録と、全角・小文字を含む入力の自動正規化
- 記番号のリアルタイムvalidation
- 市区町村単位の発見記録と、再発見履歴の閲覧
- Leaflet / OpenStreetMapによる旅の地図表示
- このブラウザから登録したお札の一覧
- サイト再訪時に未確認の新しい発見を表示（Push通知・メール通知ではありません）

## プライバシー

- 保存・公開する位置情報は市区町村とその代表地点の概算座標です。正確なGPS座標や住所は保存・公開しません。
- 位置情報の自動設定は任意です。市区町村は手動でも選べます。
- お札の画像はアップロード・保存しません。

## Tech Stack

- React、TypeScript、Vite
- Firebase Firestore、Firebase Anonymous Authentication、Firebase App Check
- reCAPTCHA Enterprise
- Cloudflare Workers Static Assets
- Leaflet、OpenStreetMap

## ローカル開発

### 必要な設定

Firebase連携を使う場合は、Firebase projectとWeb appを作成し、Firestore、Anonymous Authentication、App Check（reCAPTCHA Enterprise）を設定します。

```bash
npm install
cp .env.example .env
```

Firebase Webアプリの設定とreCAPTCHA EnterpriseのWeb site keyを`.env`へ設定してください。変数名は[`.env.example`](.env.example)に記載されています。`VITE_*`の値はビルド後のブラウザコードに含まれるため、秘密鍵やAdmin SDK資格情報を設定しないでください。Firebase未設定時は開発用のサンプルデータで動作します。

```bash
npm run dev
npm run build
```

利用可能な確認コマンド:

```bash
npm run lint
npm run test:rules:strict
npm run test:auth
npm run test:appcheck
npm run test:serial-input
npm run test:tracked-bills
npm run test:ocr
npm run preview
npm run preview:cf
```

`VITE_FIREBASE_APPCHECK_DEBUG=true`はローカル開発専用です。ブラウザconsoleに表示されるdebug tokenを本番環境へ設定しないでください。

## Firestore構成

### `bills/{billId}`

記番号をdocument IDとして使います。主なfieldは`id`、`serialNumber`、`denomination`、`createdAt`、`updatedAt`、`sightingsCount`、`totalDistanceKm`、`firstSightedAt`、`lastSightedAt`です。strict Rulesでは再発見のクールダウン用にサーバー時刻`lastSightedAtServer`も使います。

### `sightings/{sightingId}`

各発見の履歴です。`id`、`billId`、発見順`step`、`prefecture`、`municipality`、自治体代表地点の`latitudeApprox` / `longitudeApprox`、`createdAt`、直前の発見からの`distanceFromPrevKm` / `daysFromPrev`、および任意の`userNote`を保持します。

### `users/{uid}/trackedBills/{billId}`

本人だけが読める登録済みお札の一覧と既読状態です。`billId`、`createdAt`、`firstRegisteredByMe`、`notifyOnRediscovery`、`lastSeenSightingsCount`、`lastSeenAt`、`lastSeenMunicipality`を保持します。`lastSeenSightingsCount`と現在の`bill.sightingsCount`を比較して新しい発見を表示します。公開bill/sighting documentへUIDや既読情報は保存しません。

### `rateLimits/{uid}`

本人UIDごとの`shortWindowStartedAt` / `shortCount`、`dailyWindowStartedAt` / `dailyCount`、`updatedAt`、`lastOperationBillId`、`lastOperationSightingId`を保持します。登録・再発見のtransactionでは、bill・sightingと同じtransaction内で更新します。

## Security / Abuse Protection

- Firebase App Check、Anonymous Authentication、strict Firestore Security Rulesを併用します。
- strict Rulesは同一billの再発見を15分間に1回へ制限し、UIDごとに10分間10操作、24時間50操作を上限とします。
- 登録時は記番号形式も検証します。
- 匿名アカウントを作り直すことでUID rate limitを回避できるため、完全な荒らし防止ではありません。各層を組み合わせた抑止策です。

## FirebaseとCloudflareの設定・デプロイ

1. Firebase projectを作成し、Firestoreを有効にします。
2. Firebase AuthenticationでAnonymous providerを有効にします。
3. Firebase App CheckでreCAPTCHA Enterpriseを設定します。
4. `.env.example`にあるFirebase Web設定とreCAPTCHA Web site keyを、ローカルでは`.env`へ、CloudflareではWorkers Buildsのbuild environment variablesへ設定します。
5. Cloudflare Workers Buildsでは`.env.example`記載の本番用変数をbuild environment variablesとして設定し、build commandを`npm run build`、output directoryを`dist`にします。Wrangler CLIからデプロイする場合は`npx wrangler login`後に`npm run deploy`を使えます。

### Firestore Rules

本番標準は[`firestore.strict.rules`](firestore.strict.rules)です。[`firebase.json`](firebase.json)もstrict Rulesを指しているため、通常のコマンドでdeployできます。

```bash
firebase deploy --only firestore:rules --project <Firebase project ID>
```

`firestore.rules`は過去の移行用compat Rulesです。旧clientの未認証writeを許容し、UID rate limitを迂回できるため、**本番へdeployしないでください。**

## License

MIT License

詳細は[LICENSE](LICENSE)を参照してください。
