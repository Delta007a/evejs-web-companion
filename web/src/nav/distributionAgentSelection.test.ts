import test from "node:test";
import assert from "node:assert/strict";
import type { FoundAgent } from "../app/api.ts";
import { classifyDistributionAgentConversation, selectDistributionAgent } from "./distributionAgentSelection.ts";

function agent(id: number, level: number, over: Partial<FoundAgent> = {}): FoundAgent {
  return {
    agentID: id, name: `Agent ${id}`, level, divisionID: 22, agentTypeID: 2,
    missionKind: "courier", missionTypeLabel: "Distribution", corporationID: 100,
    factionID: 500, stationID: 60000000 + id, stationName: "Station",
    solarSystemID: 30000000 + id, solarSystemName: "System", ...over,
  };
}

function policy(preferredLevel: number, fallback = false) {
  return { preferredLevel, fallback, corporationID: null, maxJumps: null, originSystemID: null, distances: null };
}

test("preferred levels 2 and 3 select usable agents at that exact level", async () => {
  for (const level of [2, 3]) {
    const picked = await selectDistributionAgent(policy(level), async (asked) => [agent(level * 10, asked)], async () => "usable");
    assert.equal(picked.agent?.level, level);
    assert.equal(picked.level, level);
  }
});

test("level 3 fallback descends through 2 and then 1", async () => {
  const asked: number[] = [];
  const picked = await selectDistributionAgent(policy(3, true), async (level) => {
    asked.push(level);
    return [agent(level, level)];
  }, async (id) => id === 1 ? "usable" : "ineligible");
  assert.deepEqual(asked, [3, 2, 1]);
  assert.equal(picked.level, 1);
  assert.match(picked.reason, /Level 3 unavailable/);
});

test("fallback disabled stops clearly and never searches level 1", async () => {
  const asked: number[] = [];
  const picked = await selectDistributionAgent(policy(3), async (level) => {
    asked.push(level);
    return [agent(level, level)];
  }, async () => "ineligible");
  assert.deepEqual(asked, [3]);
  assert.equal(picked.agent, null);
  assert.equal(picked.reason, "No eligible level 3 distribution agent is available.");
});

test("one ineligible agent does not block the next same-level candidate", async () => {
  const probed: number[] = [];
  const distances = new Map([[30000001, 1], [30000002, 2]]);
  const picked = await selectDistributionAgent({ ...policy(3), distances }, async () => [agent(1, 3), agent(2, 3)], async (id) => {
    probed.push(id);
    return id === 1 ? "ineligible" : "usable";
  });
  assert.deepEqual(probed, [1, 2]);
  assert.equal(picked.agent?.agentID, 2);
});

test("non-distribution and wrong-level agents are never probed", async () => {
  const probed: number[] = [];
  const picked = await selectDistributionAgent(policy(3), async () => [
    agent(1, 3, { divisionID: 24 }), agent(2, 2), agent(3, 3),
  ], async (id) => { probed.push(id); return "usable"; });
  assert.deepEqual(probed, [3]);
  assert.equal(picked.agent?.agentID, 3);
});

test("EveJS conversation is the authoritative eligibility verdict", () => {
  const base = { contentID: null, lastActionInfo: { missionCompleted: null, missionDeclined: null, missionQuit: null, loyaltyPoints: null } };
  assert.equal(classifyDistributionAgentConversation({ ...base, agentSays: "Your current standings are not high enough for this agent to issue you a mission yet.", actions: [] }), "ineligible");
  assert.equal(classifyDistributionAgentConversation({ ...base, agentSays: "Hello", actions: [{ actionID: 1, buttonType: 2, label: "Request Mission" }] }), "usable");
});
