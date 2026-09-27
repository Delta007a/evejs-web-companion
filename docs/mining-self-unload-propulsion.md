# 41: propulsion correction, Self-Unload, compact controls

## Read-only propulsion audit

Audited `G:\EVESP\EveJS-CodexLab\EveJS-0.12.9-Beta-test` without starting it,
changing it, or loading its service/runtime singleton. BCargo1's
`data/bot-logs/140000016.prev.jsonl`, run `mujh8yi5-e3no`, corroborates repeated
activation/off at 07:09:14 / 07:09:23 / 07:09:32 UTC for module 9988400001162.
Those old logs do not contain physical speed evidence; the reported 186–187 m/s
is live-QA evidence, not a measurement produced by this audit.

Exact path:

1. WC `web/src/app/flow.ts` Travel Assist called `activateModule` with `repeat:0`
   and **no effect**. BFF `/api/bridge/modules/activate` sent
   `dogmaIM.Activate(itemID, "", null, 0)` and reread active module IDs.
2. EveJS `src/services/dogma/dogmaService.js`, `Handle_Activate` (around 8875,
   8959, 9040), chooses `activatePropulsionModule` ONLY when the supplied,
   normalized effect is `moduleBonusAfterburner` / `moduleBonusMicrowarpdrive`.
   Empty remains empty. Otherwise it calls `activateGenericModule`.
3. `src/space/runtime.js::activateGenericModule` (34645 onward) resolves the
   default effect **after that dispatch** and creates a cycling effect state.
   It does not populate the dedicated speedFactor/speedBoostFactor/massAddition
   payload. Its derived refresh is conditional on generic modifiers (36162,
   36329). The audited SDE effects 6731/6730 have no modifierInfo; their physical
   behavior belongs to the dedicated path, not a generic modifier list.
4. `activatePropulsionModule` (34179, payload 34358) obtains ship/skill-aware
   propulsion attributes, applies capacitor/scram/online gates, then refreshes
   ship derived state (34398). This also handles a hosted session without a
   ready Destiny client using `refreshShipEntityDerivedState`.
5. `applyPropulsionEffectStateToEntity` (13067) calculates
   `baseMaxVelocity * (1 + 0.01 * speedFactor * speedBoostFactor / (baseMass + massAddition))`
   and updates mass/agility. `src/space/destiny/commands/shipDerivedMotion.js`
   writes the actual entity's maxVelocity, not just HUD cycle state.
6. `src/space/destiny/simulation/movement.js::advanceFollowMovement` (1022)
   consumes entity.maxVelocity; the movement/Carbon integrator updates velocity.
   WC approach sends a target/range, not a competing speed override.

Thus the old activation log proved a cycling-set result, not application of
physical propulsion. Single-cycle requests also caused the observed repeated
off/on transitions. The wrong dispatch applies to both AB and MWD using empty
effects, not specifically Miasmos. Correctly named manual/client commands enter
the dedicated path. The WC manual ModuleRack currently also omits the effect;
this pass fixes the shared **Travel Assist** adapter, not unrelated manual rack
behavior. No EveJS patch is needed to invoke the existing correct path. A future
runtime improvement could resolve a default effect *before* dispatch, but none
was made here.

## Correction / verification limits

Travel Assist sends the SDE-derived explicit effect and continuous repeat (-1).
AB-first selection, capacitor floor, ranges and all target authority stay intact.
The same approach retains owned propulsion instead of deliberately cycling it
off. Interaction, range, cancellation, target loss, pause/error and Stop/Parking
request owned shutdown. Unconfirmed shutdown retains custody and can block
graceful cleanup; it is never reported safely stopped. External active modules
and definite already-active refusals are not adopted. An unexpectedly stopped
module is not repeatedly restarted on the same approach.

Diagnostics distinguish cycling acceptance from observed increased authoritative
max velocity, observed actual acceleration, and cycling without confirmed speed
bonus. They consume the existing script snapshot only, with one-shot milestones.
Snapshot deltas are evidence, not a causal guarantee when other effects also change.

