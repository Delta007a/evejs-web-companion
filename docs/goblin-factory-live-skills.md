# Goblin Factory: live skill acquisition and pilot release

## Scope and baseline

- Worktree: `G:\EVESP\EveJS-CodexLab\EveJS-WebCompanion\30-pilot-training`
- Branch: `feature/pilot-training-readonly`
- Initial HEAD: `041ce1dfbf426aa5fe1f727ef09cc599f4910ae5`, initially clean.
- Mutable runtime: `G:\EVESP\EveJS-CodexLab\EveJS-0.12.9-test` (not Git).
- Runtime entry point is `server/index.js`; changes belong to `server/src`, not the separate root `src` tree.
- Clean reference, other WC worktrees, first-party mods and runtime configuration were not edited. No merge or promotion.

## Audits and independent review

Read-only investigations completed before edits:

| Agent | Model / reasoning | Verified findings |
| --- | --- | --- |
| direct_skill_buy | GPT-6 Luna / High | Ordinary selection can take over an existing login. Factory needs a final free-only guard immediately adjacent to synchronous SelectCharacterID. Persistent gateway handles provide the live session authority. |
| ux_audit | GPT-6 Luna / High | Pilot Hangar owns local flow instances; Factory is standalone. Reuse current account authentication, fitting configuration and queue review. A roster entry alone does not prove a pilot is online. |
| corp_skill_funding | GPT-6 Sol / High | Direct PurchaseSkills charges the session character and injects skills without a book or queue write. Corp transfer uses the officer's corporation and division Account Take authority. Its null acknowledgement needs financial verification. |

Root independently inspected the decisive paths and made all edits. The Sol reviewer then reviewed ownership, financial authority, transfer/purchase ordering, race handling, partial failures, release and queue isolation. One P2 finding was fixed: preserve `offline` across runtime HTTP and WC client, and require both `released:true` and `offline:true` for Factory cleanup. SESSION_NOT_FOUND also requires an authoritative offline reread. The reviewer rechecked the fix and found no actionable bot handoff/release regression. This was a source review, not live corporation-funding verification.

## Authority and session lifecycle

WC routes (existing Training authentication):

- `GET /api/pilot-training/ownership?characterID=...`
- `POST /api/pilot-training/skills/review`
- `POST /api/pilot-training/skills/acquire`

The BFF authenticates the trainee account, checks ownership, derives missing injected skills from the existing exact queue preview, and binds a one-shot review to account, authenticated web session, pilot, mode, stage and accepted fitting/plan fingerprint. Funding uses a separately authenticated officer token; submitted account IDs, totals and transfer amounts are not financial authority. Tokens and live handles stay out of browser persistence and logs.

The gateway's protected routes are `/_evejs-web/v1/factory/session`, `/factory/quote`, and `/factory/acquire`. They are dedicated actions; generic PurchaseSkills access remains closed. The same methods are registered in the gateway owner-process protocol.

Factory reserves the character in WC's existing character-operation map. It refuses bot claims, local held sessions, recovery and every other online/control owner. Even the caller's existing cockpit session is not borrowed. Runtime repeats account ownership, offline control and session-registry checks immediately before synchronous normal `charUnboundMgr.SelectCharacterID` dispatch. It never uses ordinary login takeover to acquire a pilot.

Runtime marks the resulting handle Factory-owned. Purchase derives its character from that handle, verifies the reviewed identity and persisted account/corporation, and calls ordinary live services. During an awaited financial action, normal login takeover, explicit release and idle sweep cannot interrupt the session. Sessions are released in `finally`, officer then trainee, using only the exact Factory-owned handles. Cleanup failure remains RECOVERY/FACTORY_SESSION_RELEASE_FAILED, prevents queue handoff and keeps the local reservation until authoritative offline proof. Abandoned idle Factory handles expire after 60 seconds, on the regular sweep; an in-flight financial action is not force-reaped.

No cockpit, botHost claim, Overview or space snapshot is used by Factory. Ownership refresh is bounded and user driven; no fast polling was added. Unknown external owners are OTHER_SESSION, not falsely identified as MCC. This checkout has no authoritative MCC-specific owner label.

## Buy Skill and funding

- Reads: live `skillHandler.IsSkillAvailableForPurchase(typeID)` and `GetDirectPurchasePrice(typeID)`.
- Mutation: live `skillHandler.PurchaseSkills([typeIDs])` on the trainee session, in deterministic type-ID order.
- Postcondition: authoritative `isSkillInjected` and wallet reread, followed by the existing WC skill report.
- No market order, inventory skillbook, skillbook movement or queue mutation.

