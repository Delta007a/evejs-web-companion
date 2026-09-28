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
  explicit station or accessible structure with a corporation office, unload to
  the chosen division and confirm both the relevant holds and division before
  returning to the authoritative operation target. No service hauler is required.
- **Fleet Parking:** choose Stay or an available return/dock policy. The parking
  destination is configured separately from delivery and can be an NPC station or
  accessible player structure. Structure dock-only, personal-hangar unload and
  strict corporation-division unload are supported where the selected pilot has
  docking and office access. Start checks all executable members before
  starting any; each member rechecks docking access before its hosted run starts
  and again before live routing/docking. Stop retains graceful
  settlement and reports blocked/failed members rather than pretending they parked.
  For structure search, choose an account-owned pilot in the Parking editor as the
  access reference. This read does not select or control that pilot. A structure
  read failure keeps NPC station results available and shows a warning.

Set delivery destinations explicitly. Unrelated cargo must remain separate from the
operation's mining freight. Existing shared BFF container leases coordinate haulers;
MCC does not introduce a separate operation-owned container scope.
On a hull with a specialised mining hold, delivery uses that hold; general cargo
is left aboard even when it contains ore, so ship supplies are not swept ashore.
Standard Hauler Service and Self-Unload delivery accept an NPC station or accessible
structure with an online office service and a rented office for the member's
corporation. A dockable structure alone does not prove division access. The strict
structure transfer checks the exact chosen division and ship holds after the move;
if either read is unavailable or a fallback landed in the personal hangar, delivery
does not report success. Keep delivery and parking destinations separate.

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
