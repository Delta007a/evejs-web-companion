# Discord publication drafts

Prepared text only; no Discord message is posted by the publication workflow.

## Short post for Farmer's WC thread

I've published an experimental WC integration built on Farmer's original Web
Companion and Tokeiito's modifications. Full credit to them for the foundation.

The two main additions are **Pilot Training**—turn corporation fittings into training
requirements, with reviewed skill purchases/queues and optional corp onboarding—and
**Mining Command Center**—coordinate Belt/Ore/Ice miners and hauling, including
Self-Unload, Parking and Travel Assist.

Code and notes: https://github.com/Delta007a/evejs-web-companion/tree/delta/tokeiito-integration

Please dissect it. I'd especially welcome reports of ugly, unsafe or broken assumptions
around authority, sessions and logistics. It's an integration branch, not a claim that
every scenario is gameplay-accepted.

## Longer technical summary

This branch continues Farmer's original Web Companion and Tokeiito's substantial
extensions. Delta's additions are experimental systems built on that work.

**Pilot Training** at `/pilot-training` supports new/existing trainees and zero to
three corporation-fitting contracts per role. FAST derives the actual recursive
prerequisites. Optional onboarding uses a configured non-CEO authority and the
Full access (except CEO) policy. Skills are purchased directly; authorized corporation
funding covers the exact personal-wallet shortfall. Queue application is a separate,
reviewed append-only action. Session ownership and Hangar Release stay guarded.

**Mining Command Center** at `/mining-command-center` provides Belt, Ore Anomaly and
Ice families with Hauler Service or Self-Unload. It includes separate Parking and
delivery destinations, locality/resource preferences, AB/MWD Travel Assist, final
partial deliveries, logistics tails/catch-up and finite hosted timing/recovery.
Ice requires Ice Harvesters and does not use ordinary Mining Drones.

The combined integration passed 522 focused tests, type/build checks, independent
composition review and API smoke. Existing accepted gameplay evidence covers Belt
logistics, Ore Anomaly, Ice, Ore Self-Unload and physical AB Travel Assist. Those runs
were not repeated for publication; the fresh integrated browser-persistence check
remains outstanding. Other scenario-specific QA limits are documented.

**What's not here yet:** GAS, adjacent scouting, dedicated operation Defender
execution, equipment provisioning, citadel relocation, a general role taxonomy or
production password registration. A training home setting does not move or equip a
pilot. Roles without a support policy use FAST only.

Pilot Training requires the documented EveJS 0.12.9 runtime patches in your mutable
gameplay copy. Verify the base/hashes, preserve mods and use the normal launcher path.

Branch: https://github.com/Delta007a/evejs-web-companion/tree/delta/tokeiito-integration

Reviews, especially of unsafe authority or lifecycle assumptions, are welcome.
