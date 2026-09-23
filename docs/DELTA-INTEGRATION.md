# Delta integration branch

This branch builds on `Tokeiito/evejs-web-companion` branch `tokeiito`, at the audited rebuild base `2dd519ce5a496a2067c4c731a4a3f86858b94f68`. The integrated gameplay HEAD before this publication note is `b41344dda95dfd278453050f92d6c5ca9136687f`.

It shares community integration and experimental additions for inspection and future consolidation:

- Longer-lived server bot authentication and safer browser-to-server handoff.
- Loop watchdog, stale `NO_ROOM_ABOARD`, and same-belt short-warp fixes.
- Shared BFF container claims for multiple haulers.
- Corporation-hangar ore delivery lineage, filtered haul-all, and persistent bidirectional corporate routes with verified route-owned manifests and strict destinations.
- Mining drones with an automatic defensive combat-drone swap.
- Distribution missions at levels 1–4, with optional lower-level fallback.

The changes were mechanically verified in targeted tests and checks. Several areas still require gameplay QA and should not be treated as gameplay accepted. The branch intentionally follows Tokeiito's line; it does not merge the Farmer and Tokeiito histories wholesale. Review or cherry-pick individual feature commits where practical, accounting for dependencies on the Tokeiito base and between integration commits.
