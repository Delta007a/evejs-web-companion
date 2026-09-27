# MCC Ore Anomaly and Ice families

Implementation base: `1ab6503d4cb7cf0810411bd2abb5010d78b060f1`, isolated
`41-mining-operations-playable`, branch `feature/mining-operations-playable-foundation`.
No gameplay, service restart, runtime/mod changes, live-data copying or promotion
was performed. `40-mining-operations` remains the live acceptance worktree.

## Source audit

The read-only audit used the current local `EveJS-0.12.9-test` sources, not UI
labels or assumed upstream capabilities:

- `src/services/exploration/signatures/signatureRuntime.js`,
  `buildAnomalySiteInfo`: scanner dictionary identity, `siteID`, `instanceID`,
  `targetID`, `archetypeID`, `scanStrengthAttribute`, position and system.
- `src/services/exploration/signatures/providers/miningAnomalyProvider.js` and
  `src/services/dungeon/dungeonUniverseRuntime.js`: generated Ice anchors become
  scanner sites; the Ice mining template supplies archetype **28**. Ordinary
  ore sites use archetype **27**. Both can have ore scan-strength attribute 211;
  scan-strength alone cannot distinguish these families.
- WC `scanner/siteKind.ts`, `api.loadScanFullState` and the existing script
  observation path already provide current-system scanner observations. The
  operation projection previously discarded authoritative site/instance IDs.
- `src/services/mining/miningInventory.js`: Ice inventory groups **465, 903,
  2022**; gas groups **711, 4168**; ordinary ore is asteroid category **25**,
  excluding those families and non-resource groups **519, 4094, 4714**.
- `src/services/mining/miningRuntime.js`, `isFamilyCompatibleWithYield`: Ice
  mining modules accept Ice resources, not ore; ore modules are not an Ice
  fallback. Runtime module-family resolution uses internal name logic; WC
  deliberately uses static dogma instead. Audited SDE Ice Harvester I type
  **16278** has mining amount attribute **77 = 1000** and required skill
  **182 = 16281 (Ice Harvesting)**. Its group **464** is also used by ordinary
  Strip Miners, so that group alone is insufficient.
- `src/services/drone/droneRuntime.js`, `classifyDroneMiningYieldKind` /
  `isDroneMiningCompatibleWithTarget`: ordinary Mining Drones mine ore, while
  Ice Harvesting Drones are a separate capability. This task does not implement
  Ice drone harvesting.
- `src/services/mining/miningRuntimeState.js`: depleted generated Ice sites
  disappear, including their scanner anchor; player jetcans are not the site.
  `CmdWarpToStuff("scan", label)` cannot recover a disappeared destination.
- Existing bookmark service / `bookmarkTargetResolver.js`: bookmarking the
  pilot's own ship records a coordinate bookmark (`itemID: null`). Existing
  `warpBookmark` works independently of scanner presence. Personal default
  folders already exist; expiry mode 2 is two days. `BookmarkScanResult` handles
  signatures, so it is not used for anomalies here.
- `src/space/runtime.js`: Ice Harvesters can defer manual deactivation until the
  current full cycle finishes. WC retains the existing fail-closed Parking
  settlement check and reports this explicitly.

## Profiles and target authority

| Family | Miner ID | Hauler ID | Revision |
| --- | --- | --- | --- |
| ORE_ANOMALY | `mcc.ore-anomaly.hauler-service.miner` | `mcc.ore-anomaly.hauler-service.hauler` | 1 / 1 |
| ICE | `mcc.ice.hauler-service.miner` | `mcc.ice.hauler-service.hauler` | 1 / 1 |

BELT Miner v2 and Hauler v1 documents remain unchanged (compared with the base
registry). GAS remains modeled and unavailable. No new Standard SELF_UNLOAD
profiles were added. Profiles remain MCC-owned, versioned documents executed by
the existing runner, not user scripts copied to `bot-scripts.json`.

Standard definitions require exactly one `targetClasses[]` entry. The UI offers
one family; old BELT definitions still load. Custom compatibility preflight stays
strict: a family-specific site mining/travel block cannot target another family,
and pinned/independent resource selectors remain incompatible.

Site board identity is
`<ORE_ANOMALY|ICE>:<systemID>:site:<scanner dictionary siteID>:instance:<instanceID>`.
When the scanner has no separate instance ID, its site ID supplies that component.
The label remains only a display/scan-warp handle. Reservation requires valid
identity and finite coordinates; the reserve route also requires the pilot's
current system. The existing synchronous claim, lease, heartbeat and botHost
ownership mechanisms are unchanged. BELT keys remain unchanged and cannot
collide with either site family.

Current-system discovery selects only the chosen family's archetype. No remote
scanner knowledge, adjacent discovery, Belt fallback or cross-family relocation
exists. No candidate means a truthful Waiting for target phase.

## Execution, freight and lifecycle

- Site travel/mining checks the owned assignment and exact site identity on each
  re-entry, including return after jettison/unloading. Arrival uses authoritative
  ship/site coordinates and the existing sub-warp-distance convention.
- Ore miners use confirmed online ore mining modules and the existing Mining /
  Defender drone wrapper. Ice miners require online Ice-capable mining high
  slots: positive mining amount and Ice Harvesting required-skill dogma. Invalid
  fits fail before the script can undock; fitting-cache refresh preserves the
  check after a fit change. Resources are classified from authoritative yield
  type/category/group, not names.
- Ice uses only Ice-compatible module IDs. The drone wrapper receives no mining
  rock target, so ordinary Mining Drones never launch to harvest Ice; the existing
  defensive combat-flight response remains available. No drone balance changes.
