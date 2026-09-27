import test from "node:test";
import assert from "node:assert/strict";
import { fittingConfigKey, readSelections, saveSelections, readPilotPreferences, savePilotPreferences,
  readFactoryAccounts, rememberFactoryAccount, factoryStatus, requirementCounts } from "./factory.ts";
import type { MinerReport, RequirementRow } from "./types.ts";
import { isGoblinFactoryPath } from "../app/pageRoute.ts";

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
test("existing accepted fitting configuration survives role/mode changes and a fresh read", () => {
  const local = storage();
  const key = "pilot-training:miner:BMiner7:90000001";
  const saved = JSON.stringify({ VENTURE: { scope: "CORPORATION", ownerID: 98000001, fittingID: 7,
    acceptedSavedDate: "134285151537020000", acceptedFingerprint: "accepted-content" } });
  local.setItem(key, saved);
  assert.equal(fittingConfigKey("BMiner7", 90000001), key);
  assert.equal(readPilotPreferences(local, "BMiner7", 90000001).role, "", "account names never assign roles");
  savePilotPreferences(local, "BMiner7", 90000001, { role: "MINER", mode: "MASTERY" });
  assert.equal(local.getItem(key), saved, "preferences never rewrite the accepted stage map");
  assert.deepEqual(readSelections(local, "BMiner7", 90000001), JSON.parse(saved));
  assert.deepEqual(readPilotPreferences(local, "BMiner7", 90000001), { role: "MINER", mode: "MASTERY" });
  assert.deepEqual(readSelections(local, "BMiner7", 90000002), {});
  assert.deepEqual(readSelections(local, "Other", 90000001), {});
  const accepted = readSelections(local, "BMiner7", 90000001);
  saveSelections(local, "BMiner7", 90000001, accepted);
  assert.equal(local.getItem(key), saved);
});
test("malformed stored fitting configuration fails closed and is not overwritten", () => {
  const local = storage();
  const key = fittingConfigKey("A", 1);
  for (const value of ["{", "null", "[]"]) {
    local.setItem(key, value);
    assert.throws(() => readSelections(local, "A", 1));
    assert.equal(local.getItem(key), value);
  }
});
test("remembered accounts are distinct from explicit character roles", () => {
  const local = storage();
  rememberFactoryAccount(local, "BMiner7"); rememberFactoryAccount(local, "BMiner7");
  rememberFactoryAccount(local, "Other");
  assert.deepEqual(readFactoryAccounts(local), ["BMiner7", "Other"]);
  assert.equal(readPilotPreferences(local, "Other", 1).role, "");
});
test("factory filters derive from evidence, with review and unknown taking priority", () => {
  const target = { state: "MISSING" } as RequirementRow;
  const report = { stages: [{ fitting: { status: "READY" } }], trainingState: "IDLE",
    previews: { BALANCED: { targets: [target], eta: { kind: "UNKNOWN" } } } } as unknown as MinerReport;
  assert.equal(factoryStatus(report, "BALANCED"), "NOT_READY");
  assert.equal(factoryStatus({ ...report, trainingState: "TRAINING" }, "BALANCED"), "TRAINING");
  assert.equal(factoryStatus(report, "BALANCED", "read failed"), "UNKNOWN");
  assert.equal(factoryStatus(null, "BALANCED"), "UNKNOWN");
  const changed = { ...report, stages: report.stages.map((stage) => ({ ...stage, fitting: { status: "REVIEW_REQUIRED" as const } })) };
  assert.equal(factoryStatus(changed, "BALANCED"), "NEEDS_REVIEW");
  const missing = { ...report, previews: { ...report.previews, BALANCED: { stage: null, targets: [], eta: { kind: "UNKNOWN", reason: "Fit unavailable" } } } } as MinerReport;
  assert.equal(factoryStatus(missing, "BALANCED"), "UNKNOWN");
  const ready = { ...report, previews: { ...report.previews, BALANCED: { stage: null, targets: [], eta: { kind: "READY", remainingMs: 0 } } } } as MinerReport;
  assert.equal(factoryStatus(ready, "BALANCED"), "READY");
  assert.deepEqual(requirementCounts(["TRAINED", "TRAINING", "QUEUED", "MISSING", "UNKNOWN"].map((state) => ({ state }) as RequirementRow)),
    { TRAINED: 1, TRAINING: 1, QUEUED: 1, MISSING: 1, UNKNOWN: 1 });
});
test("standalone route only matches its own direct path", () => {
  assert.equal(isGoblinFactoryPath("/goblin-factory"), true);
  assert.equal(isGoblinFactoryPath("/goblin-factory/"), true);
  assert.equal(isGoblinFactoryPath("/"), false);
  assert.equal(isGoblinFactoryPath("/goblin-factory-other"), false);
});
