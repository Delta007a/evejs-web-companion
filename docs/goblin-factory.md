# Goblin Factory (read-only)

## Entry and authority

Open `/goblin-factory` on the Web Companion origin. `main.ts` imports the Factory
instead of `App.svelte` on that path, so cockpit restoration, pilot selection,
space polling and bot hosting are not initialized. The existing Express SPA
fallback supports direct navigation and F5 on the same server/port. Pilot Hangar
and the former Pilot Training panel link to the standalone page.

There is no Mining Command Center shell in this feature checkout's base. This
entry uses the existing SPA and global styles without importing a pilot workspace.

The page discovers remembered accounts from `evejs-web-known-characters:v1`,
Factory accounts, and the current normal WC authentication. It lists all live
account-owned characters returned by the roster authority. Remembered identities
are hints only; failed refreshes clear previous qualification results.

- `POST /api/goblin-factory/login`: normal local-emulator web authentication,
  existing accounts only. Never auto-creates an account or replaces a cockpit's
  cookie. Tokens are held only in the Factory's memory and sent per request.
- `GET /api/pilot-training/characters`: authenticated account roster.
- `GET /api/pilot-training/miner`: ownership and corporation checked using
  `eveStore.listCharactersForAccount` / gateway `/characters`, then existing
  `corpFittingMgr.GetFittings` and gateway `/skills`. Membership is checked again
  after the fitting read. No broad `/snapshot`, selected bridge session, session
  claim, or gameplay-control acquisition is needed.

Training endpoints use the same auth verification with session/cookie cleanup
disabled: expired or rejected discovery credentials cannot release a held cockpit.
The normal gameplay auth middleware keeps its existing cleanup behavior.

The fitting authority uses an unregistered per-call session as before. The EveJS
read service may initialize an empty fitting-store entry internally; this page
does not invoke a fitting mutation. Local-emulator authentication is unchanged:
account names are not secrets and this is not a new production authentication model.

## Persistence

Accepted fitting selections keep their exact existing key and schema:

`pilot-training:miner:<account>:<characterID>`

The value remains the bare stage map containing corporation owner ID, fitting ID,
accepted saved date and accepted fingerprint. There is no migration or second
fitting configuration source. Choosing a fitting and accepting its current version
write only this browser configuration and then re-read the authoritative report.

New local preferences:

- `goblin-factory:pilot:v1:<account>:<characterID>`: explicit role (`MINER` or
  unassigned) and preview mode (`FAST`, `BALANCED`, `MASTERY`).
- `goblin-factory:accounts:v1`: accounts explicitly added on this page.

Existing fitting selections do not automatically assign a role. Select MINER once
for each pilot. Account prefixes never assign roles. Malformed local configuration
blocks the read and is not overwritten automatically. Preferences are per browser
origin, not server-synchronized. Keep the same origin/port to retain existing data.

Refreshes are manual and serialized across accounts/pilots. Configuration controls
are disabled while reading; stale in-flight results are discarded on teardown.
The page shows the read time and does not poll. Multiple Factory tabs are not
live-synchronized: refresh after editing another tab. Writes read the current stage
map first, but simultaneous edits to the same stage remain last-write-wins.

## Preserved qualification semantics

The selected corporation fitting is the stage's single equipment contract. Strict
validation, expected hull matching, saved-date plus canonical content fingerprint,
and explicit review acceptance remain unchanged. Malformed, missing, changed or
unreadable fittings cannot qualify a stage. Support policy remains independent.

The highest independently READY stage is displayed, even if an earlier stage's
fitting is unavailable. Each stage retains its own status; this does not qualify
the earlier stage. FAST/BALANCED target the next stage, MASTERY the current stage.
No queue writes or automatic progression occur.

Target rows distinguish trained level from target level. `MISSING` means the
target level is neither trained nor queued; a lower level may already be trained.
Unreadable skill input remains UNKNOWN. The historical Mining Drone Operation I
observation cannot be conclusively explained from source: no deterministic ID or
normalization defect was found. Tests protect trained-I versus target-II semantics,
but do not claim to reproduce that historical pilot's snapshot.

ETA continues to consume effective server queue completion timestamps, including
configured runtime speed. Uncovered arbitrary plans remain UNKNOWN; there is no
retail estimate or hardcoded x50 multiplier. Equipment remains UNKNOWN and no
status represents provisioning or readiness for duty.

Roster filters describe the selected plan: review takes priority, unknown targets
remain Unknown, completed targets are “Plan ready · skills only”, an active queue
is Training, and otherwise known unmet targets are Not ready. Queue state is also
shown separately; an active queue need not cover the selected plan.

## Manual verification (later, against this feature worktree)

1. Use the same browser origin that held the previous accepted fitting selections.
   Open `/goblin-factory` directly, without selecting a cockpit pilot.
2. Confirm remembered account/character identities appear. Add a known existing
   account if needed. An unknown account must be refused without creation.
3. Assign MINER explicitly. Inspect Venture/Pioneer/Procurer and confirm previous
   fitting IDs, saved dates and fingerprints are retained. Reload with F5 and
   verify role, plan and accepted fits remain.
4. Inspect a pilot with a known skill level. Compare target and trained columns,
   including Mining Drone Operation. Queued/training levels must not grant READY.
5. Switch FAST/BALANCED/MASTERY. Check differing targets and honest UNKNOWN ETA
   when the existing queue does not cover the plan.
6. Select another existing matching-hull fitting. It must need explicit acceptance;
   acceptance changes local configuration only. Review any naturally changed saved
   fitting after refresh; do not mutate gameplay data merely to run this check.
7. In browser Network tools, confirm Factory interaction uses only its login,
   roster and training endpoints. No select, snapshot, bot-host or queue-write
   requests should originate from the Factory tab.
8. If another cockpit is already open, verify its selected pilot and account stay
   unchanged while Factory reads other accounts. No gameplay launch is needed.

Before future queue writes, separately verify live sheet normalization for the
historical pilot, queue prerequisite/injection validation, effective runtime ETA,
account training-slot limits, concurrent bot/browser ownership, and authoritative
readback/error handling. None of those write paths are enabled by this change.
