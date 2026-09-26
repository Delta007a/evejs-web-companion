# MCC overnight control-plane pass

Base `e4ecc900146ba13846d05b6f59ac77f6e3c05c62`, isolated 41 only.
No mining, hosting/grant, Parking, target-selection or recovery authority changed.
No gameplay, services, live-data copy or protected-worktree writes.

## Runtime projection

`miningOperations.publicRuntime` exposes `observedAt` from the server clock,
`recoveryRequired` from the existing ambiguity flag, and per-member `hosted`,
`hostStartedAt`, `hostResumedAt`, expiry and total approved minutes matched to the
exact operation/character/run in the current botHost projection. An ended run's
old expiry is not displayed as an active grant. The latest available ended-host
reason is exposed for DRAFT/failed members; this bounded host history may not
retain every old failure.

The pure `miningOperationRunView` reads only that projection. Remaining equals
earliest hosted expiry minus server `observedAt`, floored at zero. Every configured
member is required in the current model, so haulers count too. Paused but still
owned runs retain a ticking grant. Failed/unhosted members do not contribute an
old expiry. Missing authority produces Unknown/incomplete timing, not a browser
clock fallback. Differing expiries are grouped with pilot names; member details
show each hosted start, expiry and recovery time.

Started is the existing operation start signal. On recovered-unknown operations,
it describes a recovered hosted run; the UI explicitly says the original
pre-crash operation start is unavailable. No new persisted timestamp is invented.

The existing control-plane poll refreshes everything. F5 creates no new start;
401 retains the last projection and labels it stale. Normal sign-in reconnect
replaces it with current server state. There is no local countdown, storage,
snapshot read, extra interval or automatic action. Display times use browser
locale/timezone; duration arithmetic does not use the browser clock.

## Extension and warnings

Run-limit choices still come from the backend `MAX_HOSTED_RUN_HOURS` policy.
The operation card offers only increments fitting at least one currently running,
unexpired member, with eligible/defined-member counts. Backend checks remain
authoritative. Capped fleets explicitly show “Maximum hosted runtime reached”.
Other no-eligible cases explain that no offered increment fits. Stop/Parking
states have no extension controls. Disconnection disables writes.

Results are displayed on the affected card, with pilot names, exact failures,
and “Extension incomplete” for partial results. A new Start clears the prior
run's extension notice. Expiry is always taken from the returned/current server
projection, never optimistically changed in the browser. Existing same-run,
same-target extension and ownership checks are unchanged.

Expiry warning window is 10% of the earliest grant, bounded to 5–30 minutes.
Parking adds a warning that arrival must complete before expiry and cannot be
guaranteed from the remaining time. No route/travel-time estimate is fabricated.
At zero, the UI says deadline reached and cleanup/status may still be pending;
it does not invent STOPPED.

## Crash recovery

RECOVERED_UNKNOWN displays an explicit restart banner: the target was discarded
intentionally, miners are not automatically resumed. Member details distinguish
recovered hosted/waiting pilots, DRAFT needing fresh Start, and unavailable or
expired pilots, including available host refusal text.

**One-click restart is deliberately deferred.** The existing scoped Stop button
is labeled “Stop recovered operation”. Guidance is Stop -> wait for STOPPED ->
review configuration/grant -> normal fresh Start. No Start is chained to Stop,
and no old target is restored. Configured Parking still applies: unavailable
members may leave PARKING_FAILED; the operator must resolve those failures rather
than bypassing cleanup or assuming a safe restart. Other operations are untouched.

## Validation and operator smoke

141 focused UI/projection, reconnect, operation recovery/scoped Stop, and existing
host grant/recovery tests passed. Changed-JS syntax, TypeScript, web build and
diff checks passed; existing unrelated build warnings remain. No new gameplay
tests or broad unrelated suite.

Operator smoke in 41:

1. Start two Standard BELT/Hauler Service operations on distinct targets with a
   sufficiently long grant. Check Started/Expires/Remaining and member details.
2. Extend one (+1h, or +24h beyond 24h). Confirm exact expiry increment, same run
   and target, and uninterrupted work in the other operation.
3. F5; then test expired browser-auth reconnect. Timing must return from server
   state, with no bot restart. Do not interpret a disconnected view as STOPPED.
4. Observe repeated drone/jettison and hauler unload/return cycles; with x0.5
   asteroid volume, watch depletion, relocation, DRAINING tail and catch-up.
5. Stop/Park with sufficient grant remaining. Confirm one operation's cleanup
   leaves the other running. If recovering after an actual crash, follow the
   explicit Stop-then-Start path; do not expect miners to auto-resume.

Seven-day support is finite approval, not an endurance certification. Until
stopped remains absent. Live endurance/depletion verification belongs to the user.
