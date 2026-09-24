import test from "node:test";
import assert from "node:assert/strict";
import { decideMiningDroneFlight, freshDroneMemory, miningDroneTopUp, recallFlightBeforeManualStop, MANUAL_STOP_RECALL_OBSERVATIONS, type MiningDroneState } from "./miningDroneFlight.ts";
import type { DroneInSpace } from "../store/types.ts";

const drone = (itemID: number, typeID = 101, targetID: number | null = null, activity = "idle"): DroneInSpace => ({
  itemID, typeID, targetID, activity, controlled: true, name: null,
  shieldRatio: 1, armorRatio: 1, hullRatio: 1,
});
const state = (out: readonly DroneInSpace[] = [], maxActive: number | null = 5): MiningDroneState => ({
  bay: [{ itemID: 1, typeID: 101, quantity: 5 }, { itemID: 2, typeID: 100, quantity: 5 }],
  out, maxActive, roles: { 101: "mining", 100: "combat", 1159: "salvage" },
});
function driver() {
  let memory = freshDroneMemory();
  return (s: MiningDroneState | null, hostile: number | null = null, rock: number | null = 90, leaving = false) => {
    const result = decideMiningDroneFlight(s, memory, hostile, rock, leaving);
    memory = result.memory;
    return result;
  };
}

test("normal flight launches the mining stack then mines the selected asteroid", () => {
  const tick = driver();
  assert.deepEqual(tick(state()).action, { kind: "launch", drones: [{ itemID: 1, quantity: 5 }] });
  const out = [11, 12, 13, 14, 15].map(id => drone(id));
  assert.deepEqual(tick(state(out)).action, { kind: "mineDrones", droneIDs: out.map(d => d.itemID), targetID: 90 });
});
test("a correctly mining flight causes neither launch nor order spam", () => {
  const tick = driver();
  for (let i = 0; i < 12; i++) assert.equal(tick(state([drone(11, 101, 90, "mining")], 1)).action, null);
});
test("one active miner plus three in bay tops up only three", () => {
  const s = state([drone(11)]);
  assert.deepEqual(driver()({ ...s, bay: [{ itemID: 1, typeID: 101, quantity: 3 }] }).action,
    { kind: "launch", drones: [{ itemID: 1, quantity: 3 }] });
});
test("multiple stacks fill only missing slots under the actual limit", () => {
  const s = state([drone(11)], 3);
  assert.deepEqual(driver()({ ...s, bay: [{ itemID: 1, typeID: 101, quantity: 1 }, { itemID: 3, typeID: 101, quantity: 8 }] }).action,
    { kind: "launch", drones: [{ itemID: 1, quantity: 1 }, { itemID: 3, quantity: 1 }] });
});
test("MINING -> confirmed return -> COMBAT -> clear grid -> confirmed return -> MINING", () => {
  const tick = driver();
  const mining = [drone(11, 101, 90, "mining")];
  assert.equal(tick(state(mining, 1), 80).action?.kind, "recallDrones");
  for (let i = 0; i < 10; i++) assert.equal(tick(state(mining, 1), 80).action?.kind, "wait");
  assert.deepEqual(tick(state([], 1), 80).action, { kind: "launch", drones: [{ itemID: 2, quantity: 1 }] });
  assert.deepEqual(tick(state([drone(21, 100)], 1), 80).action, { kind: "engageDrones", droneIDs: [21], targetID: 80 });
  const combat = [drone(21, 100, 80, "fighting")];
  assert.equal(tick(state(combat, 1)).action, null);
  assert.equal(tick(state(combat, 1)).action, null);
  assert.equal(tick(state(combat, 1)).action?.kind, "recallDrones");
  assert.equal(tick(state(combat, 1)).action?.kind, "wait");
  assert.deepEqual(tick(state([], 1)).action, { kind: "launch", drones: [{ itemID: 1, quantity: 1 }] });
  assert.equal(tick(state([drone(31)], 1)).action?.kind, "mineDrones");
});
test("a drone failing to return never unlocks the other flight or travel", () => {
  const tick = driver();
  const s = state([drone(11)]);
  const actions = Array.from({ length: 91 }, () => tick(s, 80).action);
  assert.ok(actions.every(a => a?.kind !== "launch" && a?.kind !== "mineDrones"));
  assert.equal(actions.at(-1)?.kind, "pause");
});
test("one clear tick does not oscillate combat back to mining", () => {
  const tick = driver();
  const s = state([drone(21, 100, 80, "fighting")], 1);
  tick(s, 80);
  for (let i = 0; i < 10; i++) { assert.equal(tick(s).action, null); assert.equal(tick(s, 80).action, null); }
});
test("a disappearing threat during recall cannot cancel the pending return", () => {
  const tick = driver();
  const s = state([drone(11)]);
  tick(s, 80);
  for (let i = 0; i < 5; i++) assert.equal(tick(s).action?.kind, "wait");
});
test("losses top up combat capacity without launching miners", () => {
  assert.deepEqual(driver()(state([drone(21, 100)], 2), 80).action,
    { kind: "launch", drones: [{ itemID: 2, quantity: 1 }] });
});
test("depleted asteroid is not ordered; a new selected asteroid retasks drones", () => {
  const tick = driver();
  const s = state([drone(11, 101, 90, "mining")], 1);
  assert.equal(tick(s, null, null).action, null);
  assert.deepEqual(tick(s, null, 91).action, { kind: "mineDrones", droneIDs: [11], targetID: 91 });
});
test("travel recalls every controlled role and waits for disappearance", () => {
  const tick = driver();
  const s = state([drone(11), drone(21, 100), drone(31, 1159)]);
  assert.deepEqual(tick(s, null, null, true).action, { kind: "recallDrones", droneIDs: [11, 21, 31] });
  assert.equal(tick(s, null, null, true).action?.kind, "wait");
  assert.equal(tick(state([]), null, null, true).action, null);
});
test("unknown control state blocks travel and never launches", () => {
  const tick = driver();
  assert.equal(tick(null, 80).action?.kind, "wait");
  assert.equal(tick({ ...state(), out: null }, null, null, true).action?.kind, "wait");
  for (const limit of [null, NaN, Infinity, -1, 1.5, 0]) assert.equal(tick(state([], limit)).action, null);
});
test("invalid quantities and duplicate stacks cannot create phantom drones", () => {
  const bay = [0, -1, NaN, Infinity, 1.5].map((quantity, itemID) => ({ itemID: itemID + 1, typeID: 101, quantity }));
  assert.deepEqual(miningDroneTopUp(bay, 5), []);
  assert.deepEqual(miningDroneTopUp([{ itemID: 6, typeID: 101, quantity: 2 }, { itemID: 6, typeID: 101, quantity: 2 }], 5), [{ itemID: 6, quantity: 2 }]);
});
test("unresolved and other roles are never launched as mining or combat", () => {
  const s = { ...state(), roles: {} };
  assert.equal(driver()(s).action, null);
  assert.equal(driver()(s, 80).action, null);
});
test("uncontrolled abandoned drones do not occupy active slots", () => {
  const s = state([{ ...drone(11), controlled: false }], 1);
  assert.equal(driver()(s, 80).action?.kind, "launch");
});
test("silent failed launches are bounded and defense requests retreat", () => {
  const tick = driver();
  const results = Array.from({ length: 20 }, () => tick(state(), 80));
  assert.equal(results.filter(r => r.action?.kind === "launch").length, 3);
  assert.ok(results.some(r => r.failedDefense));
});
test("failed mining top-up still lets existing drones harvest", () => {
  const tick = driver();
  const results = Array.from({ length: 20 }, () => tick(state([drone(11)])));
  assert.equal(results.filter(r => r.action?.kind === "launch").length, 3);
  assert.ok(results.some(r => r.action?.kind === "mineDrones"));
});
test("mining command refusal does not reissue every tick or indefinitely", () => {
  const tick = driver();
  const results = Array.from({ length: 25 }, () => tick(state([drone(11)], 1)));
  assert.equal(results.filter(r => r.action?.kind === "mineDrones").length, 3);
});

