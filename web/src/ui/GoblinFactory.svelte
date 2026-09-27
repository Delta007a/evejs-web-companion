<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { loadKnownCharacters } from "../app/knownCharacters.ts";
  import CharacterCreate from "./CharacterCreate.svelte";
  import { createCharacter, type CreateCharacterRequest } from "../app/api.ts";
  import { loadTrainingCharacters, reviewTrainingQueue, applyTrainingQueue, reviewSkillAcquisition, acquireFactorySkills, factoryOwnership, type ApiOptions } from "../app/api.ts";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { readFactoryAccount, readFactoryPilot } from "../training/factoryClient.ts";
  import { factoryError as panelErrorWords } from "../training/factory.ts";
  import { formatDuration } from "../bridge/skills.ts";
  import { acceptStageFitting } from "../training/fittingSelection.ts";
  import { readSelections, saveSelections, readPilotPreferences, savePilotPreferences,
    readFactoryAccounts, rememberFactoryAccount, factoryStatus, factoryStatusLabels,
    readLastQueueApply, rememberQueueApply, type LastQueueApply,
    type PilotPreferences, type PlanMode, type FactoryStatus } from "../training/factory.ts";
  import type { TrainingCharacter, MinerTrainingRead, StageFittingSelection, CorporationSavedFitting, QueueReview, QueueApplyOutcome, TrainingQueue } from "../training/types.ts";
  import MinerQualification from "./MinerQualification.svelte";
  import TrainingQueueReview from "./TrainingQueueReview.svelte";
  import SkillAcquisition from "./SkillAcquisition.svelte";
  import type { AcquisitionReview, AcquisitionOutcome, FactoryFunding, FundingPolicy } from "../training/types.ts";

  interface PilotRow {
    key: string; account: string; pilot: TrainingCharacter; prefs: PilotPreferences;
    selections: Record<string, StageFittingSelection>; result: MinerTrainingRead | null;
    error: string; readAt: number | null;
    review: QueueReview | null; queue: TrainingQueue | null; queueMessage: string; lastApply: LastQueueApply | null;
    acquisition: AcquisitionReview | null; acquisitionFunding: FactoryFunding | null; acquisitionOutcome: AcquisitionOutcome | null; acquisitionMessage: string; owner: string;
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
  let creatingAccount = $state<string | null>(null);
  let newTraineeAccount = $state("");
  const credentials = new Map<string, ApiOptions>(); // Memory only; never gameplay sessions.
  const creatorFlow = (account: string) => ({
    requestOptions: () => credentials.get(account)!,
    createCharacter: (request: CreateCharacterRequest) => createCharacter(request, credentials.get(account)!),
  });
  async function created(account: string): Promise<void> {
    creatingAccount = null;
    busy = true;
    const ticket = ++generation;
    await readAccount(account, ticket);
    if (ticket === generation) busy = false;
  }
  let generation = 0;
  const keyOf = (account: string, id: number) => JSON.stringify([account, id]);
  const visible = $derived(rows.filter((row) =>
    `${row.account} ${row.pilot.name}`.toLowerCase().includes(query.toLowerCase()) &&
    (filter === "ALL" || factoryStatus(row.result?.report ?? null, row.prefs.mode, row.error) === filter)));
  function update(key: string, fields: Partial<PilotRow>): void {
    rows = rows.map((row) => row.key === key ? { ...row, ...fields } : row);
  }
  function assertLocalPlan(row: PilotRow): void {
    const prefs = readPilotPreferences(localStorage, row.account, row.pilot.characterID);
    if (prefs.role !== row.prefs.role || prefs.mode !== row.prefs.mode ||
        (prefs.targetStage ?? null) !== (row.result?.report.targetStage ?? null)) throw new Error("PLAN_CHANGED: local target changed; refresh and review again.");
  }
  function makeRow(account: string, pilot: TrainingCharacter): PilotRow {
    let prefs: PilotPreferences = { role: "", mode: "BALANCED" };
    let selections = {};
    let configError = "";
    try { prefs = readPilotPreferences(localStorage, account, pilot.characterID); selections = readSelections(localStorage, account, pilot.characterID); }
    catch { configError = "Browser configuration is unreadable; stored fitting selections have not been overwritten."; }
    return { key: keyOf(account, pilot.characterID), account, pilot, prefs, selections, result: null, error: configError, readAt: null,
      review: null, queue: null, queueMessage: "", lastApply: readLastQueueApply(localStorage, account, pilot.characterID),
      acquisition: null, acquisitionFunding: null, acquisitionOutcome: null, acquisitionMessage: "", owner: "UNKNOWN" };
  }
  async function readPilot(row: PilotRow, ticket: number): Promise<void> {
    if (ticket !== generation) return;
    update(row.key, { result: null, readAt: null, review: null, queue: null, acquisition: null });
    if (!row.prefs.role || row.error) return;
    try {
      const options = credentials.get(row.account);
      if (!options) throw new Error("Account authentication is unavailable; refresh the roster.");
      const selections = readSelections(localStorage, row.account, row.pilot.characterID);
      const result = await readFactoryPilot(row.pilot.characterID, selections, options, row.prefs.targetStage ?? null);
      let owner = "UNKNOWN";
      try { owner = (await factoryOwnership(row.pilot.characterID, options)).owner; } catch { /* unreadable ownership stays unknown */ }
      if (ticket === generation) update(row.key, { result, selections, queue: result.queue ?? null, error: "", readAt: Date.now(), owner });
    } catch (cause) {
      if (ticket === generation) update(row.key, { result: null, error: panelErrorWords(cause), readAt: null });
    }
  }
  async function readAccount(account: string, ticket: number): Promise<void> {
    // Account and pilot reads are serialized; a refresh never competes with an edit.
    rows = rows.map((row) => row.account === account ? { ...row, result: null, readAt: null, review: null, queue: null } : row);
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
      update(row.key, { prefs, review: null, queueMessage: "", acquisition: null });
      if (prefs.role !== row.prefs.role || prefs.targetStage !== row.prefs.targetStage) {
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
      update(row.key, { selections, error: "", review: null, queueMessage: "", acquisition: null });
      busy = true;
      const ticket = ++generation;
      await readPilot({ ...row, selections, error: "" }, ticket);
      if (ticket === generation) busy = false;
    } catch (cause) { error = `Fitting configuration could not be saved: ${String(cause)}`; busy = false; }
  }
  const queueError = (cause: unknown) => cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
  async function reviewAcquisition(row: PilotRow, policy: FundingPolicy, officerKey: string, division: number): Promise<void> {
    const options = credentials.get(row.account);
    if (busy || !row.result || !options || row.prefs.role !== "MINER") return;
    busy = true;
    update(row.key, { acquisition: null, acquisitionMessage: "Reading live purchase authority; temporary sessions will be released…" });
    try {
      assertLocalPlan(row);
      const preview = row.result.report.previews[row.prefs.mode];
      const selections = readSelections(localStorage, row.account, row.pilot.characterID);
      if (JSON.stringify(selections) !== JSON.stringify(row.selections)) throw new Error("PLAN_CHANGED: refresh the fitting configuration.");
      const officer = rows.find((entry) => entry.key === officerKey);
      const token = officer && credentials.get(officer.account)?.token;
      const funding = policy === "CHARACTER_PLUS_CORPORATION_SHORTFALL" && officer && token ? { characterID: officer.pilot.characterID, token } : null;
      const acquisition = await reviewSkillAcquisition({ characterID: row.pilot.characterID, role: "MINER", mode: row.prefs.mode,
        stage: preview.stage, targetStage: row.prefs.targetStage ?? null, displayedTargets: preview.targets.map(({ typeID, level }) => ({ typeID, level })), selections,
        policy, funding, division }, options);
      update(row.key, { acquisition, acquisitionFunding: funding, acquisitionMessage: "No money has moved. Confirm the exact review below." });
    } catch (cause) { update(row.key, { acquisitionMessage: queueError(cause) }); }
    finally { busy = false; }
  }
  async function acquireSkills(row: PilotRow): Promise<void> {
    const review = row.acquisition;
    const options = credentials.get(row.account);
    if (busy || !review?.canAcquire || !review.reviewID || !options) return;
    busy = true;
    update(row.key, { acquisition: null, acquisitionMessage: "Acquiring exactly the reviewed skills…", review: null });
    try {
      if (review.mode !== row.prefs.mode || (readPilotPreferences(localStorage, row.account, row.pilot.characterID).targetStage ?? null) !== (row.result?.report.targetStage ?? null) || JSON.stringify(readSelections(localStorage, row.account, row.pilot.characterID)) !== JSON.stringify(row.selections)) throw new Error("PLAN_CHANGED: review again.");
      assertLocalPlan(row);
      const outcome = await acquireFactorySkills(review.reviewID, row.acquisitionFunding, options);
      update(row.key, { acquisitionOutcome: outcome, acquisitionMessage: outcome.status, result: outcome.fresh,
        queue: outcome.fresh?.queue ?? null, acquisitionFunding: null });
      try { update(row.key, { owner: (await factoryOwnership(row.pilot.characterID, options)).owner }); } catch { update(row.key, { owner: "UNKNOWN" }); }
    } catch (cause) { update(row.key, { acquisitionMessage: `${queueError(cause)} Do not retry blindly; refresh skills and wallet first.` }); }
    finally { busy = false; }
  }
  async function reviewQueue(row: PilotRow): Promise<void> {
    if (busy || !row.result || row.prefs.role !== "MINER") return;
    const options = credentials.get(row.account);
    if (!options) return;
    busy = true;
    const ticket = ++generation;
    update(row.key, { review: null, queueMessage: "" });
    try {
      assertLocalPlan(row);
      const preview = row.result.report.previews[row.prefs.mode];
      const selections = readSelections(localStorage, row.account, row.pilot.characterID);
      // Changing a local fit in another tab invalidates this displayed preview.
      if (JSON.stringify(selections) !== JSON.stringify(row.selections)) throw new Error("PLAN_CHANGED: fitting configuration changed; refresh first.");
      const review = await reviewTrainingQueue({ characterID: row.pilot.characterID, role: "MINER", mode: row.prefs.mode,
        stage: preview.stage, targetStage: row.prefs.targetStage ?? null, displayedTargets: preview.targets.map(({ typeID, level }) => ({ typeID, level })), selections }, options);
      if (ticket === generation) update(row.key, { review, result: review.fresh, queue: review.queue, readAt: Date.now() });
    } catch (cause) {
      if (ticket === generation) {
        await readPilot({ ...row, error: "" }, ticket);
        update(row.key, { queueMessage: queueError(cause) });
      }
    } finally { if (ticket === generation) busy = false; }
  }
  function recordApply(row: PilotRow, outcome: QueueApplyOutcome): void {
    const { fresh: _fresh, queue: _queue, message: _message, ...record } = outcome;
    update(row.key, { lastApply: record });
    try { rememberQueueApply(localStorage, row.account, row.pilot.characterID, outcome); }
    catch { update(row.key, { queueMessage: `${outcome.message} Local audit record could not be saved.` }); }
  }
  async function applyQueue(row: PilotRow): Promise<void> {
    const reviewed = row.review;
    const options = credentials.get(row.account);
    if (busy || !reviewed?.canApply || !reviewed.reviewID || !options || row.prefs.role !== "MINER") return;
    busy = true;
    const ticket = ++generation;
    // Disable repeat clicks immediately, even if transport fails.
    update(row.key, { review: null, queueMessage: "Applying reviewed append…" });
    try {
      const selections = readSelections(localStorage, row.account, row.pilot.characterID);
      if (row.prefs.mode !== reviewed.mode || (readPilotPreferences(localStorage, row.account, row.pilot.characterID).targetStage ?? null) !== (row.result?.report.targetStage ?? null) || JSON.stringify(selections) !== JSON.stringify(row.selections))
        throw new Error("PLAN_CHANGED: local configuration changed; review again.");
      assertLocalPlan(row);
      const outcome = await applyTrainingQueue(reviewed.reviewID, options);
      if (ticket !== generation) return;
      update(row.key, { result: outcome.fresh, queue: outcome.queue, queueMessage: `${outcome.status}${outcome.code ? ` · ${outcome.code}` : ""}: ${outcome.message}`,
        readAt: outcome.queue ? Date.now() : null });
      recordApply(row, outcome);
    } catch (cause) {
      if (ticket !== generation) return;
      const message = queueError(cause);
      const refused = !(cause instanceof BridgeCallError) || (cause.status >= 400 && cause.status < 500);
      recordApply(row, { status: refused ? "REFUSED" : "APPLY_UNVERIFIED", verified: false, mode: reviewed.mode,
        stage: reviewed.stage || "Unknown", at: Date.now(), added: null, attemptedAdditions: reviewed.additions.length,
        code: cause instanceof BridgeCallError ? cause.code : "PLAN_CHANGED", message, fresh: null, queue: null });
      await readPilot({ ...row, error: "" }, ticket);
      if (ticket === generation) update(row.key, { queueMessage: `${refused ? "REFUSED" : "APPLY_UNVERIFIED"}: ${message} No automatic retry. Review again.` });
    } finally { if (ticket === generation) busy = false; }
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
    <div><p class="eyebrow">EveJS Web · control plane</p><h1>Goblin Factory</h1><p>Miner qualification and reviewed training queue append</p></div>
    <nav><a href="/" target="_blank" rel="noopener">Pilot Hangar</a><button type="button" class="minor" disabled={busy || !ready} onclick={refresh}>{busy ? "Reading…" : "Refresh roster"}</button></nav>
  </header>
  <p class="note">Skill qualification does not establish equipment readiness. Qualification and queue reads stay offline. Skill acquisition explicitly opens temporary live sessions for free pilots and releases them afterward.</p>
  <form class="factory-controls" onsubmit={addAccount}>
    <label>Existing account <input aria-label="Existing account" bind:value={accountInput} disabled={busy || !ready} placeholder="Account name" autocomplete="username" /></label>
    <button class="minor" disabled={busy || !ready || !accountInput.trim()}>Sign in / add to roster</button>
    <span class="note">Normal WC authentication; unknown names are refused. No account creation.</span>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#each Object.entries(accountErrors).filter(([, message]) => message) as [account, message] (account)}
    <p class="error">{account}: {message}</p>
  {/each}
  {#if creatingAccount}
    <section><h2>Create on account: {creatingAccount}</h2>
      <CharacterCreate flow={creatorFlow(creatingAccount)} onCancel={() => creatingAccount = null}
        onCreated={() => { if (creatingAccount) void created(creatingAccount); }} />
    </section>
  {:else}
    <div class="factory-controls">
      <label>New trainee account <select bind:value={newTraineeAccount} disabled={busy}>
        <option value="">Choose an authenticated account</option>
      {#each accounts.filter((account) => credentials.has(account) && (!accountErrors[account] || accountErrors[account] === "No characters on this account.")) as account}
        <option value={account}>{account}</option>
      {/each}
      </select></label>
      <button class="minor" type="button" disabled={busy || !newTraineeAccount} onclick={() => creatingAccount = newTraineeAccount}>Open character creator</button>
      <span class="note">Uses the existing character creator; authoritative free slots are checked before creation.</span>
    </div>
  {/if}
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
          <label>Target stage <select aria-label={`Target stage for ${row.pilot.name}`} value={row.prefs.targetStage ?? ""} disabled={busy} onchange={(event) => void changePreferences(row, { ...row.prefs, targetStage: (event.currentTarget.value || null) as PilotPreferences["targetStage"] })}>
            <option value="">Automatic (next / current mastery)</option><option value="VENTURE">Venture</option><option value="PIONEER">Pioneer</option><option value="PROCURER">Procurer</option>
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
        {#if row.result || row.queue || row.lastApply}
          <button class="minor" type="button" onclick={() => expanded = expanded === row.key ? null : row.key}>{expanded === row.key ? "Hide stages" : "Inspect stages and plan"}</button>
          {#if expanded === row.key}
            {#if row.result}<MinerQualification result={row.result} selections={row.selections} mode={row.prefs.mode} {busy}
              onSelect={(stage, id) => void configureFit(row, stage, id)}
              onAccept={(stage, fit) => void configureFit(row, stage, fit.fittingID, fit)} />{/if}
            <p>Session ownership: {row.owner} · Ownership is rechecked before temporary login.</p>
            {#if row.prefs.role === "MINER"}<TrainingQueueReview result={row.result} queue={row.queue} review={row.review}
              mode={row.prefs.mode} {busy} message={row.queueMessage} lastApply={row.lastApply}
              onReview={() => void reviewQueue(row)} onApply={() => void applyQueue(row)} />{/if}
            {#if row.prefs.role === "MINER" && (row.review?.blockers.some((blocker) => blocker.code === "SKILLBOOK_REQUIRED") || row.acquisition || row.acquisitionOutcome || row.acquisitionMessage)}
              <SkillAcquisition review={row.acquisition} outcome={row.acquisitionOutcome} {busy} mode={row.prefs.mode}
                stage={row.result?.report.previews[row.prefs.mode].stage ?? null} message={row.acquisitionMessage}
                officers={rows.filter((entry) => entry.key !== row.key).map((entry) => ({ key: entry.key, label: `${entry.account} · ${entry.pilot.name}` }))}
                onReview={(policy, officer, division) => void reviewAcquisition(row, policy, officer, division)}
                onAcquire={() => void acquireSkills(row)} onChange={() => update(row.key, { acquisition: null })} />
            {/if}
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
