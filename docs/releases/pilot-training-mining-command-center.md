# Pilot Training and Mining Command Center integration

Branch publication, without a new version tag. This experimental line builds on
[Farmer's original Web Companion](https://github.com/rrfarmer/evejs-web-companion)
and [Tokeiito's extensions](https://github.com/Tokeiito/evejs-web-companion).
Delta's additions preserve those foundations and the earlier public branch history.

## Pilot Training

- Generic corporation-fitting qualification contracts: zero to three per role,
  stable targets, fitting-change review and actual recursive FAST prerequisites.
- New/existing trainee account and character flows with ambiguous-result recovery.
- Direct skill acquisition; optional non-CEO onboarding and Full access (except CEO).
- Exact-shortfall SELF/configured-wallet funding with authoritative checks.
- Separate reviewed append-only queues, safe session ownership and Hangar Release.
- Configurable NPC training/provisioning home; no automatic relocation or equipment.

## Mining Command Center

- Standard Belt, Ore Anomaly and Ice operation families.
- Hauler Service or Self-Unload, plus Fleet Parking with a separate destination.
- Locality/resource preferences and shared target authority.
- Physical AB/MWD Travel Assist with ownership-aware cleanup.
- Final partial deliveries, logistics tails, draining and catch-up.
- Finite hosted grants, timing, extensions and explicit recovery state.

The existing graceful drone lifecycle/recovery and one-full-snapshot script
observation remain part of the integration. No new polling interval or cache change
is introduced by this publication.

## Verification and limits

The combined line passed 522 focused tests, TypeScript/web build, syntax/diff checks,
independent composition review and read-only API smoke. Accepted live gameplay
evidence for Belt logistics, Ore Anomaly, Ice, Ore Self-Unload and physical AB Travel
Assist is inherited from the feature lines, not newly repeated during publication.

Not implemented: GAS, adjacent scouting, dedicated operation Defender execution,
operation-owned container scopes, equipment provisioning, citadel relocation,
a general role taxonomy or production password registration. Generic roles without
a support policy use FAST only. Setting a home does not equip or move a pilot.
Fresh-member onboarding, timed-expiry/login-recovery scenarios and the blocked
integrated browser-persistence check retain their documented gameplay/QA limits.

Before updating, review the [runtime patch guide](../pilot-training-runtime-setup.md).
Pilot Training requires the supported EveJS 0.12.9 authority patches in the mutable
gameplay copy; preserve local mods and the normal launcher path. A WC update alone
does not patch EveJS. No runtime was redeployed for this publication.

[Training guide](../pilot-training.md) · [MCC guide](../mining-command-center.md) ·
[ancestry, performance and verification](../DELTA-INTEGRATION.md)