for (const [role, typeID] of [["mining", 101], ["combat", 100]] as const) {
  test(`manual Stop holds ${role} authority until the drone actually returns`, async () => {
    let out = [drone(81, typeID)];
    let unblock!: () => void;
    let recalled!: () => void;
    const sleep = new Promise<void>(resolve => { unblock = resolve; });
    const recallIssued = new Promise<void>(resolve => { recalled = resolve; });
    const calls: number[][] = [];
    let stopped = false;
    const pending = recallFlightBeforeManualStop({
      read: async () => state(out, 1),
      recall: async ids => { calls.push([...ids]); recalled(); },
      sleep: async () => sleep,
    }).then(() => { stopped = true; });
    await recallIssued;
    assert.deepEqual(calls, [[81]]);
    assert.equal(stopped, false, "an issued recall is not a confirmed return");
    out = [];
    unblock();
    await pending;
    assert.equal(stopped, true);
  });
}

test("manual Stop with no drones returns on its first read", async () => {
  let reads = 0;
  await recallFlightBeforeManualStop({
    read: async () => { reads++; return state([], 1); },
    recall: async () => { assert.fail("nothing should be recalled"); },
    sleep: async () => { assert.fail("an empty flight must not wait"); },
  });
  assert.equal(reads, 1);
});

test("manual Stop does not call an already returning drone again", async () => {
  let out = [drone(81, 101, null, "returning")];
  let recalls = 0;
  await recallFlightBeforeManualStop({
    read: async () => state(out, 1),
    recall: async () => { recalls++; },
    sleep: async () => { out = []; },
  });
  assert.equal(recalls, 0);
});

test("manual Stop fails closed after bounded unreadable drone observations", async () => {
  let reads = 0;
  await assert.rejects(recallFlightBeforeManualStop({
    read: async () => { reads++; return null; },
    recall: async () => { assert.fail("unknown state cannot authorize recall"); },
    sleep: async () => {},
  }), /could not be confirmed|not been confirmed/);
  assert.equal(reads, MANUAL_STOP_RECALL_OBSERVATIONS);
});


test("unknown reads interrupt the consecutive clear-grid confirmation", () => {
  const tick = driver();
  const s = state([drone(21, 100, 80, "fighting")], 1);
  tick(s, 80); tick(s); tick(s); tick(null);
  assert.equal(tick(s).memory.combat, true);
  assert.equal(tick(s).memory.combat, true);
  assert.equal(tick(s).action?.kind, "recallDrones");
});
test("a refused combat top-up still engages surviving combat drones", () => {
  const tick = driver();
  const results = Array.from({ length: 20 }, () => tick(state([drone(21, 100)]), 80));
  assert.ok(results.some(r => r.action?.kind === "engageDrones"));
  assert.ok(results.every(r => !r.failedDefense));
});
