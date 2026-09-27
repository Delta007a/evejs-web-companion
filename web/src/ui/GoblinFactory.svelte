<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { loadKnownCharacters } from "../app/knownCharacters.ts";
  import { loadTrainingCharacters, type ApiOptions } from "../app/api.ts";
  import { readFactoryAccount, readFactoryPilot } from "../training/factoryClient.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { formatDuration } from "../bridge/skills.ts";
  import { acceptStageFitting } from "../training/fittingSelection.ts";
  import { readSelections, saveSelections, readPilotPreferences, savePilotPreferences,
    readFactoryAccounts, rememberFactoryAccount, factoryStatus, factoryStatusLabels,
    type PilotPreferences, type PlanMode, type FactoryStatus } from "../training/factory.ts";
  import type { TrainingCharacter, MinerTrainingRead, StageFittingSelection, CorporationSavedFitting } from "../training/types.ts";
  import MinerQualification from "./MinerQualification.svelte";

  interface PilotRow {
    key: string; account: string; pilot: TrainingCharacter; prefs: PilotPreferences;
    selections: Record<string, StageFittingSelection>; result: MinerTrainingRead | null;
    error: string; readAt: number | null;
  }
  let rows = $state<PilotRow[]>([]);
  let accounts = $state<string[]>([]);
  let accountErrors = $state<Record<string, string>>({});
  let accountInput = $state("");
  let busy = $state(false);
  let ready = $state(false);
  let error = $state("");
  let query = $state("");
  let filter = $state<"ALL" | FactoryStatus>("ALL");
  let expanded = $state<string | null>(null);
  const credentials = new Map<string, ApiOptions>(); // Memory only; never gameplay sessions.
  let generation = 0;
  const keyOf = (account: string, id: number) => JSON.stringify([account, id]);
  const visible = $derived(rows.filter((row) =>
    `${row.account} ${row.pilot.name}`.toLowerCase().includes(query.toLowerCase()) &&
    (filter === "ALL" || factoryStatus(row.result?.report ?? null, row.prefs.mode, row.error) === filter)));
  function update(key: string, fields: Partial<PilotRow>): void {
    rows = rows.map((row) => row.key === key ? { ...row, ...fields } : row);
  }
  function makeRow(account: string, pilot: TrainingCharacter): PilotRow {
    let prefs: PilotPreferences = { role: "", mode: "BALANCED" };
    let selections = {};
    let configError = "";
    try { prefs = readPilotPreferences(localStorage, account, pilot.characterID); selections = readSelections(localStorage, account, pilot.characterID); }
    catch { configError = "Browser configuration is unreadable; stored fitting selections have not been overwritten."; }
    return { key: keyOf(account, pilot.characterID), account, pilot, prefs, selections, result: null, error: configError, readAt: null };
  }
  async function readPilot(row: PilotRow, ticket: number): Promise<void> {
    if (ticket !== generation) return;
    update(row.key, { result: null, readAt: null });
    if (!row.prefs.role || row.error) return;
    try {
      const options = credentials.get(row.account);
      if (!options) throw new Error("Account authentication is unavailable; refresh the roster.");
      const selections = readSelections(localStorage, row.account, row.pilot.characterID);
      const result = await readFactoryPilot(row.pilot.characterID, selections, options);
      if (ticket === generation) update(row.key, { result, selections, error: "", readAt: Date.now() });
    } catch (cause) {
      if (ticket === generation) update(row.key, { result: null, error: panelErrorWords(cause), readAt: null });
    }
  }
  async function readAccount(account: string, ticket: number): Promise<void> {
    // Account and pilot reads are serialized; a refresh never competes with an edit.
    rows = rows.map((row) => row.account === account ? { ...row, result: null, readAt: null } : row);
    try {
      const roster = await readFactoryAccount(account);
      if (ticket !== generation) return;
      credentials.set(roster.account, roster.requestOptions);
      const fresh = roster.characters.map((pilot) => makeRow(roster.account, pilot));
      rows = [...rows.filter((row) => row.account !== account && row.account !== roster.account), ...fresh];
      accounts = [...new Set(accounts.map((name) => name === account ? roster.account : name))];
      accountErrors = { ...accountErrors, [account]: "", [roster.account]: "" };
      if (fresh.length === 0) accountErrors = { ...accountErrors, [roster.account]: "No characters on this account." };
      for (const row of fresh) { if (ticket !== generation) return; await readPilot(row, ticket); }
    } catch (cause) {
      if (ticket !== generation) return;
      const reason = panelErrorWords(cause);
      accountErrors = { ...accountErrors, [account]: reason };
      rows = rows.map((row) => row.account === account ? { ...row, result: null, readAt: null, error: reason } : row);
    }
  }
  async function refresh(): Promise<void> {
    if (busy) return;
    busy = true;
    const ticket = ++generation;
    for (const account of accounts) { if (ticket !== generation) return; await readAccount(account, ticket); }
    if (ticket === generation) busy = false;
  }
  async function addAccount(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = accountInput.trim();
    if (!name || busy) return;
    busy = true; error = "";
    const ticket = ++generation;
    try {
      const roster = await readFactoryAccount(name);
      if (ticket !== generation) return;
      rememberFactoryAccount(localStorage, roster.account);
      accounts = [...new Set([...accounts, roster.account])];
      credentials.set(roster.account, roster.requestOptions);
      rows = [...rows.filter((row) => row.account !== roster.account), ...roster.characters.map((pilot) => makeRow(roster.account, pilot))];
      accountInput = "";
      accountErrors = { ...accountErrors, [roster.account]: roster.characters.length ? "" : "No characters on this account." };
      for (const row of rows.filter((candidate) => candidate.account === roster.account)) await readPilot(row, ticket);
    } catch (cause) { if (ticket === generation) error = panelErrorWords(cause); }
    finally { if (ticket === generation) busy = false; }
  }
  async function changePreferences(row: PilotRow, prefs: PilotPreferences): Promise<void> {
    if (busy) return;
    try {
      savePilotPreferences(localStorage, row.account, row.pilot.characterID, prefs);
      update(row.key, { prefs });
      if (prefs.role !== row.prefs.role) {
        busy = true;
        const ticket = ++generation;
        const fresh = makeRow(row.account, row.pilot);
        update(row.key, fresh);
        await readPilot(fresh, ticket);
        if (ticket === generation) busy = false;
      }
    } catch (cause) { error = `Local preferences could not be saved: ${String(cause)}`; busy = false; }
  }
  async function configureFit(row: PilotRow, stageID: string, fitID: number, accepted?: CorporationSavedFitting): Promise<void> {
    if (busy || !row.result) return;
    try {
      let selections = readSelections(localStorage, row.account, row.pilot.characterID);
      if (accepted) selections = acceptStageFitting(selections, stageID, row.result.corporationID, accepted);
      else {
        selections = { ...selections };
        if (fitID > 0) selections[stageID] = { scope: "CORPORATION", ownerID: row.result.corporationID, fittingID: fitID };
        else delete selections[stageID];
      }
      saveSelections(localStorage, row.account, row.pilot.characterID, selections);
      update(row.key, { selections, error: "" });
      busy = true;
      const ticket = ++generation;
      await readPilot({ ...row, selections, error: "" }, ticket);
      if (ticket === generation) busy = false;
    } catch (cause) { error = `Fitting configuration could not be saved: ${String(cause)}`; busy = false; }
  }
  onMount(() => {
    const ticket = generation;
    void (async () => {
      const known = loadKnownCharacters();
      rows = known.map((pilot) => makeRow(pilot.accountName, { characterID: pilot.characterID, name: pilot.characterName }));
      try { accounts = [...new Set([...known.map((pilot) => pilot.accountName), ...readFactoryAccounts(localStorage)])]; }
      catch { error = "Saved Factory account list is unreadable."; }
      // Discover normal WC authentication, without creating a cockpit or flow.
      try {
        const current = await loadTrainingCharacters();
        if (ticket !== generation) return;
        accounts = [...new Set([...accounts, current.account])];
      } catch { /* A direct signed-out visit offers existing-account sign-in. */ }
      if (ticket !== generation) return;
      ready = true;
      await refresh();
    })();
  });
  onDestroy(() => { generation++; credentials.clear(); });