Character wallet is the default. Optional corporation mode requires an explicitly selected, free, separately authenticated officer and an explicit division key 1000–1006. Persisted Account Take authority is checked for that division. The trainee needs no corporation wallet roles.

Total, prices, injected skills, personal balance, corporation membership, officer identity/permission, selected division and corporation balance are reread at execution. Any review difference requires another review. Reviews expire after three minutes and cannot be replayed.

The only transfer is `max(total - personal balance, 0)`, represented in cents for comparison. It uses normal live `account.GiveCashFromCorpAccount(traineeID, exactAmount, division, reason)` through the officer session. Recipient identity is server-held; same-corporation membership is explicitly enforced above the normal transfer service. A unique reason must match both the corporation debit and trainee credit journal entries before purchase proceeds. Identities, prices and expected balances are rechecked after the awaited transfer. No direct corporation payer override is introduced.

PurchaseSkills accepts a batch, but wallet debit and subsequent skill grants are not one atomic transaction. Transfer and purchase are also separate operations. Partial grants, failed purchases after funding, ambiguous transfer/transport results and failed rereads are reported distinctly. Purchased/missing skill IDs, funding, remaining wallet and verification state are retained in the result. No synthetic rollback, clawback or blind retry occurs. Any retry requires a new review and excludes already injected skills. Existing wallet journals remain the financial record.

This is not transaction-wide isolation against every external wallet producer. Concurrent changes detectable by revalidation stop the operation; failures after a committed debit can leave funds spent or retained. The result does not claim atomic rollback. An authority call that never settles can retain a guarded session until the runtime resolves or restarts; this implementation deliberately does not force logout during ambiguous finance.

## UI and queue separation

The acquisition panel appears for SKILLBOOK_REQUIRED after queue review. It shows each direct price, total, personal balance, shortfall, explicit funding identity/division, blockers and the exact action sequence. Review creates only temporary sessions/read results; money moves only on the explicit Acquire button. Outcome and cleanup are shown separately. The last acquisition result is memory-only and disappears on F5; accepted fittings, role/mode and the existing last queue-apply record keep their existing persistence keys.

Successful acquisition releases the Factory session before offering a new queue review. The queue is never applied automatically. The existing offline append-only writer, state-version protection, fitting/plan fingerprint and post-write verification are unchanged. FAST/BALANCED/MASTERY targets are unchanged. Training ETA still uses authoritative queue timestamps with the runtime's effective training speed (current config 50).

Pilot Hangar exposes Release only for an interactive pilot owned by this tab, with no bot, travel or unresolved recovery. The server checks expected pilot identity, bot claim, recovery and shared operation reservations. Unconfirmed release retains the held handle and client pilot state. Bot Stop/logout remains on its existing path. Roster-only pilots say NOT IN THIS TAB, which is deliberately not an offline assertion.

## Runtime patch and provenance

Tracked deliverables:

- `runtime-patches/factorySkillAcquisition.js`: new deployed runtime helper.
- `runtime-patches/live-factory-gateway.patch`: focused zero-context changes to four existing files (requires `--unidiff-zero` if using git apply; verify original hashes first).
- `runtime-patches/runtime-hashes.json`: full original/new SHA256 plus clean-reference hashes.

Touched runtime files:

1. `server/src/_secondary/express/evejsWebGatewayRuntime.js`
2. `server/src/_secondary/express/evejsWebGateway.js`
3. `server/src/edge/gateway/gatewayRuntimeProtocol.js`
4. `server/src/services/character/charService.js`
5. New `server/src/_secondary/express/factorySkillAcquisition.js`

Focused pre-edit backups and QA logs: `G:\EVESP\EveJS-CodexLab\backups\goblin-factory-live-20260927`. All four original files matched the clean reference byte-for-byte; the scoped clean comparisons are beside those backups. Configuration and other runtime files were not copied or normalized. The new helper matches its tracked WC source byte-for-byte. Runtime has no Git commit. An upstream update may overwrite these distribution patches; check hashes before reapplying.

## Validation

Automated results on 2026-09-27:

