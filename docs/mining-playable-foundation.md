# MCC playable foundation / Fleet Parking

Isolated development line based on `84bd192a4c112cd204068fdd613a9ce99e2ac653`.
The `40-mining-operations` acceptance worktree and its live process/data are not
used by this implementation or its tests. No live gameplay has been performed.

## Authority audit and reuse

- `miningOperationProfiles.js`: built-in, in-code runner documents; no user
  script database copies. The Belt Miner **revision 2** and Belt Hauler
  **revision 1** retain their IDs and identical generated documents.
- `miningOperationStore.js`: existing version-1 JSON definition store. Adds a
  versioned policy object, not a database or durable RUNNING/current-target state.
- `miningOperations.js`: still owns runtime coordination, one target, shared
  leases and belt-memory projection. Stop invalidates runner-visible assignments
  immediately and rejects reserve/activate/deplete/ready/drain-complete writes.
- `botHost.js`: exact bot/account/operation/character claim remains the pilot
  authority. Acquisition, login recovery, exclusivity and ordinary timed Stop
  retain their existing paths.
- `flow.ts`: pauses and settles the existing runner, uses
  `confirmDronesHomeForManualStop` / `recallFlightBeforeManualStop`, aborts shared
  autopilot, confirms fitted mining modules have stopped, then replaces that
  runner with a finite parking document. No concurrent second runner.
- `fleetParking.ts`: fixed finite use of ordinary `travel-to-station` or
  `deliver-ore` macros, shared autopilot, normal freight writes and observations.
  It has no resource selector, loop, independent targeting or alternate home.
- UI remains `/mining-command-center`, with stored control-plane projection only.

## Definitions and profile families

`policies.version = 1`:

| Policy | Current values |
| --- | --- |
| `parking.mode` | `STAY_IN_PLACE`, `RETURN_HOME_DOCK`, `RETURN_HOME_UNLOAD_DOCK` |
| `parking.destination` | Canonical `{stationID, stationName, systemName}`, or null for Stay |
| `parking.corporationDivision` | null = personal hangar; 1–7 = existing corp delivery |
| `travelAssist.mode` | `DISABLED` only |
| `resourceTarget.mode` | `ANY_ELIGIBLE` only |
| `scouting.mode` | `DISABLED` only |
| `defense.mode` | `EXISTING_SELF_DEFENSE` only |

Missing policies acquire these defaults on read, without rewriting the file.
In particular, old definitions remain **Stay in place**. Policies are validated
again at launch; return policies participate in launch-plan confirmation hashes.
Area/reach remains the existing canonical area object, separate from policies
and current target. Anchor-only discovery is unchanged.

`PROFILE_FAMILIES` has four distinct entries. Only BELT has executable builders:

- `mcc.belt.hauler-service.miner`, revision 2.
- `mcc.belt.hauler-service.hauler`, revision 1.

ORE_ANOMALY / ICE / GAS expose non-executable metadata and no builders.
MCC launch rejects these families, including mixed selections and custom
routines that attempt to enable them. Existing standalone scanner/mining macros
are not removed. Future family builders should supply their own role-specific
documents and compatibility/discovery rules, not route through a universal belt
routine. Custom BELT compatibility preflight remains unchanged.

## Manual Stop behavior

**Stay:** existing graceful member Stop, drone confirmation, final scoped
logout/release. No intentional trip or unload. Target release keeps existing
depletion knowledge intact.

**Return:**

1. Enter STOPPING and invalidate target-dependent assignments; no new target,
   depletion transition or logistics tail is created.
2. Each live operation-owned member pauses its existing runner and waits for
   an issued tick to settle. Recall controlled drones using existing bounded
   confirmation. Abort any previous route. In space, read fit/module authority,
   deactivate active miners, and confirm they are off.
3. Release current/draining target claims once all live hosted members have
   confirmed settlement. Record `TARGET_RELEASED_ON_STOP`. If a member cannot
   settle, retain the claim while that host is alive; bounded leases still apply.
4. Healthy members independently travel to the explicit parking station and
   dock. They need not wait indefinitely for a peer with failed recall/travel.
   A healthy member may park while the shared claim remains held for a peer.
5. For unload policy, use `deliver-ore`, then verify readable freight holds have
   no relevant items at the exact configured station. Dock-only keeps freight.
6. Only confirmed members cross existing graceful Stop/final logout. Report
   operation STOPPED only after every required member succeeds.

Stop may leave cans behind. It is not depletion and does not drain the grid.
Repeated requests share one in-flight operation; a later retry visits only
members not already confirmed parked. Operation B is never part of A's stop set.

## Destination and freight boundary

Parking station is neither mining target, pilot starting station, nor implicit
hauler delivery station. Existing map search/resolution supplies canonical ID,
name and system; unresolved or conflicting identities fail closed at save.
The optional **Use hauler delivery station as parking station** button makes an
explicit snapshot choice. Later delivery edits do not silently move parking.

The existing `freightHoldItemIDs` boundary is preserved: specialized mining
holds when present, otherwise existing cargo fallback (including its current
ore-category filtering when classified). It is not generic inventory evacuation;
spare crystals/ammunition in a miner's cargo and other unrelated bays stay put.
Corp delivery retains the existing bridge fallback to personal hangar if the
corp deposit is refused; the ordinary runner note/log records that fallback.
Unreadable holds are not treated as empty and cannot complete parking.

## Failure, deadlines and recovery

Per-member settlement/travel/unload failures retain control and report the
concrete reason; the operation ends PARKING_FAILED, never false STOPPED.
Module shutdown is conservatively checked once after deactivation: a cycle that
has not ended reports blocked settlement; explicit Retry parking can confirm it
later. There is no new retry/polling loop. Other healthy members can finish.

