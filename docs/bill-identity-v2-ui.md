# Bill identity v2 — stage 3 UI verification

Stage-3 historical report. Stage 4 separates the feature and transport flags; see
`bill-identity-v2-rollout.md` for the current connection/release design.

Local, unpublished work. Stage 1 and 2 remain intact. No production Firestore
access, Firebase settings changes, Rules deployment, migration, commit or push.

## Connection boundary

- `npm run dev:identity`: DEV plus explicit `VITE_USE_FIREBASE_EMULATORS=true`.
- Uses a separately named Firebase app, `demo-osatsu-public-serial`, a fake API key,
  Firestore `127.0.0.1:18080`, Auth `127.0.0.1:19099`.
- Production Firebase environment variables are not inherited by that app.
- App Check, including its debug token setup, is skipped only for this demo app.
- `experimentalForceLongPolling: true` remains unchanged.
- Production builds compile the v2 UI flag to false. Ordinary development without
  the exact opt-in continues to use its existing configuration; **do not use ordinary
  `npm run dev` for v2 registration testing**.
- New UI service checks the demo project and local Auth Emulator before every
  operation. It additionally probes both emulators with 3-second HTTP timeouts.
  An absent emulator blocks testing; there is no production fallback.
- The stage-2 transaction's emulator-only guard is retained.

Start emulators in another terminal:

```sh
firebase --project demo-osatsu-public-serial --config firebase.identity-v2.json emulators:start --only firestore,auth
npm run dev:identity
```

Registration also requires the demo `appConfig/billRegistration` fixture with
`mode: v2`, `identityVersion: 2`. Without it, testing is stopped. The optional browser
suite creates this fixture using the loopback-only emulator test helper.

## Registration

- Explicit portrait/reverse design choices use official NPB descriptions:
  https://www.npb.go.jp/product_service/intro/kihon.html
- F requires a selected matching design and compatible serial; black ink is automatic.
- Selecting ¥2,000 selects D/Shureimon and black ink. F-format serials are rejected.
- D/E require a design choice and one of the catalog's ink colors. Changing amount
  or design clears the previous color. Unknown choices never acquire a default.
- Swatches are approximate aids; textual color names and instructions remain present.
- OCR stays behind the existing `?debug=timing` gate. Its candidate-to-input path and
  parser are retained. It does not identify a design or ink color for the user.
- Exact matches reuse the stage-2 UUID and transaction. A recent match creates no
  duplicate and provides a read-only journey link.
- Legacy same-serial/same-amount matches require an explicit confirmation. The text
  says identity cannot be determined, not that the physical notes are different.
  Confirmation is bound to the current four-part identity. Cancel makes no write.
- New independent records keep the legacy UUID, index and history intact.
- Successful rediscovery is adapted to the existing CelebrationModal result type.
  If a committed result cannot be read, the message says it might be saved and asks
  the user to search; it does not claim the registration failed to commit.

## Search

- Valid old-format serials generate 16 v2 exact gets; F format generates 3.
- One legacy exact get is added. No index query/list or reverse-identity read occurs.
- Only matched public bills are loaded, not their entire histories.
- Results distinguish amount, series, ink color and legacy unknown metadata.
- Viewing is explicitly separate from registering a rediscovery.
- Any failed index/public get fails the whole search rather than showing no match.
  Permission, connection/readiness and genuinely missing results have distinct UI.
- Request versions invalidate responses after edits, newer searches or unmount.

## Verification and reproduction

- Unit suite: 104 existing tests plus 10 stage-3 tests.
- Stage-2 regression: `npm run test:rules:v2` (56 adapted strict scenarios,
  152 identity integrity tests including parent, 13 access-budget tests including parents).
- Optional browser suite: `node test/identity-ui.browser.mjs` with Playwright supplied
  via `OSATSU_PLAYWRIGHT_MODULE` if it is external. An existing Chromium can be
  supplied with `OSATSU_CHROMIUM_EXECUTABLE`. No npm dependency was added.
- The browser suite **resets the dedicated demo project** and seeds synthetic records.
  It temporarily loads a deny-index-read Rules variant into the emulator only to
  verify permission errors, then restores the candidate Rules in `finally`.
- It blocks production Firebase network destinations and asserts zero attempts.
- Only in saved screenshots, the existing DEV-only TimingMonitor is hidden to
  keep it from obscuring the inspected modal. Its product code is unchanged.
- Screenshots/results default to `/tmp/osatsu-v3-ui` (not tracked by Git).
- Desktop Chromium emulation does not replace physical iOS/Android verification.
  Actual camera/OCR capture and real Google sign-in remain manual checks.

## Publication boundary

Stage 3 is ready for emulator review, not production activation. The v2 flag remains
DEV-only. Stage 4 must separately review publication sequencing, paused writes,
old-client rejection and rollback; publishing this UI alone does not migrate or
activate v2 production registration.

## Final results (2026-10-12)

| Check | Result |
|---|---|
| Units | 114/114 passed (104 existing + 10 new) |
| Strict Rules scenarios | 56 passed |
| v2 integrity suite | 152 passed |
| Rules access budget suite | 13 passed |
| JA/EN at 320, 375, 390, 430, 1280px | All 10 combinations passed |
| Screenshots | 95 saved in `/tmp/osatsu-v3-ui` |
| Browser cases | hold/cancel, mismatch, legacy confirmation, independent UUID, exact rediscovery modal, F/¥2,000 first registrations, multiple candidates, language switching, stale responses, missing record, offline/read denial, simultaneous registration |
| Production Firebase requests attempted by QA browsers | 0 |
| Typecheck, lint, build, diff check | passed |

Two pre-existing lint warnings remain (RegisterView selectedCity dependency and
CropModal effect state), with no new warnings. The existing >500KB chunk warning
remains. With `VITE_USE_FIREBASE_EMULATORS=true npm run build`, built JS contains no
`identity-v2-emulator`, demo project identifier or `127.0.0.1:19099` marker.
Screenshots emulate desktop Chromium viewport sizes, not physical mobile browsers.
Actual camera capture/OCR worker interaction and real Google OAuth were not tested.
Unit OCR parsing and Auth/Google synchronization regressions passed; emulator
integrity tests cover Google credential linking without contacting Google.

### Stage-3 changed files

- `src/App.tsx`
- `src/components/RegisterView.tsx`
- `src/components/SearchView.tsx`
- `src/components/BillIdentityFields.tsx`
- `src/services/firebase.ts`
- `src/services/billIdentityUiService.ts`
- `src/utils/billIdentitySelection.ts`
- `src/utils/identityEnvironment.ts`
- `src/utils/identitySearch.ts`
- `src/types/index.ts`
- `src/i18n.ts`
- `src/index.css`
- `package.json`
- `test/identity-ui.test.js`
- `test/identity-ui.browser.mjs`
- `docs/bill-identity-v2-ui.md`

The existing uncommitted Stage-1/2 catalog, registry, candidate Rules, tests and
report are retained. Stage 3 made no additional Rules/index changes.
