# Tokeiito private integration handover — 2026-09-23

All seven selected features are **Implemented / mechanically verified / Requires gameplay verification**. None is gameplay accepted. No gameplay, live API calls, live bot attachment, service startup/restart, or deployment was performed. HTTP tests used test applications and fake gateway dependencies.

## Base and isolation

- Fetched `https://github.com/Tokeiito/evejs-web-companion.git`, branch `tokeiito`.
- Exact fetched base: `2dd519ce5a496a2067c4c731a4a3f86858b94f68`.
- This equals the audited base: there was no new upstream delta requiring another audit or an overlap stop.
- New linked worktree: `G:\EVESP\EveJS-CodexLab\EveJS-WebCompanion\20-integration`.
- Branch: `feature/wc-tokeiito-private-integration`.
- The implementation has a linear ancestry from that exact base. No private-history merge, rebase, or cherry-pick was used.

## Ordered implementation and verification commits

1. `02259f3a51ad77c5c295f7fdc53952c38602f8d8` — Restore bot credential lifetime and safe server handoff
2. `d3ac23cb584edbcebc316823b5edd8d6ea8b234f` — Reset loop invocation silence budgets and expire stale capacity refusals
3. `3c69954ee4651951b13b645241addc3ebec5312a` — Restore belt surface-distance short-warp arrival semantics
4. `9afbd0ead6f50e9152e431cc8a1dd1730eea1a08` — Coordinate hauler container leases through shared BFF authority
5. `51da6fe41d1e2d0d9a608ce0c946563ca9dc71d5` — Add Distribution levels 1 through 4 with authoritative lower-level fallback
6. `ed16c24780b91f93ca0a6d104c64f99cc80ad661` — Port mining drone harvesting and defensive swap to belt and site mining
7. `ed510283bb89e97a82a99572ec1de80feb019b51` — Rebuild manifest-owned corporate routes on upstream inventory primitives
8. `1d1659aba030af6124dfaf933ba5e7806c2a5b1f` — Close drone approval, interrupt and blind-travel safety gaps
9. `a100d95d46c8c1ff0d2334b0a66d30ff2efdca2f` — Verify private script compatibility and Distribution search constraints

The final documentation commit contains this report; its SHA and the final worktree HEAD are reported in the task's final response.

## A. Bot authentication and server handoff

Historical source: `36b061c`.

Current seams: `src/webAuth.js`, `src/botHost.js`, the held-session and bot-start routes in `src/server.js`, `callMethod.ts`, and app-flow controller lifetime handling.

Bot credentials cover the approved deadline plus five minutes of cleanup margin, within the existing maximum run policy. Stale held ownership is reconciled by asking the gateway about the actual session. Character/session reservations and confirmed release protect browser-to-server handoff; failures retain or restore the appropriate ownership. `AUTH_REQUIRED` ends browser controllers and clears their authenticated state. An expired, correctly signed credential may release its own stale ownership; a forged token cannot.

Not carried forward: replacement Pilot Groups/start UI or a parallel start authority. The existing group start/grant path remains in charge.

Targeted validation passed: `src/botHost.test.js`, `test/serverBots.test.js`, `test/webAuthSession.test.js`, `web/src/app/flow.test.ts`, `web/src/nav/scriptRunner.test.ts`; shared-start regression boundary `web/src/bots/groupStart.test.ts` and `startRun.test.ts`. Tests include expiry, forged credentials, stale ownership, handoff failure and competing starts.

Status: **Implemented / mechanically verified / Requires gameplay verification**.

## B. Loop and hauler lifecycle

Historical source: `6037d8b`.

Current seams: the invocation transitions in `scriptDecide.ts` and the existing `refusalLedger.ts`/`scriptRunner.ts` unload path. Re-entering a loop step resets its silence budget even when the path string is unchanged. Productive calls still reset upstream's silent-tick watchdog; elapsed wall time is not substituted for progress. Successful unloading expires ordinary and `NO_ROOM_ABOARD` refusals while preserving gone/unreachable entries. Corporate unloading also joins this room-recovery path.

Not carried forward: the old elapsed-tick watchdog implementation. Upstream's productive/silent-tick distinction remains intact.

Targeted validation passed: `web/src/nav/refusalLedger.test.ts`, `scriptDecide.test.ts`, `scriptRunner.test.ts`, including repeated invocation, productive long-running steps and durable refusal preservation.

Status: **Implemented / mechanically verified / Requires gameplay verification**.

## C. Corporate hauling

Historical sources: `46003f0`, `5b0d768`, `aa86820`, `624c64b`, `d81eabc`, `132f642`.

Current seams: upstream corporation-office/division reads, `CorpHangarPicker`, `planLootTransfers` (the planner used by upstream load-cargo), `pickedRows` item filters, station autopilot, and the existing inventory transfer endpoint. The private state machine is isolated in `web/src/nav/corporateHauling.ts` (156 lines).

