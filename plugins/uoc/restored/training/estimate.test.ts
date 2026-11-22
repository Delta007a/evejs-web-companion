import test from "node:test";
import assert from "node:assert/strict";
import { estimateAdditionalTraining, estimateTrainingFunding } from "./estimate.ts";

const skill = { typeID: 1, name: "Example Skill", currentLevel: 1, level: 3, queuedLevel: 2 };
const dogma = { 1: { 275: 1, 180: 165, 181: 166 } };
const attributes = { 165: 24, 166: 20 };
test("training estimate excludes lower queued levels and applies native clone grade", () => {
  const args = [[skill], [{ typeID: 1, skillPoints: 300 }]] as const;
  assert.equal(estimateAdditionalTraining(...args, 1, attributes, dogma).additionalTrainingMs, (8000 - 1415) / 34 * 60_000);
  assert.equal(estimateAdditionalTraining(...args, 0, attributes, dogma).additionalTrainingMs, (8000 - 1415) / 17 * 60_000);
  assert.equal(estimateAdditionalTraining([{ ...skill, queuedLevel: 3 }], [], null, {}, {}).additionalTrainingMs, 0);
  assert.match(estimateAdditionalTraining(...args, 1, { 165: 24 }, dogma).trainingTimeReason!, /166/);
  assert.match(estimateAdditionalTraining(...args, null, attributes, dogma).trainingTimeReason!, /clone grade/);
});
test("funding estimates personal first, exact corporate shortfall, and specific unavailable authority", () => {
  assert.deepEqual(estimateTrainingFunding(71500, 1500, true, { balanceISK: 90000 }),
    { personalISK: 1500, corporateISK: 70000, shortfallISK: 0, reason: null });
  assert.equal(estimateTrainingFunding(71500, 1500, false, { balanceISK: 90000 }).shortfallISK, 70000);
  assert.equal(estimateTrainingFunding(71500, 1500, true, { balanceISK: 100 }).corporateISK, 0);
  assert.equal(estimateTrainingFunding(71500, 1500, true, { reason: "Take denied" }).reason, "Take denied");
});
