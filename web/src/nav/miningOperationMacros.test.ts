import test from "node:test";
import assert from "node:assert/strict";

import type { MacroStep } from "../bots/botScript.ts";
import type { FlightStatus, MiningHold, SpaceEntity, SpaceSnapshot } from "../store/types.ts";
import type { MiningOperationAssignment, MiningOperationTarget, ScriptObservation } from "./scriptConditions.ts";
import { SCRIPT_MACROS } from "./scriptMacros.ts";

const beltStep: MacroStep = {
  id: "mine",
  kind: "macro",
  macro: "mine-at-belt",
  args: { belt: { kind: "belt", belt: { mode: "nearest" } } },
};
const siteWarpStep: MacroStep = { id: "warp", kind: "macro", macro: "warp-to-ore-anomaly", args: {} };
const travelStep: MacroStep = { id: "travel", kind: "macro", macro: "travel-to-belt", args: {} };
const lootStep: MacroStep = { id: "loot", kind: "macro", macro: "loot-containers", args: {} };
const deliverStep: MacroStep = {
  id: "deliver",
  kind: "macro",
  macro: "deliver-ore",
  args: { station: { kind: "station", ref: { entity: "station", id: 60000004, name: "Home", systemName: null } } },
};

function flight(over: Partial<FlightStatus> = {}): FlightStatus {
  return { inSpace: true, docked: false, solarSystemID: 30000142, stationID: null, structureID: null, shipID: 9, shipTypeID: null, shipIsCapsule: null, shipMode: null, shipSpeedFraction: null, ...over };
}

function entity(itemID: number, name: string, x = 0): SpaceEntity {
  return {
    itemID, kind: "celestial", typeID: 1, groupID: 1, categoryID: 2, name, ownerID: null,
    radius: 10, position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, isSelf: false,
    shieldRatio: null, armorRatio: null, hullRatio: null, characterID: null, corporationID: null,
    allianceID: null, securityStatus: null, maxVelocity: null, mode: null, capacitorRatio: null,
    remainingQuantity: null, miningYieldTypeID: null, beltID: null, oreGrade: null,
    oreValuePerM3: null, isNpc: false, npcEntityType: null, controllerID: null,
    droneActivity: null, targetEntityID: null,
  };
}

function snapshot(entities: readonly SpaceEntity[]): SpaceSnapshot {
  return {
    inSpace: true, solarSystemID: 30000142, shipID: 9, sampledAtMs: 1, entities,
    ship: {
      itemID: 9, typeID: 1, name: "Miner", mode: null, maxVelocity: 100, radius: 100,
      position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      shieldRatio: 1, armorRatio: 1, hullRatio: 1, capacitorRatio: 1,
      shieldCapacity: null, armorCapacity: null, hullCapacity: null, activeModuleIDs: [],
    } as unknown as NonNullable<SpaceSnapshot["ship"]>,
  };
}

function target(over: Partial<MiningOperationTarget> = {}): MiningOperationTarget {
  return {
    targetKey: "BELT:30000142:Asteroid Belt 1", targetType: "BELT", systemID: 30000142,
    systemName: "Jita", targetName: "Asteroid Belt 1", state: "ACTIVE", claimedByOperationID: "op",
    ...over,
  };
}

function assignment(over: Partial<MiningOperationAssignment> = {}): MiningOperationAssignment {
  return {
    operationID: "op", operationName: "Op", role: "MINER", unloadPolicy: "HAULER_SERVICE",
    area: { anchorSystemID: 30000142, anchorSystemName: "Jita", reach: "CURRENT_SYSTEM", targetClasses: ["BELT"] },
    state: "MINING", currentTarget: target(), logisticsTarget: null, rendezvous: null, ...over,
  };
}

function observation(over: Partial<ScriptObservation> = {}): ScriptObservation {
  return {
    inSpace: true, docked: false, inWarp: false, flightStatus: flight(), snapshot: snapshot([]),
    shieldRatio: 1, armorRatio: 1, hullRatio: 1, health: 1, oreHoldFraction: 0,
    holdEmpty: true, hostileOnGrid: false, dronesOut: false, lockedTargetIDs: [], holds: [],
    droneBayItemIDs: [], miningModuleIDs: [], startingStationID: null, systemName: "Jita",
    miningOperation: assignment(), ...over,
  };
}

function oreHold(itemIDs: readonly number[]): MiningHold[] {
  return [{
    key: "ore", label: "Ore Hold", present: true, error: null, capacity: null,
    items: itemIDs.map((itemID) => ({ itemID, typeID: 1230, groupID: 462, categoryID: 25, quantity: 100 })),
  }];
}

test("operation miner reserves one deterministic eligible belt when no target exists", () => {
  const mine = SCRIPT_MACROS["mine-at-belt"];
  const world = observation({
    miningOperation: assignment({ currentTarget: null }),
    snapshot: snapshot([entity(2, "Asteroid Belt 2"), entity(1, "Asteroid Belt 1")]),
  });
  const tick = mine(beltStep, world, {}, {});
  assert.equal(tick.action.kind, "reserveMiningTarget");
  assert.ok(tick.action.kind === "reserveMiningTarget" && tick.action.targetName === "Asteroid Belt 1");
});