- Haulers share the proven threshold / explicit station / corporation division
  / loot / three-second idle structure, but use distinct family profiles.
  Existing global container claims remain the only container coordination owner.
- Existing freight selection already includes Ice and routes it to a specialized
  Ice hold or general mining hold. Ice thresholds now use that hold explicitly,
  never the ore-only asteroid hold. Site jettison confirms readable mining
  freight across holds. Unrelated cargo remains untouched; no broader transfer
  authority was added.
- Three successful missing scanner observations are required for disappearance;
  an unreadable scan resets that confirmation. Empty resources also need three
  observations. Depletion is not miner clearance: modules must settle, drones
  return and readable remaining freight be dumped/confirmed before relocation.
- Main-body clearance remains separate from the DRAINING tail. A tail cannot be
  completed while required site miners are still clearing. Relocation selects
  only the same family. Newly instantiated sites get new keys; renewed scanner
  visibility can clear disappearance evidence, but mere listing does not clear
  confirmed empty-grid evidence.
- Each site hauler confirms a temporary personal coordinate bookmark before
  looting. A disappeared site's logistics tail uses this return point after an
  unload trip, then catches the new operation target. Bookmarks are scoped to
  operation/run/target and expire after two days; they are not operation-scoped
  container ownership or a new persistence subsystem.
- Stop and Parking keep their existing scoped authority and finite home/unload
  programs. Parking never selects another mining target. Mining target, unload
  destination and parking station remain separate.

## Honest limitations

- Current-system HAULER_SERVICE is the new Standard acceptance path. No GAS,
  adjacent scouting, Defender role execution, propulsion, industry policy,
  resource preferences or operation-owned containers were implemented.
- A hauler that never reached a site before it disappeared has no confirmed
  return bookmark. It reports `SITE_RETURN_POINT_UNAVAILABLE` instead of
  inventing a destination; manual recovery is required. Missing personal-folder
  authority or unconfirmed bookmark creation also fails closed.
- Ice Parking during an unfinished mining cycle can report `PARKING_FAILED`
  with the explicit pending-cycle reason. Control is retained. Retry Stop after
  the module finishes; no blind retry/polling system was added.
- Unknown resource classification, scanner authority, hold state or fit dogma
  does not become a successful mining/clearance assertion.
- Tests establish code behavior, not live emulator acceptance. New-family live
  smoke/depletion/endurance testing remains required.

## Performance and verification

No new snapshot or scanner loop exists. The existing combined script observation
remains the space read; site blocks request scanner data through its established
cadence. Classification uses cached static data. Ice fit dogma is fetched with
the existing fitting-capability cache. Bookmark setup is a one-time arrival
action, not a per-tick poll. MCC remains a standalone control-plane-only page.

Validation passed: **311** focused/adjacent tests plus **113** filtered shared
macro/codec/text tests (424 total), TypeScript checking, syntax checks for all
nine changed/new JavaScript files, `npm run build:web` and `git diff --check`.
The build reports existing warnings in untouched UI files and the large bundle.
The final module-state guard was additionally retested with the 32 operation
macro/Parking tests and rebuilt.

Focused coverage includes profile codecs/IDs, schema compatibility, atomic
cross-operation site claims, same-family relocation, disappearance/reappearance,
miner-clearance barriers, freight, bookmarks, scoped Stop, Parking, drone swap,
runner observation diagnostics and the zero-MCC-snapshot regression.

## Manual smoke (operator only)

1. Open `/mining-command-center` on the isolated 41 server. Create a current-system
   Ore Anomaly / HAULER_SERVICE operation, Standard miners and hauler, explicit
   unload station and corporation division. Use online ore mining fits. Start
   without selecting interactive pilot workspaces. Confirm one ACTIVE anomaly,
   exact-site travel, Mining/Defender drone behavior, jettison and hauler
   loot/unload/return. Confirm the temporary MCC tail bookmark appears.
2. In a system with an authoritative Ice scanner site, create an Ice operation
   using actual online Ice Harvesters. An ore-only miner must fail clearly before
   undock. With a valid fit, confirm Ice module cycles, no ordinary Mining Drone
   harvesting, Ice freight jettison/loot/corporation delivery and return.
3. Reach depletion in each family. Confirm partial freight clearance before main
   body relocation, DRAINING return via the bookmark if the scanner site vanished,
   hauler catch-up, and a new target of the SAME family. If none exists, expect
   Waiting for target, not a Belt or another family.
4. Run independent BELT / Ore Anomaly / Ice operations with distinct pilots where
   local site availability permits. Confirm distinct claims. Stop/Park one with
   each policy; other operations must keep running. Verify unload Parking leaves
   unrelated cargo aboard. If Ice settlement reports a finishing cycle, wait for
   its completion and Retry Stop. No false STOPPED or new mining reservation is
   acceptable during Parking.

## Changed code map

- Backend: `miningOperationProfiles`, `miningOperationStore`, `miningOperations`,
  `miningTargetBoard`, `miningResourceFamily`, `server`.
- Runner/bridge: `app/api`, `app/flow`, `bots/botScript`, `bots/scriptCodec`,
  `bots/scriptText`, `bridge/space`, `store/types`, `nav/botLog`,
  `nav/scriptConditions`, `nav/scriptDecide`, `nav/scriptMacros`,
  `nav/miningSite`, `nav/siteLogisticsBookmark`.
- UI: `MiningOperations.svelte`; focused operation/profile/site/Parking/drone/UI
  tests live beside those seams. This document records the source audit and QA.