Restored `haul-all` and persistent `route-hauler`, including filtered A-to-B and optional B-to-A loads. The manifest records only quantities proven to have arrived aboard, including quantities merged into an existing unrelated stack. Delivery moves only those owned quantities. Each transfer is followed by exact source and destination checks. Partial, missing, refused or ambiguous movement blocks the route. The BFF also checks the expected docked station, source type and source quantity before issuing the transfer.

The private route always addresses its corporation division explicitly. A missing or refusing corporation destination cannot become a successful personal-hangar delivery. Generic upstream `deliver-ore` and its fallback are unchanged. Automatic routing uses upstream specialised-bay eligibility and capacity rules; a full preferred specialised bay does not spill the load into generic cargo.

Not carried forward: the six-commit stack, duplicate bay router, duplicate corporation picker/office discovery, whole-hold ownership assumptions, or a global override of generic delivery fallback.

Targeted validation passed: `web/src/nav/corporateHauling.test.ts`, `web/src/app/corporateHaulingFlow.test.ts`, `test/bridgeInventoryDepth.test.js`; routing boundary `web/src/bridge/bayRouting.test.ts`. Changed script/editor surfaces were checked through `validateScript.test.ts`, `editorOptions.test.ts`, `macroCatalogView.test.ts`, `runPolicy.test.ts`, `scriptCodec.test.ts`, `scriptText.test.ts`, `ui/botInspector.test.ts` and `ui/botBuilderPanel.test.ts`. Cases cover merged stacks, strict destination refusal, source disappearance without receipt, partial transfer, bidirectional divisions, filters, incomplete names and specialised-bay capacity.

Status: **Implemented / mechanically verified / Requires gameplay verification**.

## D. Same-belt short warp

Historical source: `eaf9aa5`, equivalent to `b962e3d` by stable patch-id `c749220b2aa718e5d82f0d982f2740ee24a2a125`.

Current seams: `measureSpace`, the belt-travel/empty-belt decisions in `scriptMacros.ts`, and a shared belt warp-floor helper in `miningBotLoop.ts`. Local EveJS warp source was checked: asteroid-belt stopping includes the 2,500 m stop floor and twice the ship radius; the minimum warp travel is 150,000 m. In surface-distance terms the non-warpable threshold is `max(0, 150000 + 2500 + shipRadius - beltRadius)`.

The existing normal arrival radius still applies. A belt inside the non-warpable threshold is also reached, preventing repeated impossible same-belt warps. Cosmic-site point-distance/scanner refusal logic remains separate.

Not carried forward: a common belt/site distance rule or replacement of upstream stale/refused cosmic-site skipping.

Targeted validation passed: `web/src/nav/scriptMacros.test.ts`, `miningBotLoop.test.ts`. The directly owned macro file also exercises upstream site arrival/refusal behavior.

Status: **Implemented / mechanically verified / Requires gameplay verification**.

## E. Multi-hauler container coordination

Historical source: `ed393b9`.

Current seams: the shared BFF `lootMemory.js`, authenticated claim routes, current loot macros and refusal memory, `scriptRunner.ts`, and the app's container-transfer dispatch.

Claims use solar-system ID plus container itemID, with authenticated session plus run generation as owner. Another active claim excludes the target; the owner can renew. Five-minute leases recover abandoned targets. Claims renew while servicing, including before transfer writes. They release on successful loot, disappearance, target change, step departure, pause, stop, termination and session loss. Temporary action refusal does not itself release a valid target. Ambiguous authority responses fail closed.

Not carried forward: browser-local ownership guesses or the old runner/loot-memory wiring.

Targeted validation passed: `test/containerClaims.test.js`, `containerClaimRoutes.test.js`, `web/src/app/containerClaimApi.test.ts`, `lootDispatchFlow.test.ts`, `web/src/nav/containerCoordination.test.ts`, `scriptRunner.test.ts`. Cases include concurrent ownership, renewal/expiry, refusal, lifecycle release and an in-flight claim completing after stop.

Status: **Implemented / mechanically verified / Requires gameplay verification**.

## F. Mining drones and defensive swap

Historical source: `dd02cd2`.

Current seams: authoritative drone decoders and type-group resolution, a shared pure `miningDroneFlight.ts`, the existing classic mining loop, and a drone-safety wrapper around the upstream scripted miner. Scripted belt and site modes share the controller; scanner rotation and navigation memory only advance when their action is actually issued.

The controller runs mining drones while calm, recalls them on a hostile, waits for authoritative return, launches/engages combat drones, requires three consecutive clear observations, recalls combat drones, waits for return, then resumes mining drones. Quantities remain structured; top-up respects the actual active-drone limit. Unknown limit/state blocks launch. Travel, warp, hauling transitions and retreat wait for recall. A failed observation cannot authorize blind emergency travel. Existing fight-back watches cannot bypass the recall, quantity or three-clear gates. Opt-in scripted drone defense participates in upstream combat/destructive risk grants and is not automatically restart-safe.

