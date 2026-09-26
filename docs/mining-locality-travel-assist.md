# Fleet locality and shared travel assist

Base: `c6613b3e8008678acb380857e1bb2ced89a95925`, worktree
`41-mining-operations-playable`, branch
`feature/mining-operations-playable-foundation`. No gameplay, service restart,
runtime/mod edits, live-data copying or promotion was performed.

## Source audit / authorities reused

- `src/server.js`, `/api/bridge/script/observation`: the existing combined read
  returns `space.ship.position`, ship mode and `solarSystemID`. Its held-session,
  ship and scene checks already reject an observation spanning a control/scene
  transition. Locality records only this validated observation and only for the
  operation associated with the caller's actual botHost claim.
- `web/src/nav/scriptMacros.ts`: BELT candidates already come from current-system
  snapshot entities with coordinates. Ore Anomaly and Ice candidates already
  have scanner site/instance identity and coordinates. No extra discovery read
  or remote system knowledge is needed.
- `src/miningOperations.js`: stored member state and botHost reconciliation own
  health/assignment. `src/miningTargetBoard.js` remains the atomic claim/lease
  authority; belt memory and existing site evidence still own depletion.
- `web/src/nav/scriptMacros.ts`, `mineWithRocks`: mining closes on a rock by an
  **orbit-at-5-km command**, then waits for range; it is not a literal approach
  verb. Container looting uses approach plus wait. Both use the shared runner and
  `autopilotLoop.measureSpace` surface distances.
- `src/staticData.js`, `getPropulsionEffectName`: SDE effect **6731** identifies
  Afterburner, **6730** Microwarpdrive. `flow.resolveScriptModuleCapabilities`
  already warms these effect facts and caches the fit. Travel-assist detection
  uses those identifiers and online fitted slots, not English module/group names.
- `web/src/nav/propulsion.ts` already owns capacitor and scram policy. The new
  helper delegates to it; existing companion/drone-boat propulsion is unchanged.
- Read-only local EveJS `src/services/dogma/dogmaService.js` and
  `src/space/runtime.js`: propulsion deactivation needs its specific effect;
  `repeat=0` establishes a one-cycle request. Existing WC activate/deactivate
  endpoints preserve that value, resolve deactivation effect from typeID, and
  return authoritative active/off confirmation. Runtime manual deactivation is
  deferred to the cycle boundary, so an accepted request is not an immediate off
  confirmation. No runtime changes were needed.

## Locality algorithm

1. Submit the normal same-family candidate set, including existing coordinates,
   in one reserve request. Filter family/system, malformed site identity,
   depleted/dry targets and other operations' claims before ranking.
2. Reconcile stored botHost state. Use only healthy MINER members with finite,
   same-system positions observed within **15 seconds**. HAULER positions never
   contribute. DEFENDER execution remains unsupported and does not contribute.
3. Score each candidate by **median centre distance** from those miners. The
   median resists a single outlier. A median under 150 km is diagnosed as
   `MAIN_BODY_AT_TARGET`; lower distance ranks first, with authoritative target
   key breaking equal-score ties.
4. If fresh anchors or reliable candidate coordinates are unavailable, use the
   previous deterministic target-name ordering, then identity to break ties.
5. Try ranked candidates through the existing synchronous reservation authority.
   No read/await/write gap, affinity, persistent previous-target ownership or
   cross-family fallback is introduced.

Freshness uses server request-start time, so a slow observation cannot refresh
old positions merely by arriving late. Warp/docked/unknown positions are not
anchors. Member locations are runtime-only and reset on operation start. Startup
uses the healthy members already observed; it does not wait for every pilot or
poll missing pilots. With only one fresh miner, that miner is the locality anchor.

BELT, ORE_ANOMALY and ICE all support locality when their existing data contains
valid coordinates. `targetPolicy: ANY_ELIGIBLE` remains backward-compatible:
eligibility has not changed; its ranking now uses `PREFER_FLEET_LOCALITY`.

A `TARGET_SELECTION` history event records selected identity, candidate scores,
anchor counts and locality/fallback reasons (at most 20 candidate summaries).
The MCC Target history includes collapsed **Locality decision** details. No
per-tick coordinate logging or new observation polling exists.

## Travel-assist contract

`policies.travelAssist.mode` accepts `DISABLED` or `AUTO`. Missing values remain
DISABLED, including old persisted definitions. New MCC UI drafts default to AUTO;
the checkbox is editable. Custom compatible routines use the same shared runner
path as Standard profiles. No profile documents or revisions changed.

`nav/travelAssist.ts` is a reusable, injected movement decorator, independent of
MCC profile/family logic. The current runner enables it only for operation-owned
resource/container movement (`mine-at-belt` / `loot-containers`), with valid target
authority and AUTO enabled. Station travel, docking/undocking and Parking are
intentionally not assisted.

