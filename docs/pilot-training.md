# Pilot Training

Open `/pilot-training` on the WC origin. `/goblin-factory` redirects here (308).
This standalone control plane does not restore a cockpit, claim botHost, or poll space.
The older `factory*` modules and login alias remain compatibility implementation details.

## Qualification contracts

An explicitly assigned role starts with zero configurations. Add ship lists hulls from
the pilot's current corporation fitting library, then filters fittings by hull. Up to
three ordered configurations per role are supported. Creation order is progression
order; the same hull with different fittings is allowed, duplicate owner/fitting pairs
are refused. Edit retains the configuration ID; Remove clears a removed explicit target.

Each contract stores `configurationID`, `roleID`, `order`, `corporationOwnerID`,
`fittingID`, `hullTypeID`, accepted saved date/content fingerprint, and an optional
versioned support-policy key. A target is a configuration ID, never a name/index.
The user may directly target a later contract without waiting for earlier ones.

FAST derives the recursive maximum-level dogma closure from the accepted hull and
validated fitting contents. No fitted drones means no invented drone requirements.
Existing MINER Basic/Intermediate/Advanced support packages preserve the prototype's
BALANCED/MASTERY behavior. Other roles, including custom role IDs, have generic FAST;
unsupported support modes are disabled. Role/account names are not inferred.

Only actually trained hard requirements establish READY. Queued/training/unknown
remain distinct. Missing or changed/unaccepted fitting authority fails closed.
Equipment stays UNKNOWN. Qualification does not prove inventory, fitting or duty readiness.
ETA still uses authoritative runtime queue timestamps; uncovered plans remain UNKNOWN.

## Browser configuration and migration

`pilot-training:config:v2:<account>:<characterID>` is the single active document for
role, plan mode, target configuration ID and all role configurations. Valid old
`pilot-training:miner:*` selections and `goblin-factory:pilot:v1:*` preferences migrate
once. Only selected contracts migrate; accepted date/hash are preserved. Deterministic
legacy IDs make the migration idempotent. Old keys remain inactive backups, so removing
a migrated contract does not recreate it on F5. Invalid data is retained and reported.

`pilot-training:settings:v1` stores browser-local onboarding, explicit training wallet
and resolved home settings. Fresh defaults are disabled/NONE/unconfigured. It stores
an account/character selector key for authority, never passwords, tokens or sessions.
Change Dedicated non-CEO authority to use a later purpose-created service character;
that character must already be authenticated, free and an authorized Director.

## Optional corporation onboarding

The WC BFF owns temporary account/web-session-bound reviews at
`POST /api/pilot-training/onboarding/review|apply`. Both identities and corporation
state are reread. The authority must be a persisted non-CEO Director of the configured
corporation. Neither source nor target CEO can be acquired, and the runtime repeats
the CEO check synchronously before selection. Busy pilots fail without takeover.

Existing `corpRegistry` authority performs InsertApplication, officer
UpdateApplicationOffer (offer=6), trainee UpdateApplicationOffer (accept=2), then
membership reread. Existing members skip the join. FULL_ACCESS_EXCEPT_CEO calls
UpdateMember and verifies all eight ordinary/grantable role fields plus unchanged CEO.
NONE leaves roles alone. Existing Directors and blocked-role members are protected.

Masks are pinned to EveJS 0.12.9 `corporationRuntimeState.js`:
FULL_GRANTABLE_ROLE_MASK = FULL_ADMIN_ROLE_MASK minus CORP_ROLE_DIRECTOR;
FULL_LOCATIONAL_ROLE_MASK covers deliveries/hangar/container rights. Decimal strings
preserve all 64 bits. This grants broad ordinary and delegation rights, including
wallet/hangar access; it does not promote to Director or transfer CEO ownership.

Join/role operations are sequential, not an atomic transaction. Each step is verified.
An ambiguous failure stops without replay or synthetic rollback; completed changes
remain. Temporary sessions release in reverse order, and uncertain release retains
recovery protection. Automatic onboarding runs only after confirmed creation when
explicitly enabled; existing pilots require review and confirmation.

## Funding, home and wallets

