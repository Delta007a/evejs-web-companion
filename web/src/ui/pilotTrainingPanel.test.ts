import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MinerTrainingRead, StageFittingSelection } from "../training/types.ts";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const PilotTraining = (await import("./PilotTraining.svelte")).default;
const GoblinFactory = (await import("./GoblinFactory.svelte")).default;
const MinerQualification = (await import("./MinerQualification.svelte")).default;

test("old pilot panel is only a discoverable standalone shortcut", () => {
  const html = render(PilotTraining).body;
  assert.match(html, /Goblin Factory/);
  assert.match(html, /href="\/goblin-factory"/);
});

test("stage details render review identity, skill distinctions and only the selected preview", () => {
  const selections: Record<string, StageFittingSelection> = { VENTURE: { scope: "CORPORATION", ownerID: 98000001,
    fittingID: 7, acceptedFingerprint: "old-fingerprint", acceptedSavedDate: "old-date" } };
  const missing = { typeID: 3438, name: "Mining Drone Operation", level: 2, trainedLevel: 1,
    skillPoints: 250, state: "MISSING" as const, queuePosition: -1 };
  const result: MinerTrainingRead = {
    corporationID: 98000001,
    fittings: [{ ownerID: 98000001, fittingID: 7, name: "Accepted Venture", shipTypeID: 32880,
      fingerprint: "new-fingerprint", savedDate: "new-date", items: [], invalid: false, reason: null },
      { ownerID: 98000001, fittingID: 8, name: "Wrong hull", shipTypeID: 17480,
        fingerprint: "other", savedDate: "other-date", items: [], invalid: false, reason: null }],
    report: { role: "MINER", policyVersion: 1, trainingState: "IDLE", pilot: { characterID: 1, name: "Augusta", account: "BMiner7" },
      currentStage: null, nextStage: "VENTURE", currentStageStatus: "UNKNOWN",
      stages: [{ id: "VENTURE", supportPolicyKey: "VENTURE", fitName: "Accepted Venture", hullTypeID: 32880,
        fitting: { status: "REVIEW_REQUIRED", currentFingerprint: "new-fingerprint", currentSavedDate: "new-date" },
        hard: [], support: [missing], skillQualification: "UNKNOWN", equipmentReadiness: "UNKNOWN", equipmentReason: "Not inspected" }],
      previews: {
        FAST: { stage: "VENTURE", targets: [], eta: { kind: "UNKNOWN", reason: "Fit needs review" } },
        BALANCED: { stage: "VENTURE", targets: [], eta: { kind: "UNKNOWN", reason: "Fit needs review" } },
        MASTERY: { stage: "VENTURE", targets: [missing], eta: { kind: "UNKNOWN", reason: "Queue does not cover preview" } },
      },
    },
  };
  const html = render(MinerQualification, { props: { result, selections, mode: "MASTERY", busy: false,
    onSelect() {}, onAccept() {} } }).body;
  for (const text of ["REVIEW_REQUIRED", "old-fingerprint", "new-fingerprint", "old-date", "new-date",
    "Accept current fitting", "Mining Drone Operation", "NEEDS TRAINING", "MASTERY preview", "Equipment: UNKNOWN", "98000001 / 7"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Wrong hull|FAST preview|BALANCED preview/);
});

test("Factory mounts without a store, cockpit, selected pilot or premature empty roster", () => {
  const html = render(GoblinFactory).body;
  assert.match(html, /Goblin Factory/);
  assert.match(html, /Existing account/);
  assert.match(html, /Loading known accounts/);
  assert.doesNotMatch(html, /No available pilots yet/);
  for (const file of ["GoblinFactory.svelte", "MinerQualification.svelte"]) {
    const source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
    assert.doesNotMatch(source, /saveSkillQueue|SaveNewQueue|createSession|AppFlow|PanelHost|botHost|loadSnapshot/);
  }
});
