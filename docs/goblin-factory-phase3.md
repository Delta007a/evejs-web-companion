# Goblin Factory Phase 3 — implementation and live QA boundary

Date: 2026-09-27. Base: `3b2ac7354549511b1f2db8ecda514798b0000799`.
Worktree: `30-pilot-training`, branch `feature/pilot-training-readonly`.

## Result

Implementation is mechanically verified. End-to-end live acceptance is **blocked before character creation**.
The current runtime has no account `BMiner10`:

- Owner-process account lookup: `ACCOUNT_NOT_FOUND`.
- WC30 existing-account authentication: HTTP 401 `UNKNOWN_EVEJS_ACCOUNT`.
- Yandex Factory showed the refusal. The error presentation now explicitly explains that the account does not exist and Factory does not create accounts.

No account or character was created. No gameplay session was acquired, GM command dispatched, invitation sent/accepted, skill purchased, ISK transferred, or queue changed by this QA. No substitute account/pilot was used. EVE client was not operated; Chrome was not touched.

## Implemented

- Reuse `CharacterCreate.svelte` directly from standalone Factory for an explicitly selected authenticated account. No new doll/appearance implementation or automatic cockpit selection.
- New account-scoped creation guard on the existing create-with-doll route. Strict account roster/advertised slot decoding, name preflight, one in-flight creation per account, authoritative post-create roster verification.
- A lost/ambiguous response never resends creation. Existing matching names recover their character ID; unresolved completion remains latched. Reopened forms consume authoritative recovered IDs. Network errors and malformed success responses require recovery; definite pre-dispatch refusals remain correctable.
- Optional explicit Venture/Pioneer/Procurer target in the existing browser-local pilot preferences. No migration or fitting-key changes. Null retains automatic next-stage/current-stage mastery behavior.
- An explicit Pioneer target works before Venture is proven. Requirements still derive from the accepted corporation fitting and recursive dogma closure.
- Target binds the report, plan fingerprint, stored acquisition review, stored queue review, and every post-action reread. Other-tab local target/mode changes invalidate review/apply.
- FAST/BALANCED/MASTERY formulas, queue append rules, financial authority, session ownership and Release implementation remain unchanged.

## Local environment and processes

Only ignored WC30 `.env` key `EVEJS_ROOT` changed:

`G:\EVESP\EveJS-CodexLab\EveJS-0.12.9-Beta-test`
→ `G:\EVESP\EveJS-CodexLab\EveJS-0.12.9-test`.

No separate game-store/SDE overrides were present. Other values were preserved. Static loader resolved the current runtime's game-store/SDE paths, Venture, Astrogeology, and target station. `.env` is not committed.

Only WC30 was restarted, from PID 2164 to PID 37276 (17:32:19 local). Runtime PID 48292 was not restarted. Both were left running. No runtime source/config/mod changes or runtime patch/hash-manifest updates were needed. Protected worktrees and clean reference were not modified.

## Verified identities and location

- Current static station: **60010825**, system **30004504 / 4C-B7X**.
- Authoritative name: **4C-B7X V - Moon 7 - Chemal Tech Factory** (the request says “Chemical”).
- Source-verified command: **`/tr me 60010825`**, through normal cockpit Settings → `slash.SlashCmd`. It was **not executed**.
- Owner-process `corpmgr.GetPublicInfo([98000002])`: **Marked By Luck**, CEO **140000011**.
- Owner-process account roster confirms CEO character **CEO**, owning account **CEO / 6**, corporation **98000002**. No CEO login occurred.
- Corporation acceptance must be checked by rereading actual corporation membership, not merely the client's acceptance acknowledgement. Refresh Factory roster afterward to rebuild corporation-bound fitting reads.

## Live acceptance matrix

| Requested check | Result |
|---|---|
| BMiner10 empty account / character ID | Account absent; no character ID |
| Exactly one creation / idempotency | No live create; covered by targeted tests |
| MINER / explicit PIONEER / FAST | Implemented and mechanically tested; not assigned to a nonexistent pilot |
| Teleport / dock / Release button | Not performed |
| CEO invite / trainee acceptance / final membership | Not performed |
| Pioneer fitting ID/name/fingerprint acceptance | Not selected; expected name remains `Poineer Corp`, requiring owner/ID/hull validation later |
| Missing skills / personal wallet / shortfall | Not read for a nonexistent trainee |
| Funding authority/division / purchased skills | None used; no funds or purchases |
| Factory session cleanup | No Factory-created sessions in this QA |
| FAST → PIONEER queue entries / verification / ETA | Not applied; no live ETA |
| F5 | Updated standalone Factory loads; target/fitting persistence covered by tests, not BMiner10 live acceptance |

## Validation

**131 backend tests passed**, no skips:

`characterCreation`, `bridgeCharacterCreate`, `pilotTraining`, `pilotTrainingFittings`, `pilotTrainingRoute`, `pilotTrainingQueue`, `pilotTrainingQueueRoute`, `factorySessions`, `factorySkills`, `factorySkillsRoute`, `factorySkillAcquisition`, `factoryRuntimeGateway`, `bridgeSession`.

Current static/runtime fixture roots were explicitly set to `EveJS-0.12.9-test`; runtime method verifier uses mocks, not gameplay.

**28 frontend tests passed**:

`training/factory`, `training/factoryClient`, `training/fittingSelection`, `ui/skillAcquisition`, `app/createCharacterFlow`, `app/characterCreationSafety`.

**2 focused existing `flow.test.ts` Release tests passed** (`--test-name-pattern=releaseSession`).

TypeScript, `npm run build:web`, changed-JS syntax checks and `git diff --check` passed. Build retains pre-existing accessibility/chunk-size warnings. No unrelated suites, profiling or full-tree sweeps.

## Independent research/review

- GPT-6 Luna / High: reusable creator, slots/name/completion, GM route and station exploration; read-only.
- GPT-6 Sol / High: corporation lifecycle, CEO identity, financial/session/queue ordering; read-only. Reused for independent implementation review.
- Root independently inspected target-stage propagation and decisive creator/runtime source. A third explorer could not be allocated due thread capacity; no disallowed model was substituted.
- Reviewer found reopened-creation recovery and ambiguity classification defects. Root fixed them and added regressions. Final disposition: **no remaining actionable findings in reviewed scope**, without claiming live completion.

## Limits and next live boundary

Creation serialization/uncertain-result latch is WC-process-local. Same-name roster recovery survives restart, but this is not a new cross-client transactional/idempotency API. The runtime itself advertises three slots but its existing creator does not enforce that count; WC checks it before dispatch. Runtime creation through another client is outside this WC lane.

Make the intended existing account `BMiner10` available, then resume by rereading its roster before any create. Do not recreate a character if prior manual work has already completed it.

Resume the authorized sequence: creator → explicit MINER/PIONEER/FAST → ordinary cockpit teleport → Hangar Release → normal EVE-client CEO invite and trainee acceptance → logout → Factory membership/fitting refresh → accepted Pioneer contract → separate skill acquisition and FAST queue review/apply → authoritative reread/F5/no duplicates.

Only if a genuine funding shortfall exists: use an explicitly configured eligible source, or enumerate authoritative CEO Account Take divisions. The current UI's Division 1 default is **not** evidence of a configured choice. Multiple eligible divisions require user selection. No funding choice was made here.