Corporation funding remains opt-in. An explicit corporation/accountKey is required.
Preferred SELF funding uses the trainee's own Factory session and authoritative
Account Take permission to transfer exactly `max(price - personal wallet, 0)` to
itself through GiveCashFromCorpAccount. Both wallet journals are verified before
PurchaseSkills. Optional fallback is a separately authenticated, explicitly selected
non-CEO officer. There is no automatic CEO fallback.

Prices, permissions, balances, membership and selected division are revalidated.
Changes require rereview. A transfer followed by purchase failure stays reported as
partial completion; no clawback, skill rollback or automatic queue application occurs.
Queue review/apply retains account ownership, offline state/version, fitting/plan
fingerprint, append-only behavior and authoritative post-write verification.

Home stores generic locationID/name/system/kind/capability. The current resolver
supports authoritative NPC stations and describes relocation as MANUAL_GM_ONLY.
Saving a home does not move a pilot. Player structures/citadels are explicitly
unsupported until their docking/relocation authority is established.
Legacy character-roster balances are no longer displayed as current wallets;
financial decisions continue reading live wallet authority.

## Runtime patch and validation

Apply `runtime-patches/pilot-training-generic.patch` only after the prior live Factory
patch, verifying `previousFeatureSHA256` and `newSHA256` in `runtime-hashes.json`.
Only the gateway runtime and Factory acquisition helper changed in this increment.
The tracked helper is identical to its runtime copy. Preserve all other runtime
changes and mods. Gameplay runtime startup uses the normal configured launcher only.

Focused tests cover generic contracts/migration, recursive fitting requirements,
explicit target binding across review/apply, authority/ownership, onboarding partial
failure, self-funding/journals, CEO races, sessions/release, queue append and UI labels.
Build/typecheck and changed-JS syntax checks are required. No broad gameplay suite.

## Local acceptance — 2026-09-27

BMiner10 (account 41 / character 140000042) migrated to one MINER contract:
`legacy-miner-pioneer`, corporation 98000002, fitting 11, Pioneer 89240,
Simulated Pioneer Fitting. Accepted date `134320560863130000` and fingerprint
`af4bc51ab0bf86c293b7aaf030083b6c062b9c4ceeb07adbb8310ba80b216a7b` survived F5.
Explicit Pioneer/FAST remained selected without duplicate configurations.

Its prior queue completed naturally during this task. Live UI showed 13/13 hard
requirements trained, skill qualification READY, equipment UNKNOWN, queue 0/150 idle,
ETA Already trained, and read-only FAST review Nothing to add. No new character,
skill purchase, financial transfer or queue application was made for this test.

With the user's explicit choice of BHauler1 (account 17 / character 140000022), the
existing-member rights grant returned ONBOARDING_VERIFIED. A separate authority read
confirmed all eight masks, Director bit zero and unchanged CEO 140000011. Both
BHauler1 and BMiner10 reread offline after cleanup. Fresh membership joining and
self-funding were mechanically tested; they were not repeated live for coverage.

Local settings persisted after F5: onboarding corporation 98000002, BHauler1 authority,
FULL_ACCESS_EXCEPT_CEO, training wallet accountKey 1000, home 60010825 resolved to
4C-B7X V - Moon 7 - Chemal Tech Factory / system 30004504. These are configuration,
not product defaults. No CEO session was acquired.

Independent Sol review found and prompted fixes for source-CEO exclusion, the
pre-selection CEO race, and historical receipt target labels. No remaining authority
bypass was reported in the final source review. Joining a genuinely new member still
needs separate live acceptance; no additional character was authorized for that QA.

Luna's final generic-model review also caught the completed-role BALANCED shortcut;
it now stays disabled without a support policy. The aggregate fitting-review status
is explicitly labeled as covering all configurations, independently of target validity.
A valid authoritative fitting with zero prerequisites is supported, while unreadable
skill state still produces UNKNOWN.

### Process ledger

