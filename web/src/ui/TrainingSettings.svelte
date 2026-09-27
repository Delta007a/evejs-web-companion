<script lang="ts">
  import type { TrainingSettings } from "../training/settings.ts";
  let { settings, authorities, busy, onSave, onResolve }: { settings: TrainingSettings;
    authorities: readonly { key: string; label: string }[]; busy: boolean;
    onSave: (value: TrainingSettings) => void; onResolve: (id: number) => Promise<TrainingSettings["home"]> } = $props();
  let enabled = $state(false), corporation = $state("");
  let rights = $state<"NONE" | "FULL_ACCESS_EXCEPT_CEO">("NONE"), authority = $state("");
  let walletCorp = $state(""), walletKey = $state(""), homeID = $state("");
  let home = $state<TrainingSettings["home"]>(null), message = $state("");
  $effect(() => { enabled = settings.onboarding.enabled; corporation = String(settings.onboarding.corporationID || "");
    rights = settings.onboarding.rights; authority = settings.onboarding.authorityKey;
    walletCorp = String(settings.trainingWallet?.corporationID || ""); walletKey = String(settings.trainingWallet?.accountKey || "");
    home = settings.home; homeID = String(settings.home?.locationID || ""); });
  async function resolveHome() {
    try { home = await onResolve(Number(homeID)); message = home ? `Resolved: ${home.name}` : "Unknown location"; }
    catch (cause) { home = null; message = String(cause); }
  }
  function save() {
    onSave({ onboarding: { enabled, corporationID: corporation ? Number(corporation) : null, rights, authorityKey: authority },
      trainingWallet: walletCorp || walletKey ? { corporationID: Number(walletCorp), accountKey: Number(walletKey) } : null,
      home: home && home.locationID === Number(homeID) ? home : null });
  }
</script>
<details><summary>Pilot Training settings</summary>
  <p>Browser-local configuration. Onboarding and corporation funding are disabled/unconfigured for fresh users.</p>
  <label><input type="checkbox" bind:checked={enabled} disabled={busy} /> Onboard newly created trainees automatically</label>
  <label>Onboarding corporation ID <input bind:value={corporation} disabled={busy} /></label>
  <label>Dedicated non-CEO authority <select bind:value={authority} disabled={busy}><option value="">Unconfigured</option>
    {#each authorities as actor}<option value={actor.key}>{actor.label}</option>{/each}</select></label>
  <label>Ordinary rights <select bind:value={rights} disabled={busy}><option value="NONE">NONE</option><option value="FULL_ACCESS_EXCEPT_CEO">FULL_ACCESS_EXCEPT_CEO</option></select></label>
  <p>Full access grants ordinary roles, hangar/wallet/industry permissions and their grantable masks. CEO ownership and Director promotion are excluded. A dedicated non-CEO Director is required; a busy authority is never taken over.</p>
  <label>Training wallet corporation ID <input bind:value={walletCorp} disabled={busy} /></label>
  <label>Training wallet division <select bind:value={walletKey} disabled={busy}><option value="">Unconfigured</option>
    {#each [1000,1001,1002,1003,1004,1005,1006] as key}<option value={String(key)}>Division {key - 999} ({key})</option>{/each}</select></label>
  <p>Funding uses the exact reviewed shortfall. Trainee Account Take permission is checked; no allowance or reserve.</p>
  <label>Training / provisioning home · location ID <input bind:value={homeID} disabled={busy} /></label>
  <button class="minor" type="button" disabled={busy || !homeID} onclick={resolveHome}>Resolve home</button>
  {#if home}<p>{home.name} · {home.kind} · system {home.systemID ?? "unknown"}. Relocation: manual GM command only.</p>{/if}
  <p>Home is configuration only; saving does not move pilots. Player-structure relocation is unavailable until docking authority is implemented.</p>
  <button type="button" disabled={busy} onclick={save}>Save training settings</button>
  {#if message}<p role="status">{message}</p>{/if}
</details>
<style>details { margin: 1rem 0; border: 1px solid #455569; padding: 1rem; } label { display:flex; gap:.6rem; margin:.6rem 0; } input,select { background:#16202e; color:#e4edf7; padding:.4rem; } p { max-width:90ch; }</style>
