# Delta integration branch

This branch builds on [Farmer's original EveJS Web Companion](https://github.com/rrfarmer/evejs-web-companion) and [Tokeiito's substantial modifications and extensions](https://github.com/Tokeiito/evejs-web-companion), following Tokeiito's `tokeiito` line. Delta's systems below are experimental extensions on that foundation, not a claim to have originated Web Companion.

The selected gameplay integration was rebuilt from audited Tokeiito base `2dd519ce5a496a2067c4c731a4a3f86858b94f68`. The previous publication included gameplay through `cd258b02e8a8f53b4825e9921efaf12e7c2fdd96` (preceded by public gameplay point `b41344dda95dfd278453050f92d6c5ca9136687f`). The accepted Pilot Training and Mining Command Center histories were integrated by `77f5365b1a19367437276b2f708b139ca588c043`. Normal merges preserve both those histories and the earlier public documentation lineage; this work does not update to a newer Tokeiito base.

This document owns integration history, change summaries and verification status.
Usage belongs in the [Pilot Training guide](pilot-training.md) and
[Mining Command Center guide](mining-command-center.md); installation belongs in
the [runtime patch instructions](pilot-training-runtime-setup.md).

## Integrated behavior

- Server-hosted bot credentials cover the approved run and a cleanup margin. Browser-to-server handoff and stale session ownership are reconciled against gateway authority; invalid credentials do not gain cleanup authority.
- Loop invocations receive fresh watchdog budgets, while productive runs retain Tokeiito's progress-based watchdog. Successful unloading clears stale ordinary and `NO_ROOM_ABOARD` refusal state without erasing durable gone/unreachable results.
- Same-belt short warp uses belt surface geometry so a belt inside the server's non-warpable distance counts as reached. Tokeiito's separate cosmic-site arrival and stale/refused-site behavior remains intact.
- Multiple haulers coordinate container claims through the BFF, keyed by solar system and container item ID, with session/run ownership, renewal and bounded expiry.
- Corporate-hangar ore delivery, filtered haul-all and persistent A-to-B/B-to-A corporate routes use current Tokeiito inventory and bay-routing primitives. Route transfers verify movement and honor route-owned manifests and explicit corporate-division destinations.
- Mining drones harvest alongside the existing belt and ore-site mining flows. On a hostile, the controller recalls mining drones, confirms return, launches combat drones, and later resumes mining drones after three clear observations and confirmed combat-drone return. Unknown drone limits or control state block unsafe launches or travel.
- Distribution delivery runs can prefer levels 1–4, optionally falling back only to lower levels. Agent-conversation authority decides eligibility and the existing cargo-capacity gate remains in force.

Tokeiito's Pilot Groups, ore-site mining and planetary industry implementations remain the upstream implementations on this line. This branch is for inspecting and selectively integrating behavior; it is not a wholesale merge of Farmer and Tokeiito history.

## Dockable destinations

Generic WC travel, dock and personal-hangar ore delivery can target an NPC station or an access-checked player structure. The shared destination picker searches names and keeps station and structure identities distinct. Structure access is checked again before routing and docking; arrival requires the corresponding `stationID` or `structureID` in authoritative flight status. Existing station script and MCC parking references retain their saved format.

MCC Fleet Parking can return to a structure for dock-only or personal-hangar unload. Start preflights structure access for all executable members before starting any, and each hosted member checks again before its automation begins. Standard MCC Hauler Service and Self-Unload delivery still require an NPC station and corporation division: the existing corporation unload authority can fall back to a personal hangar, so structure corporation delivery is blocked rather than claiming a strict division delivery succeeded. Pilot Training Home may record an accessible structure as a future provisioning base; saving it does not relocate a pilot. Station-only agent, mission and service workflows remain station-only.

Standalone MCC and Pilot Training pickers check access for an explicitly chosen pilot owned by the authenticated account without selecting or taking control of that pilot. The actual hosted member or browser pilot rechecks access before live work. An unavailable structure read leaves NPC station search usable with a warning. Repair watches still require an NPC-station Home because structure repair service is not verified.

All-system access-scoped structure search requires the small [runtime patch](../runtime-patches/dockable-structure-search.patch) on the audited mutable EveJS 0.12.9 runtime. It changes only explicit `GetMyDockableStructures(0)` to return dockable IDs across systems. Omitted arguments retain the current-system read. It does not expose operational structure data or modify the immutable clean reference. No runtime was restarted for this source change; gameplay docking and structure unload remain to be verified.

## Drone lifecycle and recovery since the previous public gameplay point

These changes handle distinct ways a controlled flight might otherwise be left in space:

1. **Normal terminal cleanup** (`29ede437b4530936e714036d1c355959705f1166`). An empty or depleted belt, depleted site, normal script completion, or counted-loop completion recalls controlled mining or combat drones and waits for authoritative return before the step or run reports its normal terminal state. Emergency escape retains its ship-survival priority.
2. **Manual browser Stop** (`3fa696e4c6b5a17453186c0276ab3532a62598c0`). A user Stop prevents new bot work, retains session and control authority, recalls controlled mining or combat drones, and confirms an empty controlled flight before finalizing. Repeated Stop requests share the pending graceful-stop operation. A failed or unreadable confirmation does not report a clean stop. This path has been exercised in gameplay.
3. **Natural server-hosted expiry** (`f97f7364f430566ada9a452f4880a8c9a680c08b`). The 1h, 4h, 12h and 24h presets share one expiry path, which now enters graceful drone cleanup before finalize/logout. It retains the session during a bounded cleanup window inside the credential margin. An unconfirmed return blocks clean expiry rather than silently releasing control. Targeted tests pass; natural-expiry gameplay verification remains recommended.
4. **Recovery after abnormal termination** (`289cfc729e2fbfdff64c8c6c827af95b3cdb5e47`). When an in-space pilot is selected in the browser, WC checks current EveJS authority for that pilot's nearby disconnected, recoverable drones. It uses the existing Reconnect-to-Lost-Drones authority, confirms regained control, orders return, and waits for authoritative empty-flight confirmation. Automation, travel and server handoff stay blocked while recovery is pending or failed. The feature does not search other grids or provision replacements. Targeted tests pass; login-recovery gameplay verification remains recommended.

## Script-observation snapshot work

`cd258b02e8a8f53b4825e9921efaf12e7c2fdd96` removes a duplicate authority read from the normal custom-script observation. Previously, the runner requested a full space snapshot and drone state separately, while the drone endpoint performed another full `readSpaceSnapshot`. It now obtains **one fresh full snapshot** and derives both the normal space and drone-in-space projections from that same observation: **2 → 1 full `readSpaceSnapshot` calls per normal custom-script observation**.

This is scoped to one observation. There is no TTL cache, reuse across ticks or characters, polling interval change, or reuse across commands and transitions. Module and drone command verification still makes its required fresh reads. Manual Stop, timed expiry and login recovery still make fresh return-confirmation reads. Drone-bay contents and ship launch limits continue to come from their own authoritative inventory and ship-attribute reads.

In a later matched steady-load V8 comparison with approximately eight WC miners, two WC haulers and 70–80 active mining drones, inclusive CPU in the WC `readSpaceSnapshot` subtree moved from about **11.13 s to 5.46 s** (about 51% lower). Nested character-record work moved from about **7.50 s to 3.72 s** (about 50% lower). The near-halving of the WC snapshot subtree is consistent with the 2 → 1 request reduction. **The comparison also had separate EveJS-side performance work; it does not attribute the total server/main-thread improvement solely to this WC change.** A representative gameplay smoke confirmed miners continued running and multiple haulers continued selecting separate claimed containers. It was not a full gameplay acceptance pass.

## Pilot Training

The accepted Training line adds `/pilot-training` with a `/goblin-factory` redirect,
new/existing trainee flows, zero-to-three corporation-fitting contracts per role and
actual recursive FAST prerequisites. It includes optional onboarding through a
configured non-CEO authority, Full access (except CEO), direct Buy Skill, exact-shortfall
SELF/configured-wallet funding and separately reviewed append-only queues.

Migration retains stable contract targets and accepted fitting identity. Safe Hangar
Release and temporary-session ownership coexist with hosted bots. NPC home settings
record training/provisioning intent without implementing relocation or equipment
provisioning. MINER support policies survive; unsupported support modes stay disabled.
See the [Training guide](pilot-training.md) for workflow, permissions and failure behavior.

## Mining Command Center

The accepted MCC line adds `/mining-command-center`: Belt/Ore Anomaly/Ice families,
Hauler Service and Self-Unload, separate Fleet Parking destinations, locality/resource
preferences, physical AB/MWD Travel Assist and hosted timing/recovery. Logistics retains
DRAINING, final partial deliveries, ordered tails and catch-up. Ice uses Ice Harvesters,
not ordinary Mining Drones. Existing target/session authority and restart-safety rules
survive without a separate space-polling loop. See the [MCC guide](mining-command-center.md)
for operation setup, logistics, Stop and propulsion behavior.

**GAS is unsupported.** Adjacent-system scouting, dedicated operation Defender
execution and operation-owned container scopes are not implemented; existing BFF
container leases remain the hauling authority. Equipment provisioning, citadel
relocation and production password registration are also outside this integration.

## Verification and integration guidance

The integration and subsequent changes passed targeted source tests, type checks and web builds. The core mining-drone/combat-swap behavior and graceful manual browser Stop have been exercised in gameplay. The representative mining/hauling smoke above covers continued operation after snapshot consolidation. Natural timed expiry and login lost-drone recovery have mechanical test coverage and still merit direct gameplay QA; other terminal paths should be tested in gameplay before being called accepted. Corporate hauling on the rebuilt upstream primitives and multi-hauler claims likewise require scenario-specific gameplay verification.

The combined Training/MCC integration passed **522 distinct focused tests**, TypeScript,
web builds, changed-JS syntax and diff checks. An independent composition review found
no actionable issue. Integrated API smoke confirmed public routes/redirect, migrated
qualification/fitting authority, named settings, operation families and Self-Unload
profiles without financial, queue or gameplay mutations. The one-snapshot observation
contract remains covered by focused tests.

Accepted gameplay evidence is inherited for Belt logistics, Ore Anomaly, Ice, Ore
Self-Unload and physical AB Travel Assist. These long checks were not repeated during
integration or publication. Fresh-member onboarding still needs separate live QA.
A fresh integrated browser-storage/F5 check was blocked by browser-tool support;
documented-contract migration and API reads do not claim that missing browser check.
The local smoke also reported an unconfigured optional character-event token; its
read endpoints worked, but that is not evidence of a working event-stream setup.
See the [detailed integration record](integration-30-41.md) for scope and limitations.

Reviewers should inspect individual feature commits and their dependencies before
cherry-picking. Runner, drone, inventory, training authority and BFF interfaces are
shared; isolated commits may need adaptation on an older tree. This branch follows
Tokeiito's line and is not intended as a wholesale Farmer/Tokeiito history merge.