| Process | Origin / parent | Outcome |
| --- | --- | --- |
| WC30 37276 | Pre-existing, parent 45520 already absent; node --env-file-if-exists=.env src/server.js | Stopped for restart |
| WC30 2616 | This task, parent 39840; attempted replacement | Exited with EADDRINUSE before serving; no survivor |
| WC30 13276 | This task, parent 50464; verified 127.0.0.1:26500 | Used for Yandex QA, then stopped |
| Shells 39840 / 50464 | Short-lived launch helpers | Already exited; no keepalive shell |
| Runtime 43188 | Pre-existing, normal launcher 24564 | Stopped through launcher for patch load |
| Runtime 19268 | Normal launcher 24564 | Left running intentionally with the same five loader mods |
| Launcher 24564 | Pre-existing, parent 15188 | Left running |

Final check: no listener on WC30 port 26500. No direct server/index.js runtime was
started. No unrelated WC worktree/process was stopped. `.env` remains ignored,
unchanged, and resolves EVEJS_ROOT to the current 0.12.9-test runtime.

### Runtime hashes for this increment

| File under server/src/_secondary/express | Previous feature SHA256 | Current SHA256 |
| --- | --- | --- |
| evejsWebGatewayRuntime.js | `5C5BDC55F4ED65560245333605767FBECC7C4B24035058A265FBA738EF6739AA` | `89235AC2A4D9BBF3E6F4D9332A13CFF6105EB93D3E30BF8DA0AF68B8375DC3C1` |
| factorySkillAcquisition.js | `792662130EABC7FAADBB0153FF5FA125EB95BB84536561663BAB04D7EE22D1E1` | `2CCE918E86B0BD20A2AA9FA2FA7AD374FC79CDE8D40F8196AD3488546A6F2F24` |

No runtime Git commit exists. The incremental patch, tracked helper and focused hash
manifest are committed in WC30. Other previous runtime patch files retained their hashes.

### Final scoped checks

- Consolidated feature/adjacent run: 231 tests passed, 0 failed, 0 skipped. This
  includes generic configuration/migration, onboarding, fitting, skill acquisition,
  self-funding, queue, auth, creation recovery, Pilot Hangar and frontend rendering.
- Separate selected `bridgeSession` release/logout tests: 6 passed (237 distinct
  scoped tests overall). No broad unrelated suite was run.
- `npm run typecheck` and `npm run build:web` passed. Existing unrelated Svelte
  accessibility and bundle-size warnings remain.
- Changed WC/runtime JavaScript passed `node --check`; `git diff --check` passed.
- The focused five-file runtime manifest matched; the tracked acquisition helper
  matched its runtime copy. No full-tree hash sweep was performed.
- Independent read-only reviews: GPT-6 Sol / High (authority/lifecycle/funding) and
  GPT-6 Luna / High (generic model/migration/UI). Reported issues were corrected and
  rereviewed; neither review left an actionable finding in its reviewed scope.

## UX polish and new trainee integration — 2026-09-27

Starting commit: `df9d1869054cd2a23afef4943422e6b33d239ef5` on
`feature/pilot-training-readonly`. This increment changes WC30 only. Runtime source,
mods, `.env`, role registry, qualification logic and gameplay mutation policies are
unchanged. Custom/future role taxonomy remains deferred.

### Settings

`GET /api/pilot-training/settings-context` authenticates the account, reads its owned
characters and uses `corpRegistry.GetCorporation` / `GetMember` without selecting a
pilot. It resolves corporation and wallet division names, checks corporation identity,
excludes CEOs and non-Directors from the authority choices, and rereads membership.
These are picker choices; existing mutation-time permission checks remain authoritative.
Unreadable choices are shown unavailable without erasing stored IDs.

The normal UI shows corporation name, authority character name, Full access (except
CEO), and named wallet divisions. The wallet normally inherits the selected corporation.
Previously saved different-corporation wallets remain preserved and visible under
Advanced details. Internal IDs and rights enum are read-only technical details.

`GET /api/pilot-training/homes?q=...` uses the existing static map search, restricted
to NPC stations and at most 25 results. Selecting a result calls the existing `/home`
resolver before saving. No relocation occurs; player-structure relocation remains
unsupported. The `pilot-training:settings:v1` schema/key is reused without migration
or new defaults. Fresh onboarding remains disabled/unconfigured.

### New trainee and account authority

