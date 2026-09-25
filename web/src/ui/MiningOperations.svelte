<script lang="ts">
  import { onMount } from "svelte";
  import {
    deleteMiningOperation,
    findMapLocations,
    getMiningOperationLaunchPlan,
    listOperationAccountPilots,
    listOperationRoutines,
    loadMiningOperations,
    resolveDestination,
    saveMiningOperation,
    startMiningOperation,
    stopMiningOperation,
    type OperationPilotChoice,
    type OperationRoutineSummary,
    type MiningOperationDefinition,
    type MiningOperationMemberDefinition,
    type MiningOperationsPayload,
  } from "../app/api.ts";
  import { loadHangarPrefs } from "../app/hangarPrefs.ts";
  import { loadKnownCharacters } from "../app/knownCharacters.ts";
  import { decodeScriptValue } from "../bots/scriptCodec.ts";
  import { analyzeBotRunPolicy, createBotLaunchGrant } from "../bots/runPolicy.ts";
  const opts = () => ({});
  let payload = $state<MiningOperationsPayload | null>(null);
  let scripts = $state<OperationRoutineSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let pollError = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let editing = $state(false);
  let runtimeMinutes = $state(12 * 60);
  let readiness = $state<Record<string, { key: string; message: string | null }>>({});

  type DraftMember = MiningOperationMemberDefinition;
  let operationID = $state<string | undefined>(undefined);
  let name = $state("");
  let anchorSystemID = $state(0);
  let anchorSystemName = $state("");
  let anchorError = $state<string | null>(null);
  let systemMatches = $state<readonly { id: number; name: string }[]>([]);
  let systemLookupSerial = 0;
  let reach = $state<"CURRENT_SYSTEM" | "CURRENT_AND_ADJACENT">("CURRENT_SYSTEM");
  let belt = $state(true);
  let oreAnomaly = $state(false);
  let unloadPolicy = $state<"HAULER_SERVICE" | "SELF_UNLOAD">("HAULER_SERVICE");
  let unloadStationID = $state(0);
  let unloadStationName = $state("");
  let unloadStationSystemName = $state("");
  let unloadDivision = $state(1);
  let stationMatches = $state<readonly { id: number; name: string; systemName: string }[]>([]);
  let destinationError = $state<string | null>(null);
  let stationLookupSerial = 0;
  let members = $state<DraftMember[]>([]);
  let seedSquadID = $state("");
  let accountLookup = $state("");
  let roster = $state<OperationPilotChoice[]>(loadKnownCharacters().map(({ accountName, characterID, characterName }) => ({ accountName, characterID, characterName })));

  const prefs = $derived(loadHangarPrefs());
  const selectedClasses = $derived([...(belt ? ["BELT" as const] : []), ...(oreAnomaly ? ["ORE_ANOMALY" as const] : [])]);
  const anchorValid = $derived(anchorSystemID > 0 && anchorSystemName.length > 0 && anchorError === null);
  const standardAvailable = $derived(selectedClasses.length === 1 && selectedClasses[0] === "BELT" && unloadPolicy === "HAULER_SERVICE");

  function modeOf(member: DraftMember): "STANDARD" | "CUSTOM" { return member.routineMode ?? (member.automationID ? "CUSTOM" : "STANDARD"); }
  function profileName(member: DraftMember): string {
    if (modeOf(member) === "CUSTOM") return scripts.find((script) => script.scriptID === member.automationID)?.name ?? "Custom routine";
    return member.role === "MINER" ? "Belt Miner / Hauler Service · v1" : member.role === "HAULER" ? "Belt Hauler · v1" : "Not yet executable";
  }

  function words(cause: unknown): string {
    return cause instanceof Error ? cause.message : "The Mining Operations request failed.";
  }

  async function refresh(): Promise<void> {
    try {
      payload = await loadMiningOperations(opts());
      pollError = null;
      for (const row of payload.operations) {
        if (!["DRAFT", "STOPPED"].includes(row.runtime.state)) continue;
        const key = JSON.stringify(row.definition);
        if (readiness[row.definition.operationID]?.key === key) continue;
        readiness[row.definition.operationID] = { key, message: "Checking start readiness…" };
        void getMiningOperationLaunchPlan(row.definition.operationID, opts()).then((plan) => {
          if (readiness[row.definition.operationID]?.key === key) readiness[row.definition.operationID] = { key, message: plan.warnings.join(" ") || null };
        }).catch((cause) => {
          if (readiness[row.definition.operationID]?.key === key) readiness[row.definition.operationID] = { key, message: words(cause) };
        });
      }
    } catch (cause) {
      pollError = words(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    const classes = selectedClasses;
    const policy = unloadPolicy;
    if (classes.length === 0) return;
    void listOperationRoutines(classes, policy, opts()).then((rows) => { scripts = rows; }).catch((cause) => { error = words(cause); });
  });

  async function searchSystem(value: string): Promise<void> {
    const serial = ++systemLookupSerial;
    anchorSystemName = value;
    anchorSystemID = 0;
    anchorError = "Select a known solar system.";
    systemMatches = [];
    if (value.trim().length < 2) return;
    try {
      const result = await findMapLocations(value.trim(), "system", opts());
      if (serial !== systemLookupSerial) return;
      systemMatches = result.matches.filter((row) => row.kind === "system").map((row) => ({ id: row.id, name: row.name }));
      const exact = systemMatches.find((row) => row.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
      if (exact) chooseSystem(exact);
      else anchorError = systemMatches.length ? "Choose a matching solar system." : "No known solar system matches that name.";
    } catch (cause) { if (serial === systemLookupSerial) anchorError = words(cause); }
  }

  function chooseSystem(system: { id: number; name: string }): void {
    ++systemLookupSerial;
    anchorSystemID = system.id;
    anchorSystemName = system.name;
    anchorError = null;
    systemMatches = [];
  }

  async function resolveSystemID(value: string): Promise<void> {
    const serial = ++systemLookupSerial;
    anchorSystemID = Number(value) || 0;
    anchorSystemName = "";
    systemMatches = [];
    anchorError = "Enter a known solar system ID.";
    if (!Number.isSafeInteger(anchorSystemID) || anchorSystemID <= 0) return;
    try {
      const result = await resolveDestination(anchorSystemID, opts());
      if (serial !== systemLookupSerial) return;
      if (result.kind === "system" && result.solarSystemID === anchorSystemID && result.systemName) {
        anchorSystemName = result.systemName;
        anchorError = null;
      } else anchorError = "That ID is not a known solar system.";
    } catch (cause) { if (serial === systemLookupSerial) anchorError = words(cause); }
  }

  async function loadAccount(): Promise<void> {
    try {
      const pilots = await listOperationAccountPilots(accountLookup.trim(), opts());
      roster = [...roster.filter((row) => row.accountName !== accountLookup.trim()), ...pilots];
      error = null;
    } catch (cause) { error = words(cause); }
  }

  async function searchStation(value: string): Promise<void> {
    const serial = ++stationLookupSerial;
    unloadStationName = value;
    unloadStationID = 0;
    unloadStationSystemName = "";
    destinationError = "Choose a known unload station.";
    stationMatches = [];
    if (value.trim().length < 2) return;
    try {
      const result = await findMapLocations(value.trim(), "station", opts());
      if (serial !== stationLookupSerial) return;
      stationMatches = result.matches.filter((row) => row.kind === "station")
        .map((row) => ({ id: row.id, name: row.name, systemName: row.solarSystemName ?? "" }));
      const exact = stationMatches.find((row) => row.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
      if (exact) chooseStation(exact);
      else destinationError = stationMatches.length ? "Choose a matching station." : "No known station matches that name.";
    } catch (cause) { if (serial === stationLookupSerial) destinationError = words(cause); }
  }

  function chooseStation(station: { id: number; name: string; systemName: string }): void {
    ++stationLookupSerial;
    unloadStationID = station.id;
    unloadStationName = station.name;
    unloadStationSystemName = station.systemName;
    destinationError = null;
    stationMatches = [];
  }

  function newOperation(): void {
    operationID = undefined;
    name = "";
    anchorSystemID = 0;
    anchorSystemName = "";
    anchorError = "Select a known solar system.";
    reach = "CURRENT_SYSTEM";
    belt = true;
    oreAnomaly = false;
    unloadPolicy = "HAULER_SERVICE";
    unloadStationID = 0;
    unloadStationName = "";
    unloadStationSystemName = "";
    unloadDivision = 1;
    destinationError = null;
    members = [];
    seedSquadID = "";
    editing = true;
  }

  function editOperation(definition: MiningOperationDefinition): void {
    operationID = definition.operationID;
    name = definition.name;
    anchorSystemID = definition.area.anchorSystemID;
    anchorSystemName = definition.area.anchorSystemName ?? "";
    anchorError = anchorSystemName ? null : "Resolve this solar system before saving.";
    reach = definition.area.reach;
    belt = definition.area.targetClasses.includes("BELT");
    oreAnomaly = definition.area.targetClasses.includes("ORE_ANOMALY");
    unloadPolicy = definition.unloadPolicy;
    unloadStationID = definition.unloadDestination?.stationID ?? 0;
    unloadStationName = definition.unloadDestination?.stationName ?? "";
    unloadStationSystemName = definition.unloadDestination?.systemName ?? "";
    unloadDivision = definition.unloadDestination?.corporationDivision ?? 1;
    destinationError = null;
    members = definition.members.map((member) => ({ ...member, routineMode: modeOf(member) }));
    editing = true;
  }

  function addPilot(characterID: number): void {
    if (members.some((member) => member.characterID === characterID)) return;
    const pilot = roster.find((row) => row.characterID === characterID);
    if (!pilot) return;
    members = [...members, {
      characterID: pilot.characterID,
      characterName: pilot.characterName,
      accountName: pilot.accountName,
      role: "MINER",
      routineMode: "STANDARD",
      automationID: "",
    }];
  }

  function removePilot(characterID: number): void {
    members = members.filter((member) => member.characterID !== characterID);
  }

  function patchMember(characterID: number, patch: Partial<DraftMember>): void {
    members = members.map((member) => member.characterID === characterID ? { ...member, ...patch } : member);
  }

  function seedGroup(): void {
    for (const characterID of prefs.members[seedSquadID] ?? []) addPilot(characterID);
  }

  async function save(): Promise<void> {
    if (!anchorValid) { error = anchorError ?? "Choose a known solar system."; return; }
    busy = "save";
    error = null;
    try {
      payload = await saveMiningOperation({
        ...(operationID ? { operationID } : {}),
        name,
        area: {
          anchorSystemID,
          anchorSystemName: anchorSystemName.trim() || null,
          reach,
          targetClasses: selectedClasses,
        },
        targetPolicy: "ANY_ELIGIBLE",
        unloadPolicy,
        unloadDestination: unloadStationID > 0 && destinationError === null
          ? { stationID: unloadStationID, stationName: unloadStationName, systemName: unloadStationSystemName, corporationDivision: unloadDivision }
          : null,
        members,
      }, opts());
      editing = false;
      await refresh();
    } catch (cause) {
      error = words(cause);
    } finally {
      busy = null;
    }
  }

  async function start(definition: MiningOperationDefinition & { operationID: string }): Promise<void> {
    busy = definition.operationID;
    error = null;
    try {
      const grants: Record<string, ReturnType<typeof createBotLaunchGrant>> = {};
      const plan = await getMiningOperationLaunchPlan(definition.operationID, opts());
      for (const member of plan.members) {
        const decoded = decodeScriptValue(member.script.doc);
        if (!decoded.ok) throw new Error(`${member.script.name} is invalid: ${decoded.refusal}`);
        grants[String(member.characterID)] = createBotLaunchGrant(member.script.rev, analyzeBotRunPolicy(decoded.doc), runtimeMinutes);
      }
      const hours = runtimeMinutes / 60;
      const warning = plan.warnings.length ? `\n\n${plan.warnings.join("\n")}` : "";
      if (!window.confirm(`Start “${definition.name}” for ${definition.members.length} members, with a ${hours}-hour server-hosted limit?${warning}`)) return;
      payload = await startMiningOperation(definition.operationID, grants, plan.planHash, opts());
    } catch (cause) {
      error = words(cause);
    } finally {
      busy = null;
    }
  }

  async function stop(operationID: string): Promise<void> {
    busy = operationID;
    error = null;
    try {
      payload = await stopMiningOperation(operationID, opts());
    } catch (cause) {
      error = words(cause);
      await refresh();
    } finally {
      busy = null;
    }
  }

  async function remove(operationID: string): Promise<void> {
    if (!window.confirm("Delete this stopped Mining Operation definition?")) return;
    busy = operationID;
    try {
      payload = await deleteMiningOperation(operationID, opts());
    } catch (cause) {
      error = words(cause);
    } finally {
      busy = null;
    }
  }
</script>

<section class="operations">
  <header>
    <div>
      <h2>Mining Operations</h2>
      <p>One operation is one jointly moving industrial fleet with one current target.</p>
    </div>
    <div class="launch-settings">
      <label>Run limit
        <select bind:value={runtimeMinutes} aria-label="Operation run limit">
          <option value={60}>1 hour</option>
          <option value={240}>4 hours</option>
          <option value={720}>12 hours</option>
          <option value={1440}>24 hours</option>
        </select>
      </label>
      <button type="button" onclick={newOperation}>+ New operation</button>
    </div>
  </header>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if pollError}<p class="error" role="alert">{pollError}</p>{/if}
  {#if loading}<p class="muted">Loading Mining Command Center…</p>{/if}

  {#if editing}
    <form class="editor" onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <h3>{operationID ? "Edit operation" : "New operation"}</h3>
      <label>Name <input required bind:value={name} /></label>
      <div class="grid2">
        <label>Anchor system <input required value={anchorSystemName} oninput={(event) => void searchSystem(event.currentTarget.value)} placeholder="Search solar systems" autocomplete="off" /></label>
        <label>Anchor system ID <input required type="number" min="1" value={anchorSystemID || ""} oninput={(event) => void resolveSystemID(event.currentTarget.value)} /></label>
      </div>
      {#if systemMatches.length > 0}<div class="system-matches" role="listbox" aria-label="Matching solar systems">
        {#each systemMatches as system (system.id)}<button type="button" role="option" aria-selected="false" onclick={() => chooseSystem(system)}>{system.name} · {system.id}</button>{/each}
      </div>{/if}
      {#if anchorError}<p class="error" role="status">{anchorError}</p>{/if}
      <label>Reach
        <select bind:value={reach}>
          <option value="CURRENT_SYSTEM">Current system</option>
          <option value="CURRENT_AND_ADJACENT">Current and adjacent — dynamic discovery deferred</option>
        </select>
      </label>
      <fieldset>
        <legend>Eligible targets — any eligible resource</legend>
        <label><input type="checkbox" bind:checked={belt} /> Belts</label>
        <label><input type="checkbox" bind:checked={oreAnomaly} /> Ore anomalies — self unload in v0.1</label>
        <label class="disabled"><input type="checkbox" disabled /> Ice — not supported yet</label>
        <label class="disabled"><input type="checkbox" disabled /> Gas — not supported yet</label>
      </fieldset>
      <fieldset>
        <legend>Unload</legend>
        <label><input type="radio" bind:group={unloadPolicy} value="HAULER_SERVICE" /> Hauler service</label>
        <label><input type="radio" bind:group={unloadPolicy} value="SELF_UNLOAD" /> Self unload</label>
      </fieldset>
      {#if unloadPolicy === "HAULER_SERVICE"}
        <div class="destination">
          <h4>Hauler delivery destination</h4>
          <p class="muted">Standard Belt Hauler requires a known station and corporation division, even when pilots start in space.</p>
          <label>Unload station <input value={unloadStationName} oninput={(event) => void searchStation(event.currentTarget.value)} placeholder="Search stations" autocomplete="off" /></label>
          {#if stationMatches.length > 0}<div class="system-matches" role="listbox" aria-label="Matching stations">
            {#each stationMatches as station (station.id)}<button type="button" role="option" aria-selected="false" onclick={() => chooseStation(station)}>{station.name} · {station.systemName}</button>{/each}
          </div>{/if}
          {#if unloadStationID > 0}<p class="muted">Station {unloadStationID} · {unloadStationSystemName}</p>{/if}
          {#if destinationError}<p class="error" role="status">{destinationError}</p>{/if}
          <label>Corporation division <select bind:value={unloadDivision}>{#each [1, 2, 3, 4, 5, 6, 7] as division}<option value={division}>Division {division}</option>{/each}</select></label>
        </div>
      {/if}

      {#if prefs.squads.length > 0}
        <div class="seed">
          <select bind:value={seedSquadID} aria-label="Pilot Group">
            <option value="">Seed from Pilot Group…</option>
            {#each prefs.squads as squad (squad.id)}<option value={squad.id}>{squad.name}</option>{/each}
          </select>
          <button type="button" disabled={!seedSquadID} onclick={seedGroup}>Add group members</button>
        </div>
      {/if}

      <h4>Members</h4>
      <div class="seed">
        <label>Account <input bind:value={accountLookup} placeholder="Existing EveJS account" /></label>
        <button type="button" disabled={!accountLookup.trim()} onclick={() => void loadAccount()}>Load account pilots</button>
      </div>
      <div class="pilot-picker">
        {#each roster as pilot (pilot.characterID)}
          <label><input type="checkbox" checked={members.some((member) => member.characterID === pilot.characterID)} onchange={(event) => event.currentTarget.checked ? addPilot(pilot.characterID) : removePilot(pilot.characterID)} /> {pilot.characterName} ({pilot.accountName})</label>
        {/each}
      </div>
      {#if members.length === 0}<p class="muted">Select at least one miner.</p>{/if}
      {#if members.length > 0}
        <table>
          <thead><tr><th>Pilot</th><th>Role</th><th>Routine mode</th><th>Effective profile / routine</th></tr></thead>
          <tbody>
            {#each members as member (member.characterID)}
              <tr>
                <td>{member.characterName}</td>
                <td><select value={member.role} onchange={(event) => patchMember(member.characterID, { role: event.currentTarget.value as DraftMember["role"], automationID: "" })}>
                  <option value="MINER">Miner</option>
                  <option value="HAULER">Hauler</option>
                  <option value="DEFENDER">Defender — execution not supported</option>
                </select></td>
                <td>{#if member.role === "DEFENDER"}Not yet executable{:else}<select value={modeOf(member)} onchange={(event) => patchMember(member.characterID, { routineMode: event.currentTarget.value as "STANDARD" | "CUSTOM", automationID: "" })}>
                  <option value="STANDARD">Standard / Automatic</option>
                  <option value="CUSTOM">Custom / Advanced</option>
                </select>{/if}</td>
                <td>{#if member.role === "DEFENDER"}Not yet executable{:else if modeOf(member) === "STANDARD"}
                  {#if standardAvailable}{profileName(member)}{:else}<span class="error">No Standard profile for this class/policy; use Custom / Advanced.</span>{/if}
                {:else}<select required value={member.automationID} onchange={(event) => patchMember(member.characterID, { automationID: event.currentTarget.value })}>
                  <option value="">Choose operation-compatible routine…</option>
                  {#each scripts.filter((script) => script.roles[member.role]?.compatible) as script (script.scriptID)}<option value={script.scriptID}>{script.name}</option>{/each}
                  {#if member.automationID && !scripts.some((script) => script.scriptID === member.automationID && script.roles[member.role]?.compatible)}
                    <option value={member.automationID} disabled>Incompatible routine — choose another</option>
                  {/if}
                </select>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <p class="note">Defender is a first-class role, but launch is deliberately disabled until an existing combat primitive can stay with the operation target safely.</p>
      <div class="actions"><button type="submit" disabled={busy !== null || !anchorValid}>Save operation</button><button type="button" onclick={() => (editing = false)}>Cancel</button></div>
    </form>
  {/if}

  {#if payload && payload.operations.length === 0 && !editing}<p class="empty">No Mining Operations yet.</p>{/if}
  {#each payload?.operations ?? [] as row (row.definition.operationID)}
    <article class="operation-card">
      <div class="title-row"><div><h3>{row.definition.name}</h3><span class="state">{row.runtime.state}</span></div><div class="actions">
        {#if ["DRAFT", "STOPPED"].includes(row.runtime.state)}
          <button type="button" onclick={() => editOperation(row.definition)}>Edit</button>
          <button type="button" disabled={busy !== null} onclick={() => void start(row.definition)}>Start operation</button>
          <button type="button" class="danger" disabled={busy !== null} onclick={() => void remove(row.definition.operationID)}>Delete</button>
        {:else}
          <button type="button" class="danger" disabled={busy !== null} onclick={() => void stop(row.definition.operationID)}>Stop operation</button>
        {/if}
      </div></div>
      {#if row.runtime.statusReason}<p class="notice"><strong>Status:</strong> {row.runtime.statusReason}</p>{/if}
      <p><strong>Area:</strong> {row.definition.area.anchorSystemName ?? "Unknown system"} · {row.definition.area.reach === "CURRENT_SYSTEM" ? "current system" : "adjacent mode (anchor-only execution in v0.1)"}</p>
      <p><strong>Target class / unload:</strong> {row.definition.area.targetClasses.join(", ")} · {row.definition.unloadPolicy === "HAULER_SERVICE" ? "Hauler service" : "Self unload"}</p>
      {#if row.definition.unloadPolicy === "HAULER_SERVICE"}<p><strong>Delivery:</strong> {row.definition.unloadDestination ? `${row.definition.unloadDestination.stationName} · Corporation Division ${row.definition.unloadDestination.corporationDivision}` : row.definition.members.some((member) => modeOf(member) === "STANDARD") ? "Not configured — Standard Start blocked" : "Configured in custom routine"}</p>{/if}
      {#if ["DRAFT", "STOPPED"].includes(row.runtime.state)}<p class={readiness[row.definition.operationID]?.message ? "notice" : "muted"}><strong>Start readiness:</strong> {readiness[row.definition.operationID]?.message ?? "Routine preflight ready; pilot ownership and run grant are checked at Start."}</p>{/if}
      <p><strong>Current target:</strong> {row.runtime.currentTarget?.targetName ?? "Waiting for selection"} {row.runtime.currentTarget ? `· ${row.runtime.currentTarget.state}` : ""}</p>
      <p><strong>Current system:</strong> {row.runtime.currentTarget?.systemName ?? (row.runtime.currentTarget ? String(row.runtime.currentTarget.systemID) : "Awaiting target")}</p>
      {#if row.runtime.rendezvous}
        <p class="notice"><strong>Rendezvous:</strong> {row.runtime.rendezvous.ready.length}/{row.runtime.rendezvous.required.length} required miners ready.</p>
      {/if}
      {#each row.runtime.logisticsTail as tail (tail.target.targetKey)}
        <p class="notice"><strong>Logistics tail:</strong> {tail.target.targetName} is still DRAINING; {tail.pendingHaulers.length} hauler(s) remain while the main body may relocate.</p>
      {/each}
      <table>
        <thead><tr><th>Pilot</th><th>Role</th><th>Assignment</th><th>Bot state</th><th>Phase</th></tr></thead>
        <tbody>{#each row.runtime.members as member (member.characterID)}<tr><td>{member.characterName}</td><td>{member.role}</td><td>{modeOf(member) === "STANDARD" && (row.definition.unloadPolicy !== "HAULER_SERVICE" || row.definition.area.targetClasses.length !== 1 || row.definition.area.targetClasses[0] !== "BELT") ? "Standard unavailable" : profileName(member)}</td><td>{member.runtimeState}</td><td>{member.runtimeState === "FAILED" ? `${member.failureCode ? `${member.failureCode}: ` : ""}${member.reason ?? member.phase ?? "Unavailable"}` : member.phase ?? member.reason ?? "—"}</td></tr>{/each}</tbody>
      </table>
      {#if row.runtime.stopFailures.length > 0}<p class="error">Graceful Stop remains blocked for {row.runtime.stopFailures.length} member(s); this operation is not reported stopped.</p>{/if}
      {#if row.runtime.history.length > 0}<details><summary>Target history</summary><ul>{#each row.runtime.history as item}<li>{item.at} · {item.kind} · {item.target?.targetName ?? (item.evidence ? JSON.stringify(item.evidence) : "—")}</li>{/each}</ul></details>{/if}
    </article>
  {/each}

  <section class="board">
    <h3>Global target board</h3>
    <p class="muted">Shared across every Mining Operation. Claims are atomic and lease-bound.</p>
    <p class="note">Haulers continue to use the existing global container claims. Operation-scoped can ownership is deferred.</p>
    {#if (payload?.targetBoard.length ?? 0) === 0}<p class="empty">No targets observed yet.</p>{/if}
    {#if (payload?.targetBoard.length ?? 0) > 0}<table><thead><tr><th>Target</th><th>Type</th><th>System</th><th>State</th></tr></thead><tbody>{#each payload?.targetBoard ?? [] as target (target.targetKey)}<tr><td>{target.targetName}</td><td>{target.targetType}</td><td>{target.systemName ?? "—"}</td><td>{target.state}</td></tr>{/each}</tbody></table>{/if}
  </section>
</section>

<style>
  .operations { padding: 1rem; color: #dce8ef; min-width: 0; }
  header, .title-row, .actions, .seed, .launch-settings { display: flex; gap: .65rem; align-items: center; justify-content: space-between; }
  h2, h3, h4, p { margin: .25rem 0 .65rem; }
  header p, .muted, .note { color: #93a9b5; }
  button, input, select { min-height: 2.1rem; border: 1px solid #395362; border-radius: 4px; background: #101b22; color: inherit; padding: .35rem .55rem; }
  button { cursor: pointer; } button:disabled { cursor: not-allowed; opacity: .5; }
  .editor, .operation-card, .board { border: 1px solid #304754; background: #0d171d; border-radius: 6px; padding: .85rem; margin: .8rem 0; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
  label { display: flex; gap: .45rem; align-items: center; margin: .4rem 0; }
  label > input:not([type="checkbox"]):not([type="radio"]), label > select { flex: 1; }
  fieldset { border: 1px solid #304754; margin: .7rem 0; }
  .disabled { color: #728691; }
  .pilot-picker { display: flex; flex-wrap: wrap; gap: .4rem 1rem; }
  .system-matches { display: flex; flex-wrap: wrap; gap: .35rem; }
  table { width: 100%; border-collapse: collapse; margin-top: .55rem; }
  th, td { border-bottom: 1px solid #263943; text-align: left; padding: .45rem; vertical-align: top; }
  th { color: #8fb4c7; font-weight: 600; }
  .state { color: #65d7b0; font-size: .8rem; letter-spacing: .06em; }
  .notice { border-left: 3px solid #d4a84d; padding-left: .55rem; }
  .error { color: #ff9e9e; }
  .danger { border-color: #8e4d50; color: #ffb0b0; }
  .empty { color: #8195a0; font-style: italic; }
  @media (max-width: 700px) { .grid2 { grid-template-columns: 1fr; } header, .title-row { align-items: flex-start; flex-direction: column; } table { font-size: .85rem; } }
</style>