Not carried forward: hardcoded typeID lists, command-ship drone integration, the old ore-anomaly roadmap, or replacement scanner/site rotation.

Targeted validation passed: `web/src/nav/miningDroneFlight.test.ts`, `miningBotLoop.test.ts`, `miningLadder.test.ts`, `web/src/bridge/drones.test.ts`; changed orchestration in `scriptDecide.test.ts`, `scriptRunner.test.ts`, `app/flow.test.ts` and `bots/runPolicy.test.ts`. Upstream site-mode boundary and drone integration cases run in `scriptMacros.test.ts`; upstream `groupStart.test.ts` checks the shared approval boundary.

Status: **Implemented / mechanically verified / Requires gameplay verification**. This is not gameplay acceptance of the previously unaccepted drone feature.

## G. Distribution delivery levels 2–4

Historical source: **only `c497e08` semantics**.

Current seams: the existing agent finder, route graph, agent conversation API, mission board/macros and script argument codec/editor. Preferred level is 1–4; optional fallback searches only lower levels. Candidates remain division 22, standard agent type 2, corporation-filtered, within the jump limit and nearest-first at each level. EveJS conversation responses determine accessibility; the browser does not calculate standings. Exhausted inaccessible candidates produce a cached failure and a blocked step rather than an infinite search loop. Upstream's pre-accept mission cargo-capacity gate is retained.

Not carried forward: the historical parent's mining-command feature, browser standings arithmetic or changes to the combat-agent finder policy.

Targeted validation passed: `web/src/nav/distributionAgentSelection.test.ts`, `scriptMissionMacros.test.ts`, and changed `bots/editorOptions.test.ts`, `scriptCodec.test.ts`, `scriptText.test.ts`, `validateScript.test.ts`. Cases cover levels 2–4, descending-only fallback, no fallback, unavailable candidates, division/type/corporation/jumps/nearest ordering, old defaults and the existing capacity gate.

Status: **Implemented / mechanically verified / Requires gameplay verification**.

## Preserved exclusions

- Upstream Pilot Groups and their approval/start semantics remain authoritative. `cbd3a44` was not ported; no private group store, UI or localStorage compatibility was added.
- `1c6aada` was not ported. No mining-command role, positioning/bursts/Core/fuel automation, command-ship UI/macros/config/tests or associated drone integration was added.
- Upstream ore-site mining remains the navigation base, including scanner reads, rotation, barren confirmation, interrupt recovery, already-at-site recognition, site-mode belt-memory avoidance and stale/refused-site skipping. No old anomaly roadmap was rebuilt.
- Upstream PI remains intact: no changes to colony attention, launch-commodities, recipes, planning arithmetic, ingredient/cost display, ownership/roster reads or global PI board/manager. Shared files contain only the selected integration changes.

## Saved-script decisions

- Existing `haul-all` and `route-hauler` names/argument shapes are preserved and tested. Return-leg divisions become required when the return toggle is enabled.
- An omitted `transportBay` now uses upstream automatic routing. Explicit `cargo`/`ore-hold` choices restrict those results; they cannot override upstream specialised-bay safety. This intentionally differs from old omitted-field cargo-only behavior.
- Route manifests survive pause/resume within a run. They are not reconstructed by claiming every item aboard after a process restart. These macros are not automatically restart-safe; reconcile cargo before a new run after an interrupted transfer.
- Legacy `deliver-ore` with `corpDivision` is refused by the codec. It is not silently translated into upstream `into`, because that generic path permits fallback. Reconfigure strict hauling as a private corporate route; use upstream `into` only when its generic fallback policy is desired.
- Saved Distribution finders lacking new fields retain preferred level 1 and fallback disabled. The document version stays 1.
- The new scripted mining `drones` toggle defaults to off when omitted. The classic miner retains its existing `useDrones` setting, now enabling mining plus defensive swap.
- Private Pilot Groups storage is intentionally not migrated. Mining-command scripts remain unsupported.

## Mechanical validation and limits

- All targeted files listed above passed; no full multi-thousand-test suite was run.
- `node --check` passed for all ten changed server-side/test JS files.
- `npm run typecheck` passed.
- `npm run build:web` passed. It reports existing Svelte accessibility/state-capture warnings in unchanged UI files and the bundle-size warning.
- `git diff --check` passed for the integration range and working tree.
- The final range was inspected for unrelated and excluded behavior.
- Dependency installation and build output are local to 20-integration; no runtime service was started.