Parking uses the **remaining original duration grant** and cannot extend it.
Manual Stop should be requested with enough time to get home. Ordinary timed
expiry retains existing graceful cleanup, not automatic parking. If expiry
occurs during parking, movement is aborted, completion is unconfirmed, and
control is retained for explicit recovery. Bot Manager's existing graceful Stop
can release that retained control; the operation still does not claim it parked.
Reacquiring an offline/expired member, acknowledging a manually recovered fleet,
or minting a new parking grant is not automated here. A fresh operation can be
created after explicit pilot recovery; an incomplete one remains visibly failed.

Before preparation, botHost persists only `operationStopRequested` in its
existing restart roster. A restart refuses to replay the old mining document
for those rows and projects interrupted parking as PARKING_FAILED/unknown.
It does not assume a persisted target or docking completion, nor auto-login an
interrupted parking pilot. Standard botHost failure-ring retention still applies.

## Performance and unchanged baseline

No new observation timer or cadence. MCC display remains stored projection and
has zero space snapshot reads. During a requested parking transition only,
settlement uses existing bounded drone reads plus two one-off combined
observations to verify mining-module shutdown. Parking then **replaces** the
mining runner and uses its same combined single-observation tick and shared
autopilot. No concurrent background parking observer.

Normal Belt documents, jettison, drone swap, returned singleton handling,
depletion/relocation, container claims and lost-drone recovery are unchanged.

## Future propulsion seam (documented, not enabled)

There is already reusable pure propulsion policy in `web/src/nav/propulsion.ts`
(`PropulsionModule`, `PropulsionInputs`, `decidePropulsion`), used by Fleet
Companion and drone combat. `flow.ts` resolves fitted module groups/effects;
script observations already carry `propulsionModules` and active module IDs.
Deactivation must carry type/effect identity, not a bare module ID.

Future travel assistance should compute a `wantBurn` decision at the shared
movement boundary (`autopilotLoop.ts` / `decideCloseIn`, script macro approach
adapters, and `rideAutopilotTo`), then reuse the pure propulsion policy and
existing dispatcher. Respect unreadable fit/active state, cap/scram constraints,
arrival, recall, warp/dock and cancellation. It must serve ordinary scripts,
miners, haulers and future escorts, not an MCC-only loop. No movement/propulsion
behavior changed in this branch.

## Validation and changed-file inventory

331 focused tests pass across 18 files: operation definitions/policies, stop
orchestration, route/standalone UI, standard profiles, host ownership and expiry,
script runner/decider, parking macros, real-flow settlement, mining drones,
recovery, belt memory and container claims. This includes the existing repeated
jettison and defensive drone-swap regressions and the zero-MCC-snapshot test.
TypeScript typecheck, changed-JavaScript syntax checks, production web build,
and `git diff --check` pass. Build warnings remain in unrelated existing Svelte
components and the large app bundle. A direct serialized-document comparison
against the base confirms both BELT profile documents/revisions are unchanged.

Changed files (paths relative to 41):

- `src/`: `botHost.js`, `botHost.test.js`, `miningOperationPolicies.js`,
  `miningOperationStop.js`, `miningOperationProfiles.js`,
  `miningOperationStore.js`, `miningOperations.js`, `server.js`.
- `test/`: `miningOperationPolicies.test.js`, `miningOperationStop.test.js`,
  `miningOperations.test.js`, `miningOperationsRoutes.test.js`.
- `web/src/app/`: `api.ts`, `flow.ts`, `botExclusion.test.ts`.
- `web/src/nav/`: `fleetParking.ts`, `fleetParking.test.ts`,
  `scriptConditions.ts`, `scriptDecide.ts`.
- `web/src/ui/`: `MiningOperations.svelte`, `miningOperationsPanel.test.ts`.
- `docs/mining-playable-foundation.md` (this report).

## Manual QA after isolated deployment

Use 41's standalone MCC on its own intentionally configured WC instance; do not
replace/restart 40 or reuse its live pilot claims. Use idle QA pilots and fresh
41 definitions; no runtime data or logs were copied from 40.

1. Open `/mining-command-center` directly. Configure a small Standard BELT fleet
   and explicit hauler delivery destination. Confirm defaults say Stay.
2. Choose Return home and dock; select an explicit parking station. Reject an
   invalid ID/name. Save/reload, confirm the station and policy remain canonical.
3. Start with sufficient grant time. Confirm baseline Mining/hauling. Stop:
   observe settlement, claim release, PARKING, exact dock, then STOPPED/logout.
   Dock-only must preserve freight. Repeat Stop while in progress.
4. Repeat with Return home, unload and dock and a chosen division. Check relevant
   freight arrives through ordinary delivery; unrelated cargo stays aboard.
5. Run a second distinct-target operation with other pilots. Stop the first;
   the second must keep its pilots, target and MINING state.
6. Check a refusal/unavailable member: healthy peers park; failure remains
   visible and cannot say STOPPED. Retry only after resolving the reported cause.
7. Verify Stay does not deliberately travel/dock and normal drone swap/jettison
   behavior still matches 40. Observe network traffic: opening MCC adds no space
   reads. No endurance/gameplay result is claimed by automated tests.

Deferred: Ore Anomaly/Ice/Gas execution, Standard Self Unload profiles, travel
assist, economic/resource priorities, Industry demand, real adjacent/scouting,
Defender/Escort execution, operation-owned cans, automatic parking recovery or
expiry scheduling. Fixes from 40 require a deliberate future cherry-pick/rebase;
there is no monitoring or synchronization.
