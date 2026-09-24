# Delta integration branch

This branch follows [`Tokeiito/evejs-web-companion`](https://github.com/Tokeiito/evejs-web-companion) branch `tokeiito`. Delta's selected gameplay behavior was rebuilt from the audited Tokeiito base `2dd519ce5a496a2067c4c731a4a3f86858b94f68`, against that line's current interfaces. The current gameplay lineage reaches `cd258b02e8a8f53b4825e9921efaf12e7c2fdd96`; publication documentation follows it on this branch. The previous public gameplay point was `b41344dda95dfd278453050f92d6c5ca9136687f`.

## Integrated behavior

- Server-hosted bot credentials cover the approved run and a cleanup margin. Browser-to-server handoff and stale session ownership are reconciled against gateway authority; invalid credentials do not gain cleanup authority.
- Loop invocations receive fresh watchdog budgets, while productive runs retain Tokeiito's progress-based watchdog. Successful unloading clears stale ordinary and `NO_ROOM_ABOARD` refusal state without erasing durable gone/unreachable results.
- Same-belt short warp uses belt surface geometry so a belt inside the server's non-warpable distance counts as reached. Tokeiito's separate cosmic-site arrival and stale/refused-site behavior remains intact.
- Multiple haulers coordinate container claims through the BFF, keyed by solar system and container item ID, with session/run ownership, renewal and bounded expiry.
- Corporate-hangar ore delivery, filtered haul-all and persistent A-to-B/B-to-A corporate routes use current Tokeiito inventory and bay-routing primitives. Route transfers verify movement and honor route-owned manifests and explicit corporate-division destinations.
- Mining drones harvest alongside the existing belt and ore-site mining flows. On a hostile, the controller recalls mining drones, confirms return, launches combat drones, and later resumes mining drones after three clear observations and confirmed combat-drone return. Unknown drone limits or control state block unsafe launches or travel.
- Distribution delivery runs can prefer levels 1–4, optionally falling back only to lower levels. Agent-conversation authority decides eligibility and the existing cargo-capacity gate remains in force.

Tokeiito's Pilot Groups, ore-site mining and planetary industry implementations remain the upstream implementations on this line. This branch is for inspecting and selectively integrating behavior; it is not a wholesale merge of Farmer and Tokeiito history.

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

## Verification and integration guidance

The integration and subsequent changes passed targeted source tests, type checks and web builds. The core mining-drone/combat-swap behavior and graceful manual browser Stop have been exercised in gameplay. The representative mining/hauling smoke above covers continued operation after snapshot consolidation. Natural timed expiry and login lost-drone recovery have mechanical test coverage and still merit direct gameplay QA; other terminal paths should be tested in gameplay before being called accepted. Corporate hauling on the rebuilt upstream primitives and multi-hauler claims likewise require scenario-specific gameplay verification.

Reviewers should inspect individual feature commits and their dependencies before cherry-picking. Several changes share current Tokeiito runner, drone, inventory and BFF interfaces; applying a single commit to an older tree may require adapting those seams. The merge on this public branch preserves the earlier publication note while bringing forward the gameplay lineage, without rewriting the public branch or merging the full private/Farmer history.
