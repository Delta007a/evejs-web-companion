# Mining Command Center

Open `/mining-command-center`, or use its link in Pilot Hangar. MCC coordinates
several pilots through approved server-hosted runs and a shared target board.
It can remain active after the browser closes. EveJS still owns gameplay authority.

## Choose an operation

Select a supported family, anchor system, members and logistics mode. Standard
profiles provide the operation-aware routines; compatible custom scripts remain
subject to the operation's target contract.

| Family | Requirements and behavior |
| --- | --- |
| Belt | Belt geometry, shared rock/target authority and ordinary ore mining. |
| Ore Anomaly | Current-system scanner identity; ordinary ore-site mining. |
| Ice | Ice-site identity and suitable online Ice Harvesters; an ore-only fit is refused. Ordinary Mining Drones do not harvest Ice. |
| GAS | Unsupported. |

Locality and resource preferences guide eligible selection. Members follow the
current operation target rather than independently choosing their nearest belt/site.
Defensive combat-drone handling remains available where the miner supports it;
it is not a dedicated operation Defender/escort implementation.

## Logistics and Stop

- **Hauler Service:** miners dump mining freight for haulers. Depletion waits for
  miner settlement and final partial loads. Haulers drain the old target, verify
  grid and freight completion, deliver, then catch up to the current target.
- **Self-Unload:** miners settle modules and drones at the threshold, travel to an
  explicit station/division, unload and confirm the relevant holds are empty before
  returning to the authoritative operation target. No service hauler is required.
- **Fleet Parking:** choose Stay or an available return/dock policy. The parking
  station is configured separately from the delivery station. Stop retains graceful
  settlement and reports blocked/failed members rather than pretending they parked.

Set delivery destinations explicitly. Unrelated cargo must remain separate from the
operation's mining freight. Existing shared BFF container leases coordinate haulers;
MCC does not introduce a separate operation-owned container scope.

## Travel Assist and hosted runs

Travel Assist uses explicit AB/MWD effects to change actual ship motion. It keeps
its owned propulsion module active during the same approach, turns it off near the
target, and cleans up on target change/loss. It leaves externally activated modules
alone. Module acceptance and observed speed are distinct diagnostic facts.

Approve a finite hosted duration and watch remaining time, grant differences and
recovery messages. Extensions respect the configured cap. Restart recovery does not
make unsafe miners restartable; resolve the displayed ambiguity before a fresh run.

## Limits and evidence

GAS, adjacent-system scouting and dedicated operation Defender execution are not
implemented. Current-system scanner data is not a substitute for remote discovery.
Equipment provisioning and citadel relocation are outside this feature.

Accepted feature-line gameplay covers Belt logistics, Ore Anomaly, Ice, Ore
Self-Unload and physical AB Travel Assist. The combined integration adds focused
tests and API smoke, not another endurance acceptance run. See
[integration status](DELTA-INTEGRATION.md) and the [detailed record](integration-30-41.md).