- Need a known non-warp, undocked state, readable active-module set, and an actual
  approach/orbit intent with a measured gap. Waiting alone never creates intent.
- Begin assisting when the gap beyond the requested approach/orbit range exceeds
  **10 km**. Stop within **5 km** of that range, or before mining/looting interaction.
  This hysteresis avoids toggling at one exact boundary; existing interaction
  range checks still decide when mining/loot is legal.
- Choose **AB before MWD, then lowest module itemID**. Shared propulsion policy
  applies the 30% capacitor floor and MWD scram restriction. Missing/unknown effect
  metadata, no online module or an externally active prop leaves movement alone.
- Request one cycle (`repeat: 0`), not indefinite cycling. If it authoritatively
  ends while the same observed approach still needs assistance, the next normal
  runner observation may request another. There is no new cadence or retry loop.
- Track only the module this layer requested. Target/scope changes, lost authority,
  interaction and Stop/Parking turn that module off using its type-specific
  effect. Externally active propulsion is neither claimed nor switched off.
  Assignment/claim loss is handled before macro evaluation, including Ice's
  safety-return path, so a failed macro decision cannot bypass the off request.
- Activation refusal/unconfirmed activation is logged once and suppresses repeat
  activation for that approach key. Ordinary movement continues; it does not
  enter the script's fatal refusal ledger.
- Normal off requests are bounded to three attempts using ordinary observations.
  A refused off cannot leave an indefinite activation: the original cycle is
  finite. Stop/Parking request shutdown and wait for authoritative off on the
  existing bounded drone-cleanup observations (30 observations, two-second
  cadence, with the existing expiry deadline). While propulsion is pending, the
  combined observation replaces the drone-only read; it never adds a second
  snapshot/loop. If cleanup cannot be confirmed within that window, scoped Stop
  retains control and reports the reason. No false STOPPED.
- Propulsion commands consume one runner action opportunity; postponed macro
  memory does not advance. Drone settlement, container claims, movement checks,
  the operation assignment gate and graceful Stop remain in charge.

Diagnostics are state changes: activation/module/target, skipped reason, refusal,
cycle-off confirmation and deactivation. The helper has no world-read API.
Normal combined observations remain one space snapshot. Module commands retain
their existing action-verification reads; these are not a new polling loop.

## Verification

259 scoped tests passed: operation/locality/claim/policy/routes, static propulsion
effects, BFF drone/combined observation, travel assist/shared propulsion, actual
BELT/Ore Anomaly/Ice miner and hauler macro integration, runner, Parking, drone
swap, family profiles, site helpers and standalone MCC rendering/performance.
The BFF regression counts exactly one snapshot while recording member locality.
Typecheck (also included in `npm run build:web`), all seven changed/new JavaScript
syntax checks, web build and diff whitespace checks passed. The build reports
existing warnings in untouched UI components and the large App chunk. Focused
diff review covered all changed files; no generated build assets are committed.

## Manual QA (operator only)

1. On the isolated 41 build, put A's miners near Belt III and B's near Belt IX.
   Stop both; confirm both targets AVAILABLE. Start B first, then A. Expect IX
   for B and III for A. Inspect each `TARGET_SELECTION` locality reason/score.
   Repeat with IX claimed or dry: B must select another eligible free belt.
2. Explicitly enable AUTO on an old operation (old definitions stay DISABLED).
   Use an online AB/MWD miner with a resource well beyond mining range, or hauler
   with a distant container. Expect propulsion during closing, off near the
   target/before interaction, and normal mining/looting afterward. Repeat with
   no prop fitted and with AUTO disabled: ordinary movement must still work.
3. Exercise target change/loss and Stop/Parking while assisting. Only the owned
   prop should stop; drones/parking must retain their existing safety sequence.
   Stop one of two operations and confirm the other continues.
4. Repeat resource/container approaches for Ore Anomaly and Ice; verify family
   identity, logistics-tail bookmarks and explicit unload station remain intact.

No GAS, adjacent discovery, resource priority, Defender execution, auth refresh,
grant extension, general station propulsion or optimizer was implemented.

## Changed files

- Backend: `src/miningLocality.js`, `src/miningOperations.js`,
  `src/miningOperationPolicies.js`, `src/server.js`.
- Runner/UI: `web/src/nav/travelAssist.ts`, `scriptRunner.ts`, `scriptMacros.ts`,
  `scriptDecide.ts`, `scriptConditions.ts`, `miningDroneFlight.ts`;
  `web/src/app/api.ts`, `flow.ts`;
  `web/src/ui/MiningOperations.svelte`.
- Tests: `test/bridgeDrones.test.js`, `test/miningOperations.test.js`,
  `test/miningOperationPolicies.test.js`, `web/src/nav/travelAssist.test.ts`,
  `web/src/nav/miningOperationMacros.test.ts`,
  `web/src/ui/miningOperationsPanel.test.ts`.
- This audit/QA document.
