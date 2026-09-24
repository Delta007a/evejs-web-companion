<script lang="ts">
  import { onMount } from "svelte";
  import {
    deleteMiningOperation,
    getBotScript,
    listBotScripts,
    loadMiningOperations,
    saveMiningOperation,
    startMiningOperation,
    stopMiningOperation,
    type BotScriptSummary,
    type MiningOperationDefinition,
    type MiningOperationMemberDefinition,
    type MiningOperationsPayload,
  } from "../app/api.ts";
  import { loadHangarPrefs } from "../app/hangarPrefs.ts";
  import { loadKnownCharacters } from "../app/knownCharacters.ts";
  import { decodeScriptValue } from "../bots/scriptCodec.ts";
  import { analyzeBotRunPolicy, createBotLaunchGrant } from "../bots/runPolicy.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { Session } from "../app/sessions.ts";

  let { store, flow, sessions: _sessions }: {
    store: ClientStore;
    flow: AppFlow;
    sessions?: readonly Session[];
  } = $props();

  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  const opts = () => flow.requestOptions();
  let payload = $state<MiningOperationsPayload | null>(null);
  let scripts = $state<BotScriptSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let editing = $state(false);
  let runtimeMinutes = $state(12 * 60);

  type DraftMember = MiningOperationMemberDefinition;
  let operationID = $state<string | undefined>(undefined);
  let name = $state("");
  let anchorSystemID = $state(0);
  let anchorSystemName = $state("");
  let reach = $state<"CURRENT_SYSTEM" | "CURRENT_AND_ADJACENT">("CURRENT_SYSTEM");
  let belt = $state(true);
  let oreAnomaly = $state(false);
  let unloadPolicy = $state<"HAULER_SERVICE" | "SELF_UNLOAD">("HAULER_SERVICE");
  let members = $state<DraftMember[]>([]);
  let seedSquadID = $state("");

  const known = $derived(loadKnownCharacters());
  const prefs = $derived(loadHangarPrefs());

  function words(cause: unknown): string {
    return cause instanceof Error ? cause.message : "The Mining Operations request failed.";
  }

  async function refresh(): Promise<void> {
    try {
      [payload, scripts] = await Promise.all([loadMiningOperations(opts()), listBotScripts(opts())]);
      error = null;
    } catch (cause) {
      error = words(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  });

  function newOperation(): void {
    operationID = undefined;
    name = "";
    anchorSystemID = $flight.status?.solarSystemID ?? 0;
    anchorSystemName = $flight.solarSystemName ?? "";
    reach = "CURRENT_SYSTEM";
    belt = true;
    oreAnomaly = false;
    unloadPolicy = "HAULER_SERVICE";
    members = [];
    seedSquadID = "";
    editing = true;
  }

  function editOperation(definition: MiningOperationDefinition): void {
    operationID = definition.operationID;
    name = definition.name;
    anchorSystemID = definition.area.anchorSystemID;
    anchorSystemName = definition.area.anchorSystemName ?? "";
    reach = definition.area.reach;
    belt = definition.area.targetClasses.includes("BELT");
    oreAnomaly = definition.area.targetClasses.includes("ORE_ANOMALY");
    unloadPolicy = definition.unloadPolicy;
    members = definition.members.map((member) => ({ ...member }));
    editing = true;
  }

  function addPilot(characterID: number): void {
    if (members.some((member) => member.characterID === characterID)) return;
    const pilot = known.find((row) => row.characterID === characterID);
    if (!pilot) return;
    members = [...members, {
      characterID: pilot.characterID,
      characterName: pilot.characterName,
      accountName: pilot.accountName,
      role: "MINER",
      automationID: scripts[0]?.scriptID ?? "",
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
          targetClasses: [...(belt ? ["BELT" as const] : []), ...(oreAnomaly ? ["ORE_ANOMALY" as const] : [])],
        },
        targetPolicy: "ANY_ELIGIBLE",
        unloadPolicy,
        members,
      }, opts());
      editing = false;
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
      for (const member of definition.members) {
        const record = await getBotScript(member.automationID, opts());
        if (!record) throw new Error(`${member.characterName}'s saved automation no longer exists.`);
        const decoded = decodeScriptValue(record.doc);
        if (!decoded.ok) throw new Error(`${member.characterName}'s saved automation is invalid: ${decoded.refusal}`);
        grants[String(member.characterID)] = createBotLaunchGrant(record.rev, analyzeBotRunPolicy(decoded.doc), runtimeMinutes);
      }
      const hours = runtimeMinutes / 60;
      if (!window.confirm(`Start “${definition.name}” for ${definition.members.length} members, with a ${hours}-hour server-hosted limit?`)) return;
      payload = await startMiningOperation(definition.operationID, grants, opts());
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
  {#if loading}<p class="muted">Loading Mining Command Center…</p>{/if}

  {#if editing}
    <form class="editor" onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <h3>{operationID ? "Edit operation" : "New operation"}</h3>
      <label>Name <input required bind:value={name} /></label>
      <div class="grid2">
        <label>Anchor system <input required bind:value={anchorSystemName} placeholder="System name" /></label>
        <label>Anchor system ID <input required type="number" min="1" bind:value={anchorSystemID} /></label>
      </div>
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
      <div class="pilot-picker">
        {#each known as pilot (pilot.characterID)}
          <label><input type="checkbox" checked={members.some((member) => member.characterID === pilot.characterID)} onchange={(event) => event.currentTarget.checked ? addPilot(pilot.characterID) : removePilot(pilot.characterID)} /> {pilot.characterName}</label>
        {/each}
      </div>
      {#if members.length === 0}<p class="muted">Select at least one miner.</p>{/if}
      {#if members.length > 0}
        <table>
          <thead><tr><th>Pilot</th><th>Role</th><th>Saved automation</th></tr></thead>
          <tbody>
            {#each members as member (member.characterID)}
              <tr>
                <td>{member.characterName}</td>
                <td><select value={member.role} onchange={(event) => patchMember(member.characterID, { role: event.currentTarget.value as DraftMember["role"] })}>
                  <option value="MINER">Miner</option>
                  <option value="HAULER">Hauler</option>
                  <option value="DEFENDER">Defender — execution not supported</option>
                </select></td>
                <td><select required value={member.automationID} onchange={(event) => patchMember(member.characterID, { automationID: event.currentTarget.value })}>
                  <option value="">Choose saved automation…</option>
                  {#each scripts as script (script.scriptID)}<option value={script.scriptID}>{script.name}</option>{/each}
                </select></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <p class="note">Defender is a first-class role, but launch is deliberately disabled until an existing combat primitive can stay with the operation target safely.</p>
      <div class="actions"><button type="submit" disabled={busy !== null}>Save operation</button><button type="button" onclick={() => (editing = false)}>Cancel</button></div>
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
      <p><strong>Area:</strong> {row.definition.area.anchorSystemName ?? "Unknown system"} · {row.definition.area.reach === "CURRENT_SYSTEM" ? "current system" : "adjacent mode (anchor-only execution in v0.1)"}</p>
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
        <tbody>{#each row.runtime.members as member (member.characterID)}<tr><td>{member.characterName}</td><td>{member.role}</td><td>{member.automationID ? scripts.find((script) => script.scriptID === member.automationID)?.name ?? "Missing automation" : "—"}</td><td>{member.runtimeState}</td><td>{member.phase ?? member.reason ?? "—"}</td></tr>{/each}</tbody>
      </table>
      {#if row.runtime.stopFailures.length > 0}<p class="error">Graceful Stop remains blocked for {row.runtime.stopFailures.length} member(s); this operation is not reported stopped.</p>{/if}
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
