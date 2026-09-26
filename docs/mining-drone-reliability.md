# Standard BELT miner drone reliability — 2026-09-26

Base: `5008c01c3ba8c921d0911a2172803dd574714546` in the isolated
`40-mining-operations` worktree. No gameplay or service restart performed.

## Evidence and root cause

The retained overnight `data/bot-logs/{characterID}.jsonl` records for miners
140000015/17/19/20/23/24/27/28 each contain 33–34 jettison commands under
**Belt Miner / Hauler Service**, but **zero launchDrones, recallDrones or
mineDrones commands**. Revision 1 of `mcc.belt.hauler-service.miner` omits the
`drones` argument. `activeStepUsesMiningDrones` requires an explicit enabled
toggle; omission is disabled. Thus the Standard profile never enters automatic
mining/combat-flight management and cannot recover a mining flight in the bay.

The retained preceding custom-routine logs do contain drone commands. For
example, miner 140000015's previous run `muhay65q-jk9c` records recall at
18:41:43Z, jettison at 18:41:53Z, launch at 18:42:03Z and mineDrones at
18:42:08Z on September 25. Returned singleton drones are launched with quantity
1. This does **not** establish a late, intermittent relaunch failure in the
overnight Standard runs, nor identify when/how the flight seen by the user
entered the bay. It does establish the missing automatic-flight behavior.

Revision 2 explicitly enables drones; the hauler remains revision 1. IDs and
ordinary script execution/operation overlays are unchanged. Fresh Start/grants
are required: existing hosted runs keep their granted document/revision.

## Jettison and safety boundaries

The enabled mining step uses the normal drone wrapper. On an `until` step exit,
the wrapper recalls and waits for authoritative in-space disappearance before
advancing; it clears flight memory, so mining re-entry gets a fresh bounded
launch budget and a current observation. The combined space/drone read, returned
singleton decoding, combat swap, lost-drone recovery and Stop path are reused.

Ordinary jettison **still recalls**. The BFF jettison command itself has no drone
requirement. The current macro, however, confirms custody transfer by observing
an empty ore hold; mining modules are also stopped so continuing production does
not refill that hold. Removing recall without changing that completion contract
would introduce a separate inventory race, so it is not part of this fix.

An integrated safety test found another real interaction hidden while the
Standard profile had drones disabled: operation depletion/relocation can remain
inside the same `mine-at-belt` step. The drone wrapper's generic combat-watch
suppression could swallow that macro's recall. Operation settlement now carries
an explicit `settleDrones` intent to the same wrapper. It blocks partial dumps,
handoff and travel until the flight returns, and prevents relaunch onto a cached
rock while waiting for other miners. No new engine or target authority exists.

## Diagnostics

Existing issue/result lines identify recall, launch, mining orders and jettison
commands. Change-only `decide` lines with `says: mining drone lifecycle` add:

- explicit disabled/unreadable/no-target/no-quantity/no-slot/bounded-attempt reasons;
- authoritative recall confirmation, distinct from accepted recall commands;
- empty-hold jettison completion and mining re-entry;
- controlled-flight confirmation from observations, not write acknowledgements.

Steady mining does not repeat these lines per tick. No polling, cadence, retry
limit, drone balance or runtime API changed.

## Regression coverage and manual smoke

The actual profile passes through the codec, runner and real operation macros
for 40 full threshold/jettison/recall/relaunch cycles. Fixtures include returned
singleton wire quantities, delayed return, unreadable control state, target loss
after jettison, depletion with stale local rocks, relocation and graceful Stop.
The revision-1 omission is reproduced explicitly. Existing combat/Stop/recovery,
combined-observation, MCC authority and zero-dashboard-snapshot tests are retained.

For live QA, load the corrected WC build and start fresh Standard BELT /
HAULER_SERVICE runs (miner profile v2). Confirm mining drones on the initial
flight and after several jettisons; use the lifecycle log to distinguish command
acceptance from confirmed return/relaunch. With two operations, verify different
ACTIVE targets and a hauler unload/return cycle. At actual depletion verify drone
settlement before partial dump/relocation, the old target's DRAINING tail and
hauler catch-up. Stop one operation and confirm its drones settle without
stopping the other. Asteroid-volume changes remain the user's separate QA setup.

## Validation and changed files

All 239 tests passed in the focused group:
`miningOperationProfiles`, `miningOperationMacros`, `miningDroneFlight`,
`scriptDecide`, `scriptRunner`, `botLog`, bridge `drones`,
`scriptObservationRead`, `miningOperationsPanel`, backend `miningOperations`
and `miningOperationsRoutes`.

All 107 matching adjacent tests passed across `scriptMacros`, `botHost`,
`bridgeDrones`, `lostDroneRecovery` and `droneRecoveryGate`, using the name filter
`drone|Drone|deplet|jettison|mine-at-belt|belt|Stop|stop|expir|combined|snapshot`.
This includes combined-observation and scoped stop/expiry safety checks.

`npm run typecheck`, `npm run build:web`, `node --check` on both changed JS
files, `git diff --check` and scoped diff review passed. Build warnings concern
unchanged Svelte components and existing bundle size. The recorder's exhaustive
action fixture was already missing seven existing action kinds; it was filled
in without changing any action implementation.

Changed files:

- `src/miningOperationProfiles.js`: miner revision 2, explicit drone enable.
- `web/src/ui/MiningOperations.svelte`: display miner v2.
- `web/src/nav/scriptMacros.ts`, `scriptDecide.ts`: explicit operation drone
  settlement and diagnostic projection.
- `web/src/nav/miningDroneFlight.ts`, `scriptRunner.ts`: change-only decisions
  and lifecycle milestones, with unchanged read/retry cadence.
- `web/src/nav/miningOperationMacros.test.ts`, `miningDroneFlight.test.ts`,
  `botLog.test.ts`: integrated cycles/safety and diagnostic regressions.
- `web/src/bots/miningOperationProfiles.test.ts`,
  `test/miningOperationsRoutes.test.js`: enabled profile and versioned plan/grants.
- `docs/mining-drone-reliability.md`: this audit and retest guide.