`+ New trainee` opens an explicit account form. `Use existing account` stays a
separate existing-only login/character-creator path. Account/character names may
differ; same-name convenience only prefills the existing `CharacterCreate` component.
Its appearance, name validation, slot validation and ambiguous-create recovery remain.

Authority chain: `POST /api/pilot-training/accounts/create` -> `trainingAccounts`
-> `eveStore.createAccount` -> existing gateway `POST /_evejs-web/v1/account/create`
-> runtime `createAccount` -> account owner module and flush. WC does not write DB rows
or pass browser account IDs/roles. Registration, like normal WC login, has no prior
cockpit token; runtime `devAutoCreateAccounts` policy still controls availability.
Registration never sets the cockpit cookie. After authoritative confirmation the
flow uses normal isolated Training login and roster reread, then the existing creator.

The user explicitly withdrew the requirement to be independent of disabled password
validation. The current gateway stores an empty password hash and creates the same
GM/admin defaults as its existing development registration path. This increment does
not add production password registration. The form explains the limitation; password
confirmation is client-side, the value is used only for normal WC authentication,
cleared on every attempt/cancel, and never stored in Pilot Training preferences,
recovery markers, URLs or diagnostics. No password subsystem was changed.

Creation checks availability, dispatches once and rereads authoritative identity.
Ambiguous responses permit read recovery only through `/accounts/recover`. In-memory
pending guards use exact case-sensitive names and retain only unresolved attempts.
`pilot-training:pending-account:v1` in sessionStorage contains account/character names
only, allowing F5 recovery without resending creation. An existing account is refused
by new-create preflight. Recovered accounts with characters do not automatically open
another creator. A browser account-list persistence failure is a warning after the
authenticated in-memory creator handoff, not a lost successful creation.

### Validation and acceptance

- 179 distinct focused tests passed. The consolidated run passed 178 and skipped
  its optional runtime-data case; that case then passed separately with the current
  `.env`. Coverage includes account recovery, authenticated settings reads, bounded
  station search/resolution, unchanged settings schema, character creation safety,
  generic contracts, onboarding, funding, fittings, queue writes and UI rendering.
- TypeScript and `npm run build:web` passed; existing unrelated accessibility and
  bundle-size warnings remain. All changed JS files passed `node --check`.
- Independent GPT-6 Sol / High review corrected case-sensitive account guards,
  completed-attempt retention, competing page/form busy state and fallible browser
  persistence after authentication. Regressions passed; final review had no blockers.
- Yandex-only nonmutating QA: page loaded, new trainee form opened/cancelled without
  submission, existing BMiner10 authenticated without cockpit selection, station
  search by `4C-B7X` returned and resolved the correct Chemal Tech Factory, Advanced
  details retained the expected IDs, and F5 preserved settings. No new account or
  character was created, and no onboarding, purchase, transfer or queue apply ran.
- Existing saved values survived: Marked By Luck / 98000002, BHauler1 / 140000022,
  FULL_ACCESS_EXCEPT_CEO, Wallet Division 1 / 1000, home 60010825 / system 30004504.
  BMiner10 remained MINER, Pioneer / Simulated Pioneer Fitting, FAST, highest proven
  Pioneer, IDLE queue, Already trained ETA, equipment UNKNOWN. Accepted fit configuration
  remained unchanged. Password non-persistence was verified by source/in-memory tests;
  no password was submitted or saved during live browser QA.

### Process cleanup for this increment

- Start: no WC30 listener. Normal modded runtime PID 19268 was already running under
  launcher PID 24564 (`G:\EVESP\EveJS-Launcher-V1\EveJS-Launcher-V1.exe`).
- QA: WC30 PID 51180, short-lived helper shell PID 44916, port 127.0.0.1:26500.
  Started with `startServer({resumeServerBots:false})`; no persisted bots resumed.
- End: verified identity, stopped WC30 PID 51180, confirmed helper 44916 already
  exited and no listener remained on 26500. Runtime 19268 and launcher 24564 remain
  running with the original five mod loaders. No direct runtime process was started.
- No runtime files/hashes changed in this increment; no merge, push or promotion.