Remaining uncertainties are gameplay-facing: actual transfer notification/stack timing and simultaneous manual corporation inventory changes; real drone control/return/type-group observations and limits across hulls; lease behavior during long network outages; belt radius/stop distances across actual ships; real higher-level mission offers, standing refusals and volumes. Exact two-sided net transfer checks deliberately stop on ambiguity, but are not a database transaction isolating other actors' inventory mutations. Claims coordinate one shared BFF process, not separate BFF deployments. The existing one-agent-per-run mission-board convention remains.

## Recommended gameplay QA sequence — for the user, not performed here

Use an isolated test deployment and disposable/low-value test inventory first. Stop the sequence at the first unsafe or unexplained result; retain the run log and before/after inventories.

1. **Import and approval:** load representative old mining, haul-all, route-hauler and Distribution scripts. Confirm omitted-field defaults, visible corporation destinations and upstream Pilot Groups/grants. Confirm legacy strict `deliver-ore` is rejected instead of weakened.
2. **Authentication/handoff:** test browser-to-server transfer, competing starts and a failed handoff. Exercise a shortened approved lifetime plus cleanup margin in the test environment; confirm expired signed ownership cleanup, forged-token rejection and terminal browser `AUTH_REQUIRED` behavior.
3. **Lifecycle:** repeatedly re-enter the same loot/wait loop path, then run a productive long invocation past the former elapsed budget. Fill/unload/retry a container; confirm ordinary/no-room refusals expire while truly gone/unreachable entries remain.
4. **Belt versus cosmic site:** test belt approach just below/above its ship-and-belt-radius warp floor, then cosmic point sites around 150 km and stale/refused sites. Expect no impossible same-belt warp loop and no regression in cosmic skipping.
5. **Single-load corporate route:** transfer a small filtered load A-to-B with unrelated cargo already aboard, including a same-type pre-existing stack. Confirm exact source/destination quantities and that unrelated quantities remain aboard. Repeat with a split and each relevant specialised bay; fill the preferred bay and confirm no generic spill.
6. **Corporate failures and persistence:** deny destination access/remove the office, simulate a partial/ambiguous move, and interrupt after a load. Confirm no personal-hangar success, no silent completion/retry, and manual reconciliation before a fresh run. Then test several A-to-B/B-to-A cycles with distinct filters/divisions and pause/resume during a leg.
7. **Two haulers:** put two authenticated runs at the same containers. Observe one claim per system/item, other-run exclusion and own renewal. Exercise temporary refusal, successful loot, disappearance, target/step change, pause, stop, session loss and abandoned-lease expiry. An unreadable claim response must prevent the action.
8. **Drone swap in both miners:** with authoritative drone roles and a small active limit, run calm mining, introduce a hostile, confirm mining recall before combat launch, engagement, exactly three clear observations, combat recall, then resumed mining. Test top-up from a stack larger than the limit, unknown limit/state, lost reads, refused launch and an existing fight-back watch.
9. **Drone navigation safety:** while drones are out, request belt travel, site rotation, hauling and health retreat. Delay/lose return confirmation. No travel may issue until return is authoritatively clear; failed ship reads must pause rather than bypass recall. Confirm site scanner/rotation resumes after recall.
10. **Distribution missions:** request levels 4, 3, 2 and 1 with fallback off, then on. Include inaccessible candidates, corporation/jump constraints and an oversized mission. Confirm no upward search, nearest accessible candidate within each searched level, bounded failure and the pre-accept capacity gate.
11. **Upstream smoke checks:** verify Pilot Groups approve/start, ore-site discovery/rotation/barren/recovery, and the PI board/ownership/roster views in the isolated deployment. Record gameplay outcomes separately; these mechanical results alone do not mark any private feature Accepted.

## Protected worktrees

Verified unchanged after implementation:

| Worktree | HEAD | Status |
| --- | --- | --- |
| 00-live | `eaf9aa5a9a50a408354b7e4f871749db05b76c54` | clean |
| 10-sprint | `c497e08a46996de548106083e0e6c372ac7ad682` | clean |
| 90-history-hauler-fix | `8cb71a11b22b41969b6b25f362a71f4f8261129c` | clean |
| 91-history-belt-warp-fix | `b962e3d32da52ea972e90c083fb2eb6911158f71` | clean |
| 92-history-farmer-latest | `fc0395e73e680f9a63a9913eee3e5554b112ac85` | clean |
| 93-history-corp | `fc0395e73e680f9a63a9913eee3e5554b112ac85` | clean |
| 99-legacy-upstream-checkout | `572da2e1f239c73af1ffd98bf9822c4beac4cb30` | only pre-existing `.env.example` dirty |

99's `.env.example` SHA-256 before and after is `567A17C742109C4D5619F9E7A312A6386B8DBB57E434EDD92CAFED25EEA4E746`. It was neither changed nor cleaned. Fetch/worktree/branch operations updated shared Git metadata only. 20-integration is not deployed to live.
