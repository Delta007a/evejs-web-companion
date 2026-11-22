<script lang="ts">
  import { untrack } from "svelte";
  import type { TrainingSettings, TrainingCorporation, TrainingAuthority } from "../training/settings.ts";
  let { settings, corporations, authorities, busy, traineeCorporationID = null, traineeCorporationName = null, worldReady = false, contextError = "", candidates = [], onInspect, onSave }: {
    settings: TrainingSettings; corporations: readonly TrainingCorporation[]; authorities: readonly TrainingAuthority[];
    busy: boolean; traineeCorporationID?: number | null; traineeCorporationName?: string | null; worldReady?: boolean; contextError?: string; candidates?: readonly {key:string;name:string;account:string}[]; onInspect: (key:string) => void; onSave: (value: TrainingSettings) => void;
  } = $props();
  let authority = $state(untrack(() => settings.onboarding.authorityKey));
  let rights = $state(untrack(() => settings.onboarding.rights));
  let automaticFunding = $state(untrack(() => settings.automaticFunding === true));
  $effect(() => {
    authority = settings.onboarding.authorityKey;
    rights = settings.onboarding.rights;
    automaticFunding = settings.automaticFunding === true;
  });
  const eligible = $derived(authorities.filter((a) => a.eligible));
  const selected = $derived(eligible.find((a) => a.key === authority));
  const corporation = $derived(corporations.find((c) => c.corporationID === selected?.corporationID));
  const fundingCorporationID = $derived(traineeCorporationID ?? settings.trainingWallet?.corporationID ?? selected?.corporationID ?? null);
  const fundingCorporationName = $derived(corporations.find(c => c.corporationID === fundingCorporationID)?.name ??
    (traineeCorporationID === fundingCorporationID ? traineeCorporationName : null));
  const canSave = $derived(!busy && worldReady && (!automaticFunding || fundingCorporationID !== null) &&
    (authority === settings.onboarding.authorityKey || !!selected) &&
    (!!selected || automaticFunding || settings.automaticFunding === true));
  function save() {
    if (!canSave) return;
    onSave({ onboarding: selected ? { enabled: true, corporationID: selected.corporationID, rights, authorityKey: selected.key } : settings.onboarding,
      trainingWallet: automaticFunding && fundingCorporationID !== null ? { corporationID: fundingCorporationID, accountKey: 1000 } : null,
      automaticFunding, home: settings.home });
  }
</script>
<section class="settings" aria-label="Corporation HR Pilot">
  <h2>Corporation HR Pilot</h2>
  <p>Use a separate Director for onboarding and permissions. Training uses the trainee's wallet rights first.</p>
  {#if !worldReady}<p class="notice">Current world identity is unverified. HR settings cannot be saved.</p>{/if}
  {#if contextError}<p class="notice">{contextError}</p>{/if}
  <div class="fields">
    <label>Corporation HR Pilot
      <select value={authority} disabled={busy} onchange={(event) => { authority = event.currentTarget.value; }}>
        <option value="">Choose a saved pilot to verify</option>
        {#if authority && !candidates.some(a => a.key === authority)}<option value={authority}>Saved HR pilot unavailable</option>{/if}
        {#each candidates as actor}<option value={actor.key}>{actor.name} · {actor.account}</option>{/each}
      </select>
    </label>
    {#if authority && !selected && candidates.some(candidate => candidate.key === authority)}
      <button type="button" disabled={busy} onclick={() => onInspect(authority)}>Verify HR permissions</button>
    {/if}
    <p>Corporation <strong>{corporation ? `${corporation.name} (${corporation.corporationID})` : authority ? "Awaiting verified membership" : "Select an HR pilot"}</strong></p>
    <label>Bot permissions
      <select bind:value={rights} disabled={busy}>
        <option value="FULL_ACCESS_EXCEPT_CEO">Full access (except CEO)</option>
        <option value="NONE">Preserve existing permissions</option>
      </select>
    </label>
    {#if rights === "FULL_ACCESS_EXCEPT_CEO"}<p>Applies all supported ordinary permissions. CEO and Director remain protected.</p>{/if}
    <label class="check"><input type="checkbox" bind:checked={automaticFunding} disabled={busy} /> Enable automatic corporate skill funding</label>
    {#if automaticFunding}
      <p>Master Wallet (Division 1) · {fundingCorporationName ?? (fundingCorporationID ? `Corporation ${fundingCorporationID}` : "Select a trainee to identify the corporation")}</p>
    {/if}
  </div>
  <button type="button" disabled={!canSave} onclick={save}>Save corporation settings</button>
  {#if automaticFunding && fundingCorporationID === null}<p class="notice">Select a trainee with verified corporation membership to use the Master Wallet.</p>{/if}
  <details class="advanced"><summary>Advanced details</summary>
    <p>Corporation {fundingCorporationID ?? "unknown"} · HR {authority || "unconfigured"} · wallet {automaticFunding ? "1000" : "disabled"}</p>
  </details>
</section>
<style>
  .settings { margin:1rem 0; border:1px solid #455569; padding:1rem; }
  .fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:1rem; margin:1rem 0; }
  label { display:flex; flex-direction:column; gap:.4rem; } .check { flex-direction:row; align-items:center; }
  select { background:#16202e; color:#e4edf7; padding:.5rem; border:1px solid #455569; } p { max-width:90ch; }
  button { margin:.4rem .5rem .4rem 0; } .notice { color:#e9c982; } .advanced { margin-top:1rem; }
</style>
