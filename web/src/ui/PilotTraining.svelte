<script lang="ts">
  import { onMount } from "svelte";
  import { loadMinerTraining, loadTrainingCharacters } from "../app/api.ts";
  import { formatDuration, romanLevel } from "../bridge/skills.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { MinerReport, RequirementRow, TrainingCharacter, PlanEta } from "../training/types.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const station = store.station;
  let account = $state("");
  let characters = $state<readonly TrainingCharacter[]>([]);
  let selectedID = $state(0);
  let role = $state<"" | "MINER">("");
  let report = $state<MinerReport | null>(null);
  let rosterLoaded = $state(false);
  let busy = $state(false);
  let error = $state("");
  let readNumber = 0;

  function etaWords(eta: PlanEta): string {
    if (eta.kind === "READY") return "Already trained";
    if (eta.kind === "SERVER_QUEUE") return `${formatDuration(eta.remainingMs)} · server queue`;
    return `Unknown · ${eta.reason}`;
  }

  async function readPilot(id: number): Promise<void> {
    const read = ++readNumber;
    selectedID = id;
    report = null;
    error = "";
    if (!Number.isSafeInteger(id) || id <= 0 || role !== "MINER") return;
    busy = true;
    try {
      const result = await loadMinerTraining(id, flow.requestOptions());
      if (read === readNumber) report = result;
    } catch (cause) {
      if (read === readNumber) error = panelErrorWords(cause);
    } finally {
      if (read === readNumber) busy = false;
    }
  }

  async function readRoster(): Promise<void> {
    busy = true;
    error = "";
    try {
      const roster = await loadTrainingCharacters(flow.requestOptions());
      account = roster.account;
      characters = roster.characters;
      rosterLoaded = true;
      const activeID = $station.online?.characterID ?? 0;
      const id = characters.find((character) => character.characterID === activeID)?.characterID
        ?? characters[0]?.characterID ?? 0;
      selectedID = id;
      if (role === "MINER") await readPilot(id);
      else busy = false;
    } catch (cause) {
      error = panelErrorWords(cause);
      rosterLoaded = true;
      busy = false;
    }
  }

  onMount(() => { void readRoster(); });
</script>

{#snippet skillRows(rows: readonly RequirementRow[])}
  {#if rows.length === 0}
    <p class="note">No additional skill targets.</p>
  {:else}
    <div class="table-wrap overflow-x-auto">
      <table class="guests reflow">
        <thead><tr><th>Skill</th><th>Target</th><th>Trained</th><th>Status</th></tr></thead>
        <tbody>
          {#each rows as row (row.typeID)}
            <tr>
              <td data-label="Skill">{row.name}</td>
              <td data-label="Target">{romanLevel(row.level)}</td>
              <td data-label="Trained">{row.trainedLevel === null ? "Unknown" : romanLevel(row.trainedLevel) || "—"}</td>
              <td data-label="Status">{row.state}{row.queuePosition >= 0 ? ` · queue ${row.queuePosition + 1}` : ""}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/snippet}

<section class="panel">
  <header class="panel-head">
    <div><h2 class="panel-title">Pilot Training</h2><p class="subtitle">Read-only Miner qualification · policy v{report?.policyVersion ?? 1}</p></div>
    <button type="button" class="minor" disabled={busy} onclick={() => { if (selectedID > 0 && role === "MINER") void readPilot(selectedID); else void readRoster(); }}>Refresh</button>
  </header>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <section>
    <label for="training-pilot">Pilot</label>
    <select id="training-pilot" value={selectedID} disabled={busy || characters.length === 0}
      onchange={(event) => void readPilot(Number(event.currentTarget.value))}>
      {#each characters as character (character.characterID)}
        <option value={character.characterID}>{character.name}</option>
      {/each}
    </select>
    <label for="training-role">Role</label>
    <select id="training-role" value={role} disabled={busy}
      onchange={(event) => { role = event.currentTarget.value === "MINER" ? "MINER" : ""; void readPilot(selectedID); }}>
      <option value="">Choose role</option>
      <option value="MINER">MINER</option>
    </select>
    <p class="note">Account: {account || "—"} · Role: {role || "not selected"}. Account names do not assign a role.</p>
  </section>

  {#if !rosterLoaded || (busy && !report)}<p class="note">Reading skill qualification…</p>{/if}
  {#if rosterLoaded && characters.length > 0 && role === ""}<p class="note">Choose MINER to preview this pilot's qualification.</p>{/if}
  {#if report}
    <section>
      <h3>Current qualification</h3>
      <p><strong>{report.currentStage ?? "No stage ready"}</strong> · {report.currentStageStatus}</p>
      <p class="note">Next stage: {report.nextStage ?? "All declared stages skill-qualified"}. Skill qualification, equipment readiness, and operation assignment are separate.</p>
    </section>

    <section>
      <h3>Stages</h3>
      {#each report.stages as stage (stage.id)}
        <details>
          <summary>{stage.id} · {stage.fitName} · skills {stage.skillQualification} · equipment {stage.equipmentReadiness}</summary>
          <h4>Hard requirements</h4>
          {@render skillRows(stage.hard)}
          <h4>Support policy</h4>
          {@render skillRows(stage.support)}
          <p class="note">Equipment: {stage.equipmentReadiness}. {stage.equipmentReason}</p>
        </details>
      {/each}
    </section>

    <section>
      <h3>Progression previews</h3>
      <p class="note">Previews only. No skill queue changes are available here. Completion times are exact only when the server's existing queue covers every remaining target.</p>
      {#each ["FAST", "BALANCED", "MASTERY"] as mode}
        {@const preview = report.previews[mode as "FAST" | "BALANCED" | "MASTERY"]}
        <details>
          <summary>{mode} → {preview.stage ?? "No next stage"} · {etaWords(preview.eta)}</summary>
          {#if mode === "FAST"}<p class="note">Next stage hard requirements only.</p>{/if}
          {#if mode === "BALANCED"}<p class="note">Next stage hard requirements and selected support targets.</p>{/if}
          {#if mode === "MASTERY"}<p class="note">Deepen the current stage with selected level V targets.</p>{/if}
          {@render skillRows(preview.targets)}
        </details>
      {/each}
    </section>
  {:else if rosterLoaded && !busy && !error && characters.length === 0}
    <p class="empty">No characters are available on this account.</p>
  {/if}
</section>
