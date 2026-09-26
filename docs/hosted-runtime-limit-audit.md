# Hosted runtime limit audit (isolated 41)

Base: `e2dd96a24ab9892ee127f5945627f889ce7859a4`.
No gameplay, service restart, live-data copy, merge, promotion, runtime/mod edit,
or changes to other worktrees. Gateway source was read only.

## Finding: 24 hours was an enforced WC policy, not a protocol requirement

The original enforcement and presentation path:

| Layer | Original bound / behavior |
| --- | --- |
| `web/src/ui/MiningOperations.svelte` | Start presets 1/4/12/24h; extension buttons, confirmation and eligibility hard-coded to a 24h total. |
| `BotManagerPilotRow.svelte`, `BotManagerGroupRow.svelte` | Saved-script duration selectors stopped at 24h. Other companion launch paths used a 12h default, not another 24h maximum. |
| `src/server.js` | Authenticated MCC Start derives members/scripts; forwards each member's exact revision/risk/duration grant to botHost. Extension derives members and caller itself. No independent 24h validator here. |
| `web/src/bots/runPolicy.ts` | `MAX_SERVER_BOT_RUNTIME_MINUTES = 24 * 60`; validator enforced it for Start, restart and extension via botHost. |
| `src/botHost.js` | Start calls shared validator. Extension allowed +1/+4/+12/+24h and validated the cumulative approved minutes; no reset from now. |
| `src/webAuth.js` | Both `createBotSessionToken` and `extendBotSessionToken` refused deadlines more than 24h ahead. These were defense-in-depth policy checks, not a signing-format limitation. |
| Timer / roster / gateway | No additional 24h constant in the hosting path. The 12h browser token/cookie is separate from the host token. |

## Timer mechanics and audited ceiling

