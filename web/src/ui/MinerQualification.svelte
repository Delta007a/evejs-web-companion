<script lang="ts">
  import { formatDuration, romanLevel } from "../bridge/skills.ts";
  import { fittingsForHull } from "../training/fittingSelection.ts";
  import { requirementCounts, skillTargetLabel, type PlanMode } from "../training/factory.ts";
  import type { MinerTrainingRead, RequirementRow, CorporationSavedFitting, StageFittingSelection } from "../training/types.ts";
  let { result, selections, mode, busy, onSelect, onAccept }: {
    result: MinerTrainingRead; selections: Readonly<Record<string, StageFittingSelection>>;
    mode: PlanMode; busy: boolean;
    onSelect: (stageID: string, fittingID: number) => void;
    onAccept: (stageID: string, fit: CorporationSavedFitting) => void;
  } = $props();
  const report = $derived(result.report);
  const preview = $derived(report.previews[mode]);
</script>

{#snippet skillRows(rows: readonly RequirementRow[])}
  <div class="table-wrap overflow-x-auto"><table class="guests reflow">
    <thead><tr><th>Skill</th><th>Target</th><th>Trained</th><th>Target status</th></tr></thead>
    <tbody>{#each rows as row (row.typeID)}<tr>
      <td data-label="Skill">{row.name}</td>
      <td data-label="Target">{romanLevel(row.level)}</td>
      <td data-label="Trained">{row.trainedLevel === null ? "Unknown" : romanLevel(row.trainedLevel) || "—"}</td>
      <td data-label="Target status">{skillTargetLabel(row.state)}{row.queuePosition >= 0 ? ` · queue ${row.queuePosition + 1}` : ""}</td>
    </tr>{/each}</tbody>
  </table></div>
{/snippet}

<section aria-label="Miner qualification">
  <h3>Miner stages · support policy v{report.policyVersion}</h3>
  <p class="note">Highest proven qualification: <strong>{report.currentStage ?? "None proven"}</strong>. Next stage: {report.nextStage ?? "All stages reached"}.</p>
  <p class="note">NEEDS TRAINING means the target level is not yet trained or queued; a lower level may already be trained. Queued levels do not count as trained.</p>
  {#each report.stages as stage (stage.id)}
    {@const counts = requirementCounts(stage.hard)}
    {@const support = requirementCounts(stage.support)}
    {@const chosen = selections[stage.id]}
    <details open={stage.fitting.status === "REVIEW_REQUIRED"}>
      <summary>{stage.id} · skills {stage.skillQualification} · fitting {stage.fitting.status}</summary>
      <p>Expected hull: {stage.id} (type {stage.hullTypeID})</p>
      <label for={`factory-fit-${stage.id}`}>Corporation saved fitting</label>
      <select id={`factory-fit-${stage.id}`} value={chosen?.fittingID ?? 0} disabled={busy}
        onchange={(event) => onSelect(stage.id, Number(event.currentTarget.value))}>
        <option value={0}>Choose fitting</option>
        {#each fittingsForHull(result.fittings, stage.hullTypeID) as fit (fit.fittingID)}
          <option value={fit.fittingID}>{fit.name} · owner {fit.ownerID} / fitting {fit.fittingID}</option>
        {/each}
      </select>
      <p class="note">Selected: {stage.fitName}. Identity: {chosen ? `${chosen.ownerID} / ${chosen.fittingID}` : "not configured"}.</p>
      {#if stage.fitting.reason}<p class="note">{stage.fitting.reason}</p>{/if}
      <p class="note">Accepted saved date: {chosen?.acceptedSavedDate ?? "none"}</p>
      <p class="note fingerprint">Accepted fingerprint: {chosen?.acceptedFingerprint ?? "none"}</p>
      {#if stage.fitting.status === "REVIEW_REQUIRED"}
        {@const fit = result.fittings.find((candidate) => candidate.fittingID === chosen?.fittingID)}
        <p class="note">Current saved date: {stage.fitting.currentSavedDate ?? "unknown"}</p>
        <p class="note fingerprint">Current fingerprint: {stage.fitting.currentFingerprint ?? "unknown"}</p>
        {#if fit && !fit.invalid}
          <button type="button" class="minor" disabled={busy} onclick={() => onAccept(stage.id, fit)}>Accept current fitting</button>
          <p class="note">Updates this browser's Training Center configuration only.</p>
        {/if}
      {/if}
      <h4>Hard requirements</h4>
      {#if stage.fitting.status === "READY"}
        <p>{counts.TRAINED} / {stage.hard.length} satisfied · Training {counts.TRAINING} · Queued {counts.QUEUED} · Needs training {counts.MISSING} · Unknown {counts.UNKNOWN}</p>
        {@render skillRows(stage.hard)}
      {:else}<p class="note">UNKNOWN — an accepted, readable stage fitting is required.</p>{/if}
      <details><summary>Support policy · {support.TRAINED} / {stage.support.length} targets trained</summary>
        {@render skillRows(stage.support)}
      </details>
      <p class="note">Equipment: UNKNOWN. The fitting is a desired manifest; ship ownership, inventory and fitting execution are not checked.</p>
    </details>
  {/each}
  <h3>{mode} preview → {preview.stage ?? "No next stage"}</h3>
  <p class="note">{mode === "FAST" ? "Next-stage hard requirements only." : mode === "BALANCED" ? "Next-stage hard requirements plus selected support targets." : "Current-stage hard requirements and selected support/mastery targets, including intentional level V goals."}</p>
  <p>ETA: {preview.eta.kind === "READY" ? "Already trained" : preview.eta.kind === "SERVER_QUEUE" ? `${formatDuration(preview.eta.remainingMs)} · authoritative server queue` : `UNKNOWN · ${preview.eta.reason}`}</p>
  {#if preview.targets.length > 0}{@render skillRows(preview.targets)}{/if}
  <p class="note">This preview does not change training. Review the append below before explicitly applying. Equipment is not issued.</p>
</section>
<style>
  details { margin: .75rem 0; padding: .75rem; border: 1px solid var(--border, #364252); border-radius: 6px; }
  summary { cursor: pointer; font-weight: 600; }
  select { display: block; max-width: 100%; margin: .5rem 0; }
  .fingerprint { overflow-wrap: anywhere; }
</style>