</script>

<main class="factory">
  <header class="factory-head">
    <div><p class="eyebrow">EveJS Web · control plane</p><h1>Goblin Factory</h1><p>Read-only pilot training and Miner qualification</p></div>
    <nav><a href="/" target="_blank" rel="noopener">Pilot Hangar</a><button type="button" class="minor" disabled={busy || !ready} onclick={refresh}>{busy ? "Reading…" : "Refresh roster"}</button></nav>
  </header>
  <p class="note">Skill qualification does not establish equipment readiness. No pilot is selected or brought online by this page.</p>
  <form class="factory-controls" onsubmit={addAccount}>
    <label>Existing account <input aria-label="Existing account" bind:value={accountInput} disabled={busy || !ready} placeholder="Account name" autocomplete="username" /></label>
    <button class="minor" disabled={busy || !ready || !accountInput.trim()}>Sign in / add to roster</button>
    <span class="note">Normal WC authentication; unknown names are refused. No account creation.</span>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#each Object.entries(accountErrors).filter(([, message]) => message) as [account, message] (account)}
    <p class="error">{account}: {message}</p>
  {/each}
  <div class="factory-controls">
    <label>Search <input aria-label="Search account or character" bind:value={query} placeholder="Account or character" /></label>
    <label>Status <select bind:value={filter}><option value="ALL">All</option>{#each Object.entries(factoryStatusLabels) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
    <span>{visible.length} / {rows.length} pilots</span>
  </div>
  {#if !ready}<p>Loading known accounts…</p>{/if}
  {#if ready && !busy && rows.length === 0}<p>No available pilots yet. Sign in with an existing account above.</p>{/if}
  <div class="factory-roster">
    {#each visible as row (row.key)}
      {@const report = row.result?.report}
      {@const preview = report?.previews[row.prefs.mode]}
      {@const status = factoryStatus(report ?? null, row.prefs.mode, row.error)}
      <article class="factory-card">
        <header><div><p class="eyebrow">Account · {row.account}</p><h2>{row.pilot.name}</h2></div><strong>{factoryStatusLabels[status]}</strong></header>
        <p class="note">Character #{row.pilot.characterID} · Corporation: {row.pilot.corporationName ?? row.pilot.corporationID ?? "Unknown"}</p>
        <div class="factory-controls">
          <label>Role <select aria-label={`Role for ${row.pilot.name}`} value={row.prefs.role} disabled={busy} onchange={(event) => void changePreferences(row, { ...row.prefs, role: event.currentTarget.value === "MINER" ? "MINER" : "" })}>
            <option value="">Unassigned</option><option value="MINER">MINER</option>
          </select></label>
          <label>Plan <select aria-label={`Plan for ${row.pilot.name}`} value={row.prefs.mode} disabled={busy} onchange={(event) => void changePreferences(row, { ...row.prefs, mode: event.currentTarget.value as PlanMode })}>
            <option>FAST</option><option>BALANCED</option><option>MASTERY</option>
          </select></label>
        </div>
        <dl>
          <div><dt>Highest proven stage</dt><dd>{report?.currentStage ?? "None proven"}</dd></div>
          <div><dt>Next stage</dt><dd>{report ? report.nextStage ?? "All stages reached" : "Unknown"}</dd></div>
          <div><dt>Queue state</dt><dd>{report?.trainingState ?? "UNKNOWN"}</dd></div>
          <div><dt>Equipment</dt><dd>UNKNOWN</dd></div>
          <div><dt>Plan ETA</dt><dd>{!preview ? "UNKNOWN" : preview.eta.kind === "READY" ? "Already trained" : preview.eta.kind === "SERVER_QUEUE" ? `${formatDuration(preview.eta.remainingMs)} · server queue` : "UNKNOWN"}</dd></div>
        </dl>
        {#if !row.prefs.role}<p class="note">Select a role explicitly. Only MINER progression is supported.</p>{/if}
        {#if row.error}<p class="error" role="alert">{row.error}</p>{/if}
        {#if preview?.eta.kind === "UNKNOWN"}<p class="note">{preview.eta.reason}</p>{/if}
        {#if report?.stages.some((stage) => stage.fitting.status !== "READY")}<p class="note">Stage fitting configuration needs attention; inspect stage details.</p>{/if}
        {#if row.readAt}<p class="note">Read at {new Date(row.readAt).toLocaleTimeString()} · refresh to update</p>{/if}
        {#if row.result}
          <button class="minor" type="button" onclick={() => expanded = expanded === row.key ? null : row.key}>{expanded === row.key ? "Hide stages" : "Inspect stages and plan"}</button>
          {#if expanded === row.key}
            <MinerQualification result={row.result} selections={row.selections} mode={row.prefs.mode} {busy}
              onSelect={(stage, id) => void configureFit(row, stage, id)}
              onAccept={(stage, fit) => void configureFit(row, stage, fit.fittingID, fit)} />
          {/if}
        {/if}
      </article>
    {/each}
  </div>
</main>

<style>
  .factory { max-width: 1400px; margin: auto; padding: 2rem; }
  .factory-head, .factory-card > header, nav, .factory-controls { display: flex; align-items: center; gap: 1rem; justify-content: space-between; flex-wrap: wrap; }
  .factory-head h1 { font-size: 2.3rem; margin: .25rem 0; }
  .eyebrow { font-size: .85rem; opacity: .7; margin: 0; }
  .factory-controls { justify-content: flex-start; margin: 1rem 0; }
  label { display: flex; align-items: center; gap: .5rem; }
  input, select { padding: .45rem; border: 1px solid #455569; border-radius: 4px; background: #16202e; color: #e4edf7; }
  .factory-roster { display: grid; gap: 1rem; }
  .factory-card { padding: 1.25rem; border: 1px solid #364252; border-radius: 8px; background: #121b27; }
  h2 { margin: .25rem 0; }
  dl { display: flex; flex-wrap: wrap; gap: 1rem 2rem; }
  dt { opacity: .65; font-size: .85rem; } dd { margin: .25rem 0; }
  @media (max-width: 650px) { .factory { padding: 1rem; } .factory-head { align-items: flex-start; } }
</style>
