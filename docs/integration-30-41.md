# Accepted MCC + Pilot Training integration — 2026-09-27

Normal merges preserve both accepted histories on `feature/wc-tokeiito-private-integration`:

- Original 00: `cd258b02e8a8f53b4825e9921efaf12e7c2fdd96`.
- Safety ref: `safety/pre-30-41-integration-20260927`, retained at original 00.
- Accepted 41: `2dd45428fef86991526904f5f728f2810fa50166`, merged as
  `af2f76cf8d282f1fd6f30dfb6aa31acc76b0df64` without conflicts.
- Accepted 30: `d76739a07b78892d225dc91a993712a18cfe0e65`, merged as
  `4df38977a7b6a99a19cc0453c1d5261d875fd979`.

The two textual conflicts composed the standalone routes in `main.ts` and both
Pilot Hangar links. Training's safe Release controls coexist with MCC ownership.
No feature branch was rewritten or modified, and no upstream sync or push occurred.

## Current features

MCC provides Belt, Ore Anomaly and Ice families, Standard Hauler Service and
Self-Unload, locality/resource selection and shared target authority. Stop retains
DRAINING, final partial delivery, ordered logistics tails and catch-up. Parking is
an explicit policy/destination separate from delivery. Timing, grant extension and
restart recovery stay bounded and visible; miners retain `restartSafe:false`.
Travel Assist uses AB effect 6731/MWD effect 6730, continuous owned activation and
near-target/target-loss cleanup without switching off externally activated modules.
Ice requires Ice Harvesters and does not use ordinary Mining Drones; defensive
combat-drone handling remains available.

[Pilot Training](pilot-training.md) uses up to three generic corporation-fitting
contracts per role, stable configuration IDs, explicit targets and recursive FAST
prerequisites. Fresh roles start empty; legacy selected contracts migrate without
inventing fixed hull stages. Accepted fitting changes require review. New trainee
and existing-account workflows reuse authoritative creation/recovery. Optional
non-CEO onboarding, exact SELF/configured-wallet funding, direct Buy Skill, and
separate reviewed append-only queue application retain their authority checks.
Homes are generic NPC locations, not a hard-coded station. Release never becomes
a force-logout control for another owner.

Feature histories: [foundation/Parking](mining-playable-foundation.md),
[locality/Travel Assist](mining-locality-travel-assist.md),
[Ore/Ice](mining-site-families.md), [Self-Unload/propulsion](mining-self-unload-propulsion.md),
[resource/grants/recovery](mining-resource-grants-reconnect.md).

## Survival matrix

PASS means source survival plus scoped mechanical evidence, not repeated endurance
gameplay. The after-41 tree exactly matched accepted 41 before integrating 30.

| Contract | After 41 | After 30 |
| --- | --- | --- |
| Combined one-snapshot observation | PASS | PASS |
| Mining Command Center | PASS | PASS |
| Belt operation | PASS | PASS |
| Ore family | PASS | PASS |
| Ice family | PASS | PASS |
| Self-Unload | PASS | PASS |
| Travel Assist explicit effects | PASS | PASS |
| Fleet Parking | PASS | PASS |
| Pilot Training | N/A | PASS |
| `/pilot-training` | N/A | PASS |
| `/goblin-factory` redirect | N/A | PASS |
| Generic qualifications/migration | N/A | PASS |
| Direct Buy Skill | N/A | PASS |
| Onboarding/rights | N/A | PASS |
| SELF funding/journals | N/A | PASS |
| Queue review/apply | N/A | PASS |
| Pilot Hangar/session release | PASS | PASS |
| Session ownership guards | PASS | PASS |
| Build/typecheck | PASS | PASS |

`/api/bridge/script/observation` still derives space and drone-space from one fresh
full snapshot. MCC locality consumes that observation; no second acquisition was
added. Standalone Training/MCC pages do not initialize cockpit polling. Mutation
and drone-recovery confirmation reads retain their independent freshness.

## Validation and integrated smoke

- After 41: 83 focused tests passed, then TypeScript/web build passed.
- Combined scope: 522 distinct tests passed after focused repairs/reruns: shared
  123, MCC 178, Training 181, auth/hosted stop 40. Four optional runtime-source/data
  tests were explicitly enabled and passed; no broad repository suite ran.
- Two stale accepted test assertions were repaired without changing product code:
  CharacterCreate attribute ordering/generic qualification label, and the optional
  propulsion verifier's compatibility with extracted EveJS source modules.
- TypeScript, web build, changed-JS syntax and diff checks passed. Existing Svelte
  accessibility/bundle-size and Node module-type warnings remain.
- Independent GPT-6 Sol / High read-only composition review found no actionable
  issue in shared routes, auth, ownership, observation or runtime artifact survival.
- Runtime manifest: all five deployed file hashes match accepted 30. Patch artifacts
  remain identical; no runtime source, loader or clean-reference file was changed.
- WC00 QA PID 39120 used the existing modded launcher runtime, with persisted bot
  resume disabled. `/`, `/pilot-training`, `/mining-command-center` returned 200;
  `/goblin-factory` returned 308 to `/pilot-training`.
- BMiner10's documented migrated contract replayed idempotently and the live read
  confirmed fitting 11's accepted date/fingerprint, 13/13 hard requirements trained,
  READY skills, UNKNOWN equipment, idle queue and no FAST delta. Corporation/wallet
  and NPC-home names resolved. No pilot selection or gameplay/financial/queue
  mutation occurred; ownership remained OFF. Training login set no cockpit cookie.
- Live MCC capabilities resolved Belt/Ore/Ice Hauler Service and Self-Unload profiles,
  with GAS disabled. Hangar rendering/link/Release tests passed and its HTTP shell
  loaded. QA request logs contained no space/observation polling; stderr was empty.
- WC00 and its helper exited; port 26500 was free. Launcher 24564 and its original
  modded runtime 19268 remained running. The ignored 00 `.env` changed only
  `EVEJS_ROOT` from the older Beta tree to `EveJS-0.12.9-test`, matching the smoke.

## Verification limits

Existing accepted Belt E2E, Ore Anomaly, Ice, Ore Self-Unload and physical AB gameplay
evidence is inherited from 41; those long/mutating checks were not repeated.
The integration smoke is API-based. Yandex Computer Use was blocked by unsupported
URL-policy enforcement, so actual saved browser storage/F5 and a newly rendered
integrated UI were not reverified; documented-contract migration and live authority
reads are not a claim of a fresh browser-persistence check. Chrome was untouched.

The running gateway reports runtime readiness, but its character-event adapter
reports `gatewayToken:false`/`ready:false`; this pre-existing optional-stream setup
was not changed. Read endpoints used for smoke succeeded. No concurrent live bot
ownership race was exercised; that boundary has focused tests and source review.

GAS, adjacent scouting, dedicated operation Defender execution and operation-owned
container scopes remain unsupported. Equipment provisioning, citadel relocation,
and a new production password system remain out of scope. Generic roles without
a support policy keep FAST only. Fresh-member onboarding still needs its separate
live QA; this task did not repeat purchases, funding, queue writes or role grants.
The integrated source is ready for a separate publication review with these limits;
it has not been published and no new blanket gameplay acceptance is claimed.
