# Bill identity v2: stage 2 verification

This is a local candidate, not a deployed schema or Rules release. No production
Firestore reads/writes, Firebase Console changes, migrations, commits or deployments
were performed. The stage-1 variant catalog and identity-key utilities are retained.

## Environment and reproduction

- Node.js 26.10.0; Java 21; Firestore Emulator 1.20.4.
- Main demo project: `demo-osatsu-public-serial`.
- Access-budget-only projects: `demo-osatsu-rule-budget` and
  `demo-osatsu-rule-measurement`.
- Loopback Firestore 18080 / Auth 19099 / hub 14400 / logging 14500.
- Existing emulators on ports 8080/9099 were left untouched.
- Run `npm run test:rules:v2` with Node.js >=24, Java and Firebase CLI installed.
  The runner captures the actual Node executable because standalone Firebase CLI's
  PATH shim otherwise treats `--test` as a module filename.
- The test fixture reset/admin functions are loopback-only and demo-project-only.
  They create/delete synthetic emulator data, never migrate production records.

## Results

| Verification | Result |
|---|---:|
| Original strict suite before Rules changes | 56 passed |
| Same 56 security scenarios adapted to v2 under new Rules | 56 passed |
| New identity integrity suite (including node:test parent) | 152 passed |
| Access-budget suite (including node:test parents) | 13 passed |
| Existing units plus stage-1 identity tests | 104 passed |

The original positive registration cases now create the six-document v2 graph.
Legacy `serialIndex` get/list/update scenarios are still tested against an explicitly
seeded legacy fixture. Old five-document registrations are separately denied in both
v2 and paused modes. Expected-rejection helpers require `permission-denied`; a
network error or test-side exception cannot count as a successful denial.

## Structure and invariants

- `billIdentityIndex/{canonicalKey}`: authenticated exact get only; create only.
- `billIdentities/{uuid}`: clients cannot read/list; create only.
- Both hold the same four-part identity and must point to one another.
- Reverse creation requires that the public UUID did not exist before the operation.
- `publicBills/{uuid}`: public, with v2 series/color/version but no serial or key.
- `sightings/{id}`: immutable public records, with `identityVersion: 2`.
- `users/{uid}/trackedBills/{uuid}`: owner-only serial proof and personal metadata.
- `rateLimits/{uid}`: owner-only windows and a pointer to the operation's fresh sighting.
- `serialIndex` and legacy public records retain their read paths; their registration
  writes are denied. The retired `bills` collection remains completely denied.

Every initial operation creates all six documents atomically. A rediscovery changes
only public bill/sighting/private tracked/rate documents, keeping the UUID and both
immutable identity documents. The existing 15-minute bill cooldown, short limit of
10/10 minutes and daily limit of 50/24 hours are preserved.

`rateLimits` is the only place consulting `appConfig/billRegistration`. Its write
requires a sighting that did not exist before the request. Reciprocal checks bind the
bill, new sighting and actor's rate/tracked documents to the same operation.
Reusing an existing rate pointer cannot satisfy those checks.

## Measured access budgets

The measurement loads instrumented copies of candidate Rules only into a separate
demo project. It adds distinct existing sentinel `get()` calls until a request hits
the access-call limit. Individual operation probes are calibrated separately from
whole-batch probes. The checked-in candidate Rules contain no sentinel accesses.

Boundary controls independently confirmed:

- 10 distinct calls for one operation pass; 11 fail.
- A batch with 20 distinct calls passes; 25 fails.

On the final run, an initial six-document write accepted 17 added sentinel calls
and denied the 18th while each instrumented operation remained below its own limit.
Thus the initial operation consumed **3 calls counted toward the emulator's batch
limit**, reflecting caching of documents in the write set. This is an observed
emulator result, not a promised production cache behavior or a billed-read count.
Per-operation residual counts varied with shared-cache evaluation and are not
summed to infer batch consumption.

The source-level bounds without relying on cache reduction are:

| Initial write | Calls |
|---|---:|
| Forward index: reverse after | 1 |
| Reverse: index after, bill after, bill existence before | 3 |
| Public bill: tracked/sighting/rate after | 3 |
| Sighting: bill/rate after | 2 |
| Tracked create: bill existence before, bill/reverse after | 3 |
| Rate: configuration before, sighting after, sighting existence before | 3 |
| Total | 15 |

Rediscovery with an existing tracked document has an upper bound of 11 calls;
rediscovery creating another user's proof has an upper bound of 12. The largest
individual write has four calls. All these branches passed the emulator's limits.
No design relies on the observed reduction to three calls.

## Attacks and compatibility exercised

- All 62 nonempty proper subsets of the initial six-document write denied;
  independent admin inspections confirmed no new bill/index/reverse/sighting/tracked
  documents after each denial.
- Single alias, alias plus reverse rewrite, and two keys targeting one fresh UUID
  denied. Unchanged index/reverse sets, updates and deletes denied.
- Incorrect index/UUID/identity/step/rate pointers, invalid variants and serials,
  public serial fields and serials embedded in notes denied.
- Missing/replayed rate writes, public-only/sighting-only writes, rate plus index,
  reused prior state and all single rediscovery omissions denied.
- Paused, absent and malformed gate settings denied; clients cannot change the gate.
- Other-owner private reads/writes, reverse reads/list and forward list/query denied.
  Authenticated exact forward lookup remains allowed when the full key is supplied.
- Legacy public/sighting/index/private records remained readable at their original
  UUIDs; ambiguous registration made no writes. Confirmed separate registration did
  not alter legacy bill/history/index documents.
- Google credential linking in Auth Emulator preserved anonymous UID. Signing in
  from another client returned that UID and could read old/new tracked records and
  register a new v2 record. No email/token/provider ID is stored in public data.

For existing private tracked records, only these fields may change:

`lastSeenSightingsCount`, `lastSeenAt`, `lastSeenMunicipality`, `notifyOnRediscovery`.

The count must be within the existing public count, changed timestamps must be
server timestamps, strings/booleans are validated, and all identity/ownership/UUID/
creation/first-registration fields remain unchanged. Missing baseline fields can be
initialized. Personal updates still work while registration is paused. New legacy
tracked records and deletes are denied.

`legacyAcknowledgedBillId` is an optional private UX annotation. It grants no
permission to attach a v2 identity to a legacy UUID or modify legacy history.

## Concurrency and transport findings

Concurrent registrations converge to one identity UUID and do not count the losing
initial request as a rediscovery. A forced race can yield `permission-denied` when
the emulator evaluates immutable-index Rules before reporting a version conflict.
The service performs read-only recovery only if its attempted creation was missing
the index and a different, matching, recently committed winner is demonstrable.
Other denied writes remain errors. A separate forced private-metadata version
conflict verifies actual SDK transaction callback retries.

Node SDK `disableNetwork()` did not reliably stop transaction RPCs in this
environment. The transport test therefore cuts an actual loopback TCP proxy,
verifies no registration writes, reconnects, and checks successful registration plus
an immediate repeat without duplicate history.

## Remaining scope

The registry service is deliberately emulator-only and not imported by the app.
The old UI/registration service is unchanged and will be rejected by candidate v2
Rules if connected to the emulator. Stage 3 must connect the v2 UI and preserve
legacy-read behavior before any rollout.

Real Google popup/Brave/mobile authentication and production Rules were not tested.
Physical authenticity and correctness of user-selected design/color cannot be
established by Rules. Fully supplied guessed identity keys remain an authenticated
exact-lookup limitation inherited from the existing privacy model.

The emulator integrity gate is passed for proceeding to local stage-3 UI work.
It is not approval to deploy Rules or enable production v2 writes.