- 107 passing backend/runtime tests, one static-data case initially skipped; that case was then run separately against EveJS-0.12.9-test and passed.
- 45 passing UI, fitting configuration, Factory client and queue-review tests.
- Both scoped `flow.releaseSession` tests passed (success and ambiguous failure preservation).
- Targeted runtime verifier executes deployed free-only selection/release method bodies with in-memory boundaries; it does not boot or import gameStore.
- Changed WC/runtime JS syntax checks passed. TypeScript typecheck, build:web and git diff --check passed. Existing accessibility/chunk-size build warnings remain.
- Eight adjacent bot handoff/release checks: three passed, five failed at DRONE_RECOVERY_PENDING fixture setup. The identical five failures were reproduced using `HEAD:src/server.js` in memory, proving they precede this patch. The initial combined test run containing the broader serverBots file stalled and was stopped; no unrelated bot code or fixtures were changed to hide it.

Focused commands:

```powershell
$env:FACTORY_RUNTIME_ROOT='G:\EVESP\EveJS-CodexLab\EveJS-0.12.9-test'
node --test test/factoryRuntimeGateway.test.js test/factorySkillAcquisition.test.js test/factorySessions.test.js test/factorySkills.test.js test/factorySkillsRoute.test.js test/bridgeSession.test.js test/pilotTraining.test.js test/pilotTrainingFittings.test.js test/pilotTrainingRoute.test.js test/pilotTrainingQueue.test.js test/pilotTrainingQueueRoute.test.js
node --test web/src/ui/skillAcquisition.test.ts web/src/ui/pilotHangar.test.ts web/src/ui/trainingQueueReview.test.ts web/src/training/factory.test.ts web/src/training/factoryClient.test.ts web/src/training/fittingSelection.test.ts
node --test --test-name-pattern='releaseSession' web/src/app/flow.test.ts
npm run typecheck
npm run build:web
git diff --check
```

## Live Yandex QA actually performed

Only the explicitly identified Yandex application/window was controlled. Chrome was not interacted with. The existing localhost Factory tab and normal account authentication were reused; no credentials were inspected. No runtime or WC listener was initially running. Started the authorized test runtime (`server/index.js`, PID 48292) and WC30 with its unchanged normal `.env` (PID 2164), hidden. They were left running for the user.

WC's existing EVEJS_ROOT still points to EveJS-0.12.9-Beta-test for static data; it uses the new runtime at localhost:26002 for authority. Six relevant hull/skill dogma records matched the new runtime in a scoped comparison, and the current-runtime closure test passed. This configuration was disclosed and preserved rather than silently changed.

BMiner9, accountID 40, characterID 140000041, corporation 98000002:

1. Confirmed PIONEER highest proven, PROCURER next, FAST, empty inactive queue, ownership OFF and accepted fitting selections after F5.
2. Confirmed missing unlocks: Astrogeology, Mining Barge, Medium Drone Operation.
3. Reviewed direct prices: 650,000 + 975,000 + 162,500 = **1,787,500 ISK**. Personal wallet **2,872,500 ISK**; shortfall zero.
4. Explicitly acquired those three using the personal wallet. All three verified injected; remaining wallet **1,085,000 ISK**. No corp funding/officer was used. Queue remained empty. Factory-created session released; ownership reread OFF.
5. Separately reviewed and applied FAST: Industry IV, Industry V, Astrogeology I/II/III, Drones II/III, Mining Barge I, Medium Drone Operation I. Nine entries, no prior entries, no blockers.
6. Queue write reread verified APPLIED; nine entries active. F5 preserved queue and fitting configuration. All unmet FAST target levels showed QUEUED; Factory summary showed TRAINING. Server-derived ETA approximately **3h 7m** at that observation. PIONEER remains proven; queued PROCURER requirements do not make PROCURER READY.
7. Re-review returned **Nothing to add**, 12 requirements trained, five already queued, zero additions. No second mutation.
8. Opened Pilot Hangar: zero pilots held in this tab and no unsafe Release actions offered. No pre-existing harmless interactive session was available, so actual Release-button logout was not live-tested. Returned to BMiner9's Factory tab. A separate Hangar tab opened by its navigation link remains.

Runtime logs independently show BMiner9 docked in station 60010825, both temporary sessions ending through browser_session_released, and a single nine-entry skill queue save.

Not live-tested: corporation funding/permission refusals, deliberate money races or partial financial failure, Release on an already held browser pilot, bot/MCC interruption, BALANCED or MASTERY. Those mutations were not manufactured for QA. Corp/session failure cases have focused automated coverage. No equipment, market, corporation roles or operations were changed.

Shortest follow-up QA: in Yandex open `/goblin-factory`, find BMiner9, retain MINER/FAST, inspect active queue and Nothing to add. Separately, when a safely owned docked browser pilot already exists, open Pilot Hangar and test Release; confirm its cockpit closes and Factory ownership refresh says OFF. Test corporation funding later only with an explicit authorized free officer and a real reviewed shortfall.