`botHost.armDeadline` uses Node `setTimeout` directly, not chunked timers.
Node's own `internal/timers` source on the task host specifies `TIMEOUT_MAX =
2 ** 31 - 1`: delays above 2,147,483,647 ms become **1 ms**, not a long wait.
That is about 24.855 days. The largest whole-hour policy compatible with this
implementation is **596h** (2,145,600,000 ms). Seven days is 604,800,000 ms.
Tests create and immediately clear actual timers for both limits and check that
Node retained the requested delay. They do not wait or launch gameplay.

Configuration rejects anything beyond 596h, fractional/invalid hours, zero or
infinity. No timer chunking or new cadence was added. Recovery now also rejects
an absolute deadline farther away than its approved runtime, before credentials,
claims or a timer are created. Existing callback invalidation remains: each
callback captures its expiry and returns if the record has a different expiry
or is finalized. Extension clears/rearms the timer without an asynchronous gap
after its final live checks. Event-loop stalls/system suspension can still delay
callbacks; this is finite scheduling, not a guarantee of real-time execution.

## Credentials, gateway and cleanup

* Browser login remains a 12h signed per-tab session. Browser expiry does not
  terminate an independent hosted session.
* Handoff validates/reserves ownership before releasing the calling browser's
  held character. botHost mints a separate signed session ID and private claim;
  the browser token's expiry is not copied to the hosted run.
* Hosted tokens use numeric absolute millisecond expiry and HMAC signatures.
  They now accept the configured runtime plus the existing **5-minute cleanup
  margin**. Extension re-signs the same session/account/issued-at identity and
  updates only the flow's credential. No login, select or recovery is repeated.
* `requireAuth` still verifies signature/expiry/account/banned status. Tokens and
  private claims are not written into the restart roster.
* Read-only source audit of
  `EveJS-0.12.9-test/server/src/_secondary/express/evejsWebGatewayRuntime.js`:
  `DEFAULT_BROWSER_SESSION_IDLE_TTL_MS` is 30 minutes. `expireIdleBrowserSessions`
  and `getBrowserSessionEntry` compare `lastUsedAtMs`, not creation age. Bridge
  calls/reads refresh usage; subscribers also refresh it. There is no fixed 24h
  lifetime here. Existing runner observations/host sampling provide activity;
  this change adds no keepalive, snapshot reads or polling. Gateway loss,
  takeover, process death and long inactivity can still end a session normally.
* Expiry still crosses existing graceful Stop, including authoritative drone
  return. The 3-minute expiry cleanup bound and 5-minute auth margin are unchanged.
  Unconfirmed cleanup remains visibly blocked, not falsely stopped. Parking
  must finish within the grant and cannot be resurrected by extension.

## Configuration and UI

`MAX_HOSTED_RUN_HOURS` is read once at BFF startup (documented in `.env.example`).
Default: **168h / seven days**. Accepted: whole hours 1..596. Invalid configuration
fails explicitly instead of silently clamping or allowing an overflowing timer.
One pure shared module, `web/src/bots/hostedRunPolicy.ts`, owns defaults, timer
ceiling, choices and labels. Backend grant and token checks use the same resolved
policy; the shared validator receives the server limit explicitly.

MCC and Bot Manager use policy metadata on their existing authenticated roster
responses. No extra endpoint or polling loop is needed. Default choices are
1/4/12/24/48/72 hours and 7 days; a configured cap is included and larger choices
are removed. The initial selection remains 12h (or the smaller configured cap).
Unknown policy yields no duration choices, not an assumed permissive maximum.

The maximum still means **cumulative approved runtime for one run**, not a rolling
remaining-time allowance. Thus 24h +24h =48h, then +24h =72h, regardless of elapsed
time. Extension does not reset expiry from now, replace the bot/run ID, mutate
the target, restart a script, or disturb drones/logistics. It remains restricted
to valid running operation-owned members and the initiating account. Partial
results and foreign-operation refusal remain unchanged. Elapsed grants, begun
Stop/Parking/expiry cleanup, or missing historical ownership cannot be extended.

## Restart / recovery: important existing limitation

The atomic roster stores absolute `expiresAt`, cumulative `maxRuntimeMinutes`,
exact script revision/hash, risks and operation/controller association. Recovery
revalidates account, script, grant, ownership and recovery gates. It preserves
the deadline (downtime consumes the grant), mints a new bounded hosted session,
and arms only the remaining duration. It does not add seven days from restart.
Lowering the configured cap can refuse previously approved longer roster entries;
expired or changed-script entries also refuse normally.

Recovery is **not an uninterrupted-run guarantee**: a recovered runner gets a
new run ID and starts the unchanged restart-safe routine from step one. The old
current mining target is not trusted across process restart; existing operation
reconciliation applies. A live extension, by contrast, preserves run and target.

Actual Standard profile analysis is unchanged: all three Standard miners are
`restartSafe: false` (mining drone/combat management and jettison). They require
fresh manual Start after a WC restart, for short and long grants alike. Standard
haulers are `restartSafe: true` and may recover if all other checks pass. No
combat/restart policy was weakened to advertise seven-day operation.

**Until stopped remains deferred.** Timers, credentials and recovery are designed
around finite approval; indefinite renewal and cleanup authority are not proven.
The 596h ceiling is a mechanical bound, not an endurance certification. Seven days
is the conservative default, with gameplay/endurance validation left to the user.

## Verification / shortest operator smoke

Focused tests cover old/new grants, configuration rejection, actual timer range,
24->48->72h same-run extensions, stale callbacks, ownership isolation, partial
results, Stop/Parking refusal, absolute-expiry recovery, signed long credentials,
mock-BFF browser handoff and policy-driven UI. Existing MCC no-snapshot test is
included. **175 focused tests passed** (re-run after the interrupted session),
as did changed-JS syntax, TypeScript typecheck, one web build and diff checks.
Existing unrelated bundle-size/UI warnings remain. No live service is used by
the mock HTTP tests.

Later, in 41 only: launch with 24h, add +24h twice; verify 48h/72h total approval,
expiry increments exactly, and the same run/target continues. Confirm seven-day
choice and configured cap. Test recovery separately with a restart-safe routine;
do not expect Standard miners to auto-resume after restarting WC. No services were
restarted by this task.