`test/propulsionRuntimeContract.test.js` optionally reads the specified runtime
with `EVEJS_PROPULSION_AUDIT_ROOT`. It reproduces the dispatch split and exercises
the actual isolated propulsion formula, motion writers and Carbon integrator
against synthetic entities. It does NOT load the runtime, start a scene, or
prove BCargo1's live post-fix speed. That remains a manual retest.

## Standard Self-Unload

Revision 1 profiles:

- `mcc.belt.self-unload.miner`
- `mcc.ore-anomaly.self-unload.miner`
- `mcc.ice.self-unload.miner`

Shared runner document: undock → operation-owned mining until 90% → explicit
station/corporation division delivery → repeat. No hauler or user routine is
required. Catalog destination validation is unchanged and fail-closed. Existing
Hauler Service documents/revisions remain unchanged.

Threshold exit settles modules/locks/drones; delivery uses existing mining
freight filtering and confirms readable empty holds. Depletion never jettisons:
miners settle and deliver partial loads, report ready, and wait docked for the
existing required-healthy-miner rendezvous. Failed/offline members retain DEGRADED
semantics without permanently blocking healthy peers. Reservation/relocation
remains same-family. Ore/Belt retain Mining/Defender drone management; Ice uses
Ice Harvesters and only the defensive flight. Miners remain restartSafe:false.
Parking remains a separate Stop policy and destination.

## UI

Edit populates `Editing <name>`, waits for Svelte render, scrolls the shared form
into view and focuses its name field without a second scroll. Save/Cancel remain
unchanged. Self-Unload exposes the existing explicit delivery picker.

Runtime summary shows Started / earliest hosted Expires / server-clock Remaining
/ Hosted count. No per-member expiry groups are expanded for healthy runs.
Expiry spread >= five minutes shows earliest/latest mismatch; the exact earliest
deadline is never rounded. Exact grants stay under Member grants / recovery.
Failure/unavailable, recovered and partially capped states remain visible, along
with existing per-member extension results and expiry warnings.

## Manual QA

1. Edit a lower operation card: confirm named editor is scrolled/focused; Cancel.
2. Long AB/MWD approach: confirm cycling AND increased max velocity/acceleration
   logs; no periodic restart, owned shutdown near interaction and on Stop.
3. For each family, Standard SELF_UNLOAD with explicit station/division, miners
   only: observe threshold unload/return and partial unload/rendezvous on depletion.
   Ice must have an Ice Harvester and must not launch ordinary Mining Drones.
4. Keep another Hauler Service operation running: verify final-partial delivery,
   accumulated tails and catch-up remain independent. Check compact grants;
   extend one member/partial operation to exercise meaningful mismatch details.

No gameplay, service restart, runtime/live-worktree modification, or promotion
was performed in this task. GAS, Defender execution and adjacent scouting stay
unavailable; no new observation/polling cadence was added.

## Changed files / validation

- Profiles/preflight: `src/miningOperationProfiles.js`, `src/server.js`.
- Propulsion/runner: `web/src/nav/travelAssist.ts`, `web/src/nav/scriptRunner.ts`,
  `web/src/app/flow.ts`, `web/src/app/api.ts` (API comment only).
- Delivery safety: `web/src/nav/scriptMacros.ts`.
- UI: `web/src/ui/MiningOperations.svelte`, `web/src/ui/MiningOperationRun.svelte`,
  `web/src/app/miningOperationRunView.ts`.
- Tests: `test/propulsionRuntimeContract.test.js`, `test/miningOperations.test.js`,
  `test/miningOperationsRoutes.test.js`, `web/src/nav/travelAssist.test.ts`,
  `web/src/nav/miningOperationMacros.test.ts`, `web/src/bots/miningOperationProfiles.test.ts`,
  `web/src/ui/miningOperationsPanel.test.ts`, `web/src/ui/miningOperationRun.test.ts`.
- This audit document.

Passed 357 scoped tests: propulsion (including the enabled read-only runtime
verifier), profiles, mining/drone/hauling/accumulated-tail/rendezvous, runner,
operation routes/Stop/Parking/grants/container claims and control-plane UI.
Typecheck, changed-JS syntax checks, `build:web` and `git diff --check` passed.
Build retained existing warnings in unrelated Svelte components/chunk sizing.
All six pre-existing Hauler Service profile objects/documents/revisions were
compared against the base commit and remain byte-identical as JSON.
