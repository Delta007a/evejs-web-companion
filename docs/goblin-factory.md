# Goblin Factory

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
- `POST /api/pilot-training/queue/review`: read-only, authoritative append review.
- `POST /api/pilot-training/queue/apply`: explicit, confirmed, one-shot application
  of an account-bound review. It cannot accept a browser-authored replacement queue.

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
- `goblin-factory:last-apply:v1:<account>:<characterID>`: compact last-attempt
  mode/stage, timestamp, status, added count and verification result. No tokens,
  review handles, full skill sheets or queues are persisted in this audit record.

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
Only an explicit reviewed Apply changes the queue. There is no automatic progression.

Target rows distinguish trained level from target level. Internal `MISSING` is
displayed as **NEEDS TRAINING** and means the
target level is neither trained nor queued; a lower level may already be trained.
Unreadable skill input remains UNKNOWN. The historical Mining Drone Operation I
observation cannot be conclusively explained from source: no deterministic ID or
normalization defect was found. Tests protect trained-I versus target-II semantics,
but do not claim to reproduce that historical pilot's snapshot. The later BMiner9
observation is consistent with an absent skill appearing only in Support/Mastery.

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
   roster and training endpoints. No select, snapshot or bot-host requests should
   originate from the Factory tab. Queue Apply occurs only after its explicit button.
8. If another cockpit is already open, verify its selected pilot and account stay
   unchanged while Factory reads other accounts. No gameplay launch is needed.

## Reviewed queue append

Authority in the inspected EveJS 0.12.9 Beta runtime:

- `server/src/_secondary/express/evejsWebGateway.js`: account-owned GET `/skills`,
  GET `/character-status`, POST `/skill-queue` under `/_evejs-web/v1`.
- `evejsWebGatewayRuntime.js`: `buildSkillSheet`, `getCharacterControlStatus`,
  `normalizeSkillQueueCommandPayload`, `submitSkillQueueSaveCommand`.
- `server/src/services/online/characterCommandRuntime.js`: strict envelope,
  per-character command lane, offline authorization and expected-state-version check.
- `server/src/services/skills/training/skillQueueRuntime.js`: `validateQueueEntries`,
  `saveQueue`, `getQueueSnapshot` and `getSkillRecordForProjection`.

Two Luna 6 high-reasoning agents audited authority/concurrency and ordering/injection
read-only. Root checked source independently and resolved two misleading phrases
in the authority audit: `/character-status` exposes flat fields, not a nested
`control` object; validation requires each consecutive level, not a jump to a
multi-level target. No runtime source was changed or executed during the audit.

### Merge and confirmation

The runtime queue is ordered `{typeID, toLevel}` rows. Its validator requires
exactly the next level based on trained levels plus preceding queued rows.
Trained I with queued II and target III appends only III. Partial SP never counts
as a completed level. Factory previews are alphabetical display rows; the append
planner separately walks authoritative dogma prerequisites in dependency-first
order and expands consecutive missing levels. The existing queue remains an exact
prefix, including unrelated skills. No deletion, reordering or partial plan save.

Review shows the existing queue, ALREADY_TRAINED / ALREADY_QUEUED / WILL_APPEND /
BLOCKED / UNKNOWN coverage, exact additions and activation behavior. A nonempty
paused queue stays paused; an empty queue starts training, explicitly shown before
Apply. The current stage and mode are pinned: a Pioneer MASTERY review cannot
silently become Procurer. Current accepted fitting, skill and queue authority are
required. Missing injected skills return SKILLBOOK_REQUIRED (runtime equivalent:
QueueSkillNotUploaded); nothing purchases or injects a book.

Capacity comes from the skill sheet's `queue.maxEntries` (currently 150). Complete
overflow blocks before submission. Clone restrictions, the 10-year duration limit,
Alpha SP caps and account training slots remain authoritative save-time validation;
the current read API does not expose enough data for full preflight of those rules.
They refuse the complete save rather than applying a partial plan. Preserving the
head and active state avoids the normal pre-validation active-skill rebase path.

### Concurrency and verification

The BFF keeps at most 100 review records, expiring after five minutes, tied to the
authenticated account and exact character. Refresh/F5/mode/fit changes discard
the browser review; no Apply is replayed. Applying consumes the handle immediately.

Both review and Apply read control/version, live fitting+skills/queue, then control/
version again. Apply compares the reviewed version, trained levels, complete queue
and training instants, and the selected plan/fitting fingerprint. Any drift refuses
with QUEUE_CHANGED / PLAN_CHANGED / REVIEW_REQUIRED. It never recomputes and saves
a new unreviewed delta. The outgoing command has server-owned IDs, type
`offline.skill_queue.save`, `expectedStateVersion`, and `{entries, activate}`.
The gateway checks ownership and rechecks version/offline control inside its lane.
Online retail/browser/bot-controlled pilots are refused, never released or claimed.

**Authority limitation:** this is a command/control revision, not an atomic queue
CAS. Direct administrative `saveQueue` calls and natural completion do not advance
it. Fresh queue/level comparison detects changes before submission; runtime
validation rejects obsolete completed rows and control transitions protect normal
retail edits. An unversioned administrative edit in the final read-to-write interval
cannot be excluded without a runtime enhancement. Avoid those administrative edits
during Apply. No claim of universal atomic queue concurrency is made.

After POST, the BFF always rereads `/skills`, even after a failed acknowledgement.
It verifies the complete merged queue and active state, allowing only a leading
prefix proven trained by natural completion; an unchanged active head must retain
its start instant. The fresh queue is returned even if fitting/report refresh fails.
HTTP 200 alone cannot produce success. Mismatched/unreadable confirmation and
ambiguous transport errors are APPLY_UNVERIFIED. No rollback or automatic retry.
Runtime refusals retain their codes. A subsequent fresh review produces Nothing
to add when the plan is already covered. ETA uses the existing effective server
queue timestamps, including configured x50 behavior, without a copied rate formula.

### Short BMiner9 QA (operator only)

1. Open `/goblin-factory`, find BMiner9, select MINER. Confirm the expected baseline:
   PIONEER proven, next PROCURER, Procurer NOT_READY. Keep this pilot offline.
2. Expand its current queue and record its entries/order. Choose FAST; press
   **Review FAST append → PROCURER**. Check injected-skill blockers and exact delta.
3. Only if the review is acceptable, press **Apply FAST plan → PROCURER**. Confirm
   APPLIED / Verified yes and that old entries remain the unchanged prefix.
4. F5. Confirm the queue persists, targets are QUEUED/TRAINING as appropriate,
   accepted fits remain, and last-apply metadata persists. Review FAST again:
   already-covered targets should say Nothing to add, with no further submission.
5. Test BALANCED only after FAST is proven. Leave MASTERY's deliberate level-V
   targets for a later conscious test. If a book is missing, stop at the refusal;
   buying/injecting it is outside this feature.