test("HAULER_SERVICE depletion forces a below-threshold partial dump before relocation", () => {
  const mine = SCRIPT_MACROS["mine-at-belt"];
  const world = observation({ snapshot: snapshot([entity(1, "Asteroid Belt 1")]), holds: oreHold([81, 82]) });
  let memory = {};
  let tick = mine(beltStep, world, memory, {});
  memory = tick.nextMem;
  tick = mine(beltStep, world, memory, {});
  memory = tick.nextMem;
  tick = mine(beltStep, world, memory, {});
  assert.equal(tick.action.kind, "jettison");
  assert.deepEqual(tick.action.kind === "jettison" ? tick.action.itemIDs : [], [81, 82]);
});

test("SELF_UNLOAD depletion never jettisons and hands off to the saved delivery path", () => {
  const mine = SCRIPT_MACROS["mine-at-belt"];
  const self = assignment({ unloadPolicy: "SELF_UNLOAD" });
  const world = observation({ miningOperation: self, snapshot: snapshot([entity(1, "Asteroid Belt 1")]), holds: oreHold([81]) });
  let memory = {};
  let tick = mine(beltStep, world, memory, {});
  memory = tick.nextMem;
  tick = mine(beltStep, world, memory, {});
  memory = tick.nextMem;
  tick = mine(beltStep, world, memory, {});
  assert.equal(tick.action.kind, "depleteMiningTarget");
  assert.notEqual(tick.action.kind, "jettison");
});

test("SELF_UNLOAD delivery reports rendezvous readiness only after the hold is empty", () => {
  const deliver = SCRIPT_MACROS["deliver-ore"];
  const self = assignment({
    unloadPolicy: "SELF_UNLOAD",
    currentTarget: target({ state: "DEPLETED", claimedByOperationID: null }),
    rendezvous: { kind: "SELF_UNLOAD", required: [1, 2], ready: [], thisMemberReady: false },
  });
  const docked = observation({
    inSpace: false, docked: true, flightStatus: flight({ inSpace: false, docked: true, stationID: 60000004 }),
    miningOperation: self, holds: [],
  });
  assert.equal(deliver(deliverStep, docked, {}, {}).action.kind, "miningMemberReady");
  assert.equal(deliver(deliverStep, { ...docked, holds: oreHold([9]) }, {}, {}).action.kind, "unloadOre");
});

test("operation hauler services the logistics tail before the new current target", () => {
  const travel = SCRIPT_MACROS["travel-to-belt"];
  const old = target({ targetKey: "BELT:30000142:Old Belt", targetName: "Old Belt", state: "DRAINING" });
  const current = target({ targetKey: "BELT:30000142:New Belt", targetName: "New Belt", state: "ACTIVE" });
  const hauler = assignment({ role: "HAULER", currentTarget: current, logisticsTarget: old });
  const tick = travel(travelStep, observation({
    miningOperation: hauler,
    snapshot: snapshot([entity(1, "Old Belt", 500_000), entity(2, "New Belt", 300_000)]),
  }), {}, {});
  assert.ok(tick.action.kind === "warp" && tick.action.targetID === 1);
});

test("hauler completes its drain only after the old grid and freight are both empty", () => {
  const loot = SCRIPT_MACROS["loot-containers"];
  const deliver = SCRIPT_MACROS["deliver-ore"];
  const hauler = assignment({ role: "HAULER", logisticsTarget: target({ state: "DRAINING" }) });
  const clearGrid = loot(lootStep, observation({ miningOperation: hauler }), { emptyChecks: 30 }, {});
  assert.equal(clearGrid.outcome.kind, "done");
  assert.equal(clearGrid.boardPatch?.miningDrainGridClear, hauler.logisticsTarget?.targetKey);
  const docked = observation({
    inSpace: false, docked: true, flightStatus: flight({ inSpace: false, docked: true, stationID: 60000004 }),
    miningOperation: hauler, holds: [],
  });
  assert.equal(deliver(deliverStep, docked, {}, clearGrid.boardPatch ?? {}).action.kind, "miningDrainComplete");
});

test("a full hauler unload does not close its logistics tail before grid-clear proof", () => {
  const deliver = SCRIPT_MACROS["deliver-ore"];
  const hauler = assignment({ role: "HAULER", logisticsTarget: target({ state: "DRAINING" }) });
  const docked = observation({
    inSpace: false, docked: true, flightStatus: flight({ inSpace: false, docked: true, stationID: 60000004 }),
    miningOperation: hauler, holds: [],
  });
  assert.notEqual(deliver(deliverStep, docked, {}, {}).action.kind, "miningDrainComplete");
});

test("operation ore-site selection excludes ice archetype and never invents remote scanner rows", () => {
  const warp = SCRIPT_MACROS["warp-to-ore-anomaly"];
  const op = assignment({
    unloadPolicy: "SELF_UNLOAD", currentTarget: null,
    area: { anchorSystemID: 30000142, anchorSystemName: "Jita", reach: "CURRENT_AND_ADJACENT", targetClasses: ["ORE_ANOMALY", "ICE"] },
  });
  const tick = warp(siteWarpStep, observation({
    miningOperation: op,
    anomalies: [
      { label: "ICE-100", kind: "ore", archetypeID: 28 },
      { label: "ORE-200", kind: "ore", archetypeID: 27 },
    ],
  }), {}, {});
  assert.ok(tick.action.kind === "reserveMiningTarget" && tick.action.targetName === "ORE-200");
  assert.equal(tick.action.kind === "reserveMiningTarget" ? tick.action.systemID : 0, 30000142);
});
