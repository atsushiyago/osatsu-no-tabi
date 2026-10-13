# QA Google OAuth environment

QA is isolated to Firebase project `osatsu-no-tabi-qa` and its default Firestore database. Do not use production data or production credentials. The local `.env.qa.local` is ignored by Git.

## Local Mac check

`npm run dev:qa` loads `.env.qa.local` in Vite `qa` mode and binds only to `127.0.0.1:5175`. The QA-mode runtime guard requires project ID `osatsu-no-tabi-qa`, the real Firebase services (Emulator flag off), and v2 enabled. It fails closed on a mismatch. Do not use `VITE_FIREBASE_APPCHECK_DEBUG` in this mode.

## Rules deployment

After Firebase CLI authentication is refreshed, deploy only the tested strict Rules to QA:

```sh
firebase deploy --only firestore:rules --config firebase.qa-rules.json --project osatsu-no-tabi-qa
```

This config contains no indexes, Hosting, Functions, or other deployment targets. `firestore.strict.rules` is the source used by the Google-account merge and v2 identity Emulator tests.

## HTTPS on mobile

Firebase Hosting is not provisioned for this QA project yet. The Firebase Console already lists `osatsu-no-tabi-qa.web.app` as an Auth authorized domain, so the default QA Hosting domain can be used without adding a new OAuth domain. A project administrator must start/provision the default Hosting site in the QA project. Then:

```sh
npm run build -- --mode qa
firebase deploy --only hosting --config firebase.qa-hosting.json --project osatsu-no-tabi-qa
```

The Hosting config pins the site ID and contains no Firestore Rules target. Its URL is `https://osatsu-no-tabi-qa.web.app`. Never deploy this config with the production project ID.

## Device checks

1. Open the QA Hosting URL in iPhone Safari, iPhone Chrome, and Mac Brave.
2. Before registering any synthetic note, confirm the served app points to `osatsu-no-tabi-qa` and that Auth/Firestore requests go to Firebase services, not Emulator hosts or `george-69c3a`.
3. Use only synthetic serials, municipalities, and test Google accounts created for QA. Do not copy production records.
4. Test anonymous session, Google OAuth, merge confirmation, cancellation, resumable merge, and duplicate preservation. Do not treat Emulator popup success as real OAuth success.

Firebase Hosting and Firebase Auth are separate from Cloudflare Production. No Cloudflare or production Firebase configuration should be changed for this QA flow.
