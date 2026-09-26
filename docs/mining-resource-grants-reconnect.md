# MCC resources, live grant extension, and control-plane reconnect

Base: `c8ea5f51ea37a223cfffc41f5121ec2856921316` in isolated 41,
`feature/mining-operations-playable-foundation`. No gameplay, service restart,
live data copy, runtime/mod edit, merge or promotion.

## Source audit and resource policy

Existing `scriptMacros.operationMineAtTarget` already gates family, target claim,
arrival and compatible resources before the common `mineWithRocks` picker.
Snapshots expose `miningYieldTypeID`, authoritative `miningResourceFamily`,
remaining quantity and coordinates. Preference uses the yielded inventory type,
not the asteroid entity's display name or visual type.

Existing candidate belt entities provide identity/coordinates, not an observed
inventory of remaining resources in every belt. Scanner site rows similarly
provide site/instance identity, family archetype and coordinates, not current
rock composition. BELT, ORE_ANOMALY and ICE therefore retain existing target-level
family -> availability/depletion -> fleet locality -> stable key -> atomic claim.
No remote composition is inferred, and caller-supplied composition cannot change
this ranking. Cross-target resource scoring is deferred until an authoritative
composition source exists. No remote/scout reads were added.

Persisted policy, nested in the existing version-1 `policies` object:

```json
{"resourcePolicy":{"mode":"PREFER_LIST","source":"MANUAL","typeIDs":[1230,1228]}}
```

Missing policy defaults to `ANY_ELIGIBLE`, `MANUAL`, empty IDs. Prefer requires
1–20 unique positive type IDs. Unknown modes/sources fail closed. The old
`resourceTarget: ANY_ELIGIBLE` eligibility seam remains backward compatible.
Industry may eventually supply this same ordered-ID contract; no Industry source
is executable now.

The compact searchable picker reuses `staticData`'s published item-type catalog,
the existing `miningResourceFamily` category/group classifier, and EveJS's
`reprocessingStatic.sourceTypesByCompressedTypeID` map to exclude compressed
products. Gas/unrelated/unpublished types are excluded. Missing static authority
disables the preference catalog, not Any-eligible operations. Save and Start
validate IDs against the selected family; names are display-only.

Inside an assigned active target, new rock selection is:

1. Existing compatible, observed resource set.
2. Lowest available index in the preferred list; otherwise all eligible resources.
3. Existing resource-distance/pick rules within that rank.

An already worked rock remains stable until it disappears/depletes; no mid-cycle
module/drone retarget is introduced. Losing the first preference never empties
the full resource set or marks the target depleted. Existing depletion and
same-family relocation remain authoritative. Standard miners receive the policy;
Custom routines receive no implicit override and retain strict existing preflight
(including rejection of conflicting explicit resource selectors).

## Live grant extension

`POST /api/mining-operations/:operationID/extend`, `{ "minutes": 60 }`, accepts
increments 60/240/720/1440. The route derives members and caller account itself;
client-supplied bot IDs/member IDs/controller IDs are not used.

The initiating control-plane account ID is captured from authenticated Start,
stored with each hosted operation association, and preserved in the restart
roster. botHost checks this controller, operation ID, live pilot claim, running
status, and unexpired deadline. Old recovered records without controller identity
cannot be extended by guessing ownership. Normal fresh launches establish it.

Each successful extension adds to the **existing expiry** and approved runtime,
using the existing grant validator. The existing **24-hour total approved runtime
per run** limit is retained, not reset from now. For example a 12h grant can gain
another 12h, but a 24h grant cannot gain more time in this pass. Disabled UI buttons
explain the cap. Mixed fleets report exact per-member results; unavailable or
failed members are never started/resumed. Partial extension is not rolled back.

The internal auth renewal re-signs the same session/account/issued-at identity
with the extended expiry plus the existing cleanup margin. It replaces only the
flow's per-session credential. No login, select, recovery, new claim, script
restart or target release/reselection occurs. No credential is written to disk.

After stack loading, the final checks, signed-token replacement and deadline
rescheduling run without an asynchronous gap. Old queued timer callbacks compare
their captured expiry and cannot stop an extended run. Elapsed deadlines,
expiryRequested, in-progress graceful Stop and operation Stop/Parking all refuse
extension. A stopping run cannot be resurrected. Roster persistence retains the
new expiry and approved duration under its existing atomic-write behavior.

## Browser authentication

WC uses signed per-tab browser sessions and an ordinary `/api/login` path; it has
no refresh-token endpoint. That login can also create an unknown account, so MCC
does not silently invent or re-login an account from an expired token. It offers
the normal account sign-in form instead. No new browser credential storage or
authentication bypass is introduced.

On 401 the read-only polling controller cancels scheduled polling, marks the page
disconnected and retains the last fleet projection and editor. The sign-in form
appears above that retained view. Successful ordinary login replaces the tab
token, then resumes read-only status polling automatically. It never calls
Stop/Start/logout/select for hosted pilots. Non-auth transport failures use
bounded 6/12/24/30-second backoff; ordinary healthy reads remain at three seconds,
with no overlapping requests. No hidden aggressive auth retry loop exists.

## Verification and files

297 focused tests passed, covering catalog/policy validation, real family mining decisions,
priority-over-distance and fallback, unchanged locality, grant ownership/cap,
expiry races, unchanged runners/targets, same-session credential renewal, partial
results, real mock-BFF routes and auth reconnect, and read-only polling. Adjacent
Parking, propulsion, drone, scanner/site, profile and snapshot tests remain scoped.
Typecheck and web build passed. Existing warnings remain in untouched UI files
and the large App bundle. Changed-JS syntax and diff checks are recorded in the
handoff. No generated build files are committed.

Production files: `src/miningResourcePolicy.js`, `miningOperationPolicies.js`,
`miningOperationGrant.js`, `miningOperations.js`, `staticData.js`, `botHost.js`,
`webAuth.js`, `server.js`; `web/src/nav/resourcePriority.ts`, `scriptConditions.ts`,
`scriptMacros.ts`; `web/src/app/controlPlanePoll.ts`, `api.ts`, `flow.ts`;
`web/src/ui/MiningCommandCenter.svelte`, `MiningOperations.svelte`.

Tests: `test/miningResourcePolicy.test.js`, `miningResourceCatalog.test.js`,
`miningOperationGrant.test.js`, `miningOperations.test.js`,
`miningOperationsRoutes.test.js`, `webAuthSession.test.js`; `src/botHost.test.js`;
`web/src/app/controlPlanePoll.test.ts`; `web/src/nav/miningOperationMacros.test.ts`.

## Short manual smoke (operator only)

1. In 41, configure a Standard operation with two preferred catalog resources.
   On its assigned target verify the first available preference wins, then the
   second, then same-family fallback. Repeat Ice with Ice IDs; do not expect remote
   belt/site composition ranking or a target change when one ore runs out.
2. Start with 1h under your MCC account. Note member expiry/target/run identity;
   choose +1h. Expect expiry +1h with the same bot, target and ongoing work. A
   different initiating account, stopped member, or over-24h total must refuse.
3. In an isolated browser test, substitute an invalid tab token using browser
   developer tools (no server change). Wait for one 401: polling must stop and the
   last display remain. Use the displayed normal sign-in form with the same
   account. Live status should resume without touching hosted bots.

No new space reads or fast loops; no changes to propulsion, Parking policy,
drone policy, families, scouting, GAS or Industry automation.
