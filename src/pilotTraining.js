"use strict";

// Read-only Miner qualification. Template type IDs identify equipment; every
// skill edge and level comes from the current EveJS typeDogma table.
const REQUIREMENT_ATTRIBUTES = [
  [182, 277], [183, 278], [184, 279],
  [1285, 1286], [1289, 1287], [1290, 1288],
];

const STAGES = Object.freeze([
  { id: "VENTURE", fitName: "Start Venture", hull: 32880, modules: [22542, 578, 444, 439, 483, 483], drones: [[2464, 2], [10246, 2]] },
  { id: "PIONEER", fitName: "Poineer Corp", hull: 89240, modules: [22542, 2046, 444, 439, 578, 483, 483, 483, 31370, 31370, 31752], drones: [[2464, 8], [10246, 8]] },
  { id: "PROCURER", fitName: "Simulated Procurer Fitting", hull: 17480, modules: [22542, 22542, 2046, 444, 3829, 578, 17482, 17482, 31790, 31754], drones: [[10246, 10], [15508, 10]] },
]);

// Versioned, deliberately small policy. These are development targets, never
// substitutes for hull/module/drone prerequisite edges. No drone-count floor.
const SUPPORT_POLICY_VERSION = 1;
const SUPPORT = Object.freeze({
  VENTURE: {
    balanced: { 3327: 2, 3426: 2, 3413: 2, 3418: 2, 3417: 2, 22578: 2, 3438: 2, 24241: 2, 3416: 2, 3449: 2, 3450: 2, 3429: 2 },
    mastery: { 3386: 5, 3438: 5, 3418: 5, 3449: 5, 3419: 5 },
  },
  PIONEER: {
    balanced: { 3327: 3, 3426: 3, 3413: 3, 3418: 3, 3417: 3, 22578: 3, 3438: 3, 24241: 3, 3416: 3, 3419: 3, 3449: 3, 3450: 3, 3429: 3, 3431: 2 },
    mastery: { 3386: 5, 22578: 5, 3438: 5, 3418: 5, 3419: 5, 3449: 5 },
  },
  PROCURER: {
    balanced: { 3327: 4, 3426: 4, 3413: 4, 3418: 4, 3417: 4, 22578: 4, 3410: 4, 3438: 4, 24241: 4, 33699: 3, 3416: 4, 3419: 4, 3425: 4, 3449: 4, 3453: 3, 3429: 4, 3431: 3 },
    mastery: { 3386: 5, 22578: 5, 3410: 5, 3438: 5, 3419: 5, 3449: 5 },
  },
});

function validLevel(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function mergeTargets(...maps) {
  const result = new Map();
  for (const targets of maps) {
    for (const [rawID, rawLevel] of targets) {
      const id = Number(rawID);
      const level = Number(rawLevel);
      if (!Number.isSafeInteger(id) || id <= 0 || !validLevel(level)) {
        throw new Error(`Invalid skill target ${rawID}:${rawLevel}`);
      }
      result.set(id, Math.max(result.get(id) || 0, level));
    }
  }
  return result;
}

function policyTargets(stageID, mode) {
  return new Map(Object.entries(SUPPORT[stageID][mode]).map(([id, level]) => [Number(id), level]));
}

function dogmaEdges(typeID, data) {
  const type = data.getType(typeID);
  const dogma = data.getTypeDogma(typeID);
  if (!type || !dogma || !dogma.attributes || typeof dogma.attributes !== "object") {
    throw new Error(`Static dogma unavailable for type ${typeID}`);
  }
  const attributes = dogma.attributes;
  const edges = [];
  for (const [skillAttribute, levelAttribute] of REQUIREMENT_ATTRIBUTES) {
    const rawID = attributes[String(skillAttribute)];
    if (rawID === undefined || rawID === null || Number(rawID) === 0) continue;
    const skillID = Number(rawID);
    const level = Number(attributes[String(levelAttribute)]);
    if (!Number.isSafeInteger(skillID) || skillID <= 0 || !validLevel(level) || !data.getSkillType(skillID)) {
      throw new Error(`Incomplete skill prerequisite on type ${typeID}`);
    }
    edges.push([skillID, level]);
  }
  return edges;
}

function prerequisiteClosure(typeIDs, data) {
  const result = new Map();
  const visiting = new Set();
  const visited = new Set();
  function visitSkill(skillID, level) {
    result.set(skillID, Math.max(result.get(skillID) || 0, level));
    if (visited.has(skillID)) return;
    if (visiting.has(skillID)) throw new Error(`Cyclic skill prerequisites at ${skillID}`);
    visiting.add(skillID);
    for (const [requiredID, requiredLevel] of dogmaEdges(skillID, data)) {
      visitSkill(requiredID, requiredLevel);
    }
    visiting.delete(skillID);
    visited.add(skillID);
  }
  for (const typeID of typeIDs) {
    for (const [skillID, level] of dogmaEdges(typeID, data)) visitSkill(skillID, level);
  }
  return result;
}

function closeSkillTargets(targets, data) {
  return mergeTargets(targets, prerequisiteClosure([...targets.keys()], data));
}

function readSkillState(sheet) {
  if (!sheet || !Array.isArray(sheet.skills) || !sheet.queue ||
      !Array.isArray(sheet.queue.entries) || typeof sheet.queue.active !== "boolean" ||
      typeof sheet.serverNowMs !== "number" ||
      !Number.isFinite(sheet.serverNowMs) || sheet.serverNowMs <= 0) return null;
  const rows = new Map();
  for (const row of sheet.skills) {
    const id = row && row.typeID;
    const level = row && row.level;
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isInteger(level) || level < 0 || level > 5 ||
        typeof row.skillPoints !== "number" || !Number.isFinite(row.skillPoints) || row.skillPoints < 0 || rows.has(id)) return null;
    rows.set(id, row);
  }
  for (const entry of sheet.queue.entries) {
    if (!Number.isSafeInteger(entry && entry.typeID) || !validLevel(entry && entry.toLevel)) return null;
  }
  return rows;
}

function targetState(typeID, level, sheet, rows) {
  if (!rows) return "UNKNOWN";
  if (Number(rows.get(typeID)?.level || 0) >= level) return "TRAINED";
  const entries = sheet.queue.entries;
  const at = entries.findIndex((entry) => Number(entry.typeID) === typeID && Number(entry.toLevel) >= level);
  if (at < 0) return "MISSING";
  if (at === 0 && sheet.queue.active === true) {
    return Number.isFinite(Number(entries[0].endTimeMs)) && Number(entries[0].endTimeMs) > 0
      ? "TRAINING" : "UNKNOWN";
  }
  return "QUEUED";
}

function requirements(targets, sheet, rows, data) {
  return [...targets].map(([typeID, level]) => {
    const state = targetState(typeID, level, sheet, rows);
    return {
      typeID, name: data.getSkillType(typeID)?.name || `Skill ${typeID}`, level,
      trainedLevel: rows ? Number(rows.get(typeID)?.level || 0) : null,
      skillPoints: rows ? Number(rows.get(typeID)?.skillPoints || 0) : null,
      state,
      queuePosition: state === "TRAINING" || state === "QUEUED"
        ? sheet.queue.entries.findIndex((entry) => Number(entry.typeID) === typeID && Number(entry.toLevel) >= level)
        : -1,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function qualification(rows) {
  if (rows.some((row) => row.state === "UNKNOWN")) return "UNKNOWN";
  return rows.every((row) => row.state === "TRAINED") ? "READY" : "NOT_READY";
}

function etaFor(targets, sheet, rows) {
  if (!rows) return { kind: "UNKNOWN", reason: "Skill sheet or queue could not be read completely." };
  const pending = requirements(targets, sheet, rows, { getSkillType: () => null }).filter((row) => row.state !== "TRAINED");
  if (pending.length === 0) return { kind: "READY", remainingMs: 0 };
  const ends = [];
  for (const target of pending) {
    const entry = sheet.queue.entries.find((item) => Number(item.typeID) === target.typeID && Number(item.toLevel) >= target.level);
    if (!sheet.queue.active || !entry || !Number.isFinite(Number(entry.endTimeMs)) || Number(entry.endTimeMs) <= 0) {
      return { kind: "UNKNOWN", reason: "The server queue does not yet cover this complete preview; arbitrary-plan rates are unavailable." };
    }
    ends.push(Number(entry.endTimeMs));
  }
  const completionMs = Math.max(...ends);
  if (completionMs <= Number(sheet.serverNowMs)) {
    return { kind: "UNKNOWN", reason: "The queue finish time has passed but trained levels are not yet confirmed." };
  }
  return { kind: "SERVER_QUEUE", completionMs, remainingMs: Math.max(0, completionMs - Number(sheet.serverNowMs)) };
}

function buildMinerReport(data, sheet, identity = {}) {
  const rows = readSkillState(sheet);
  const stages = STAGES.map((stage) => {
    const hard = prerequisiteClosure([stage.hull, ...stage.modules, ...stage.drones.map(([typeID]) => typeID)], data);
    if (hard.size === 0) throw new Error(`No hull or fit skill requirements found for ${stage.id}`);
    const support = closeSkillTargets(policyTargets(stage.id, "balanced"), data);
    const hardRows = requirements(hard, sheet, rows, data);
    return {
      id: stage.id, fitName: stage.fitName, hullTypeID: stage.hull, hard: hardRows,
      support: requirements(support, sheet, rows, data),
      skillQualification: qualification(hardRows),
      equipmentReadiness: "UNKNOWN",
      equipmentReason: stage.id === "VENTURE"
        ? "Venture's reported drone inventory is not explained by the inspected static bay and mod rule; live equipment capability is not inspected here."
        : "Equipment and effective drone capability are not inspected by this read-only skill MVP.",
      hardTargets: hard,
    };
  });
  let currentIndex = -1;
  for (let index = 0; index < stages.length; index += 1) {
    if (stages[index].skillQualification !== "READY") break;
    currentIndex = index;
  }
  const next = stages[currentIndex + 1] || null;
  const current = stages[Math.max(currentIndex, 0)];
  const previews = {};
  for (const mode of ["FAST", "BALANCED", "MASTERY"]) {
    if (mode !== "MASTERY" && !next) {
      previews[mode] = { stage: null, targets: [], eta: { kind: "READY", remainingMs: 0 } };
      continue;
    }
    const base = mode === "MASTERY" ? current : next;
    const targets = mode === "FAST"
      ? base.hardTargets
      : mergeTargets(
          base.hardTargets,
          closeSkillTargets(policyTargets(base.id, "balanced"), data),
          ...(mode === "MASTERY" ? [closeSkillTargets(policyTargets(base.id, "mastery"), data)] : []),
        );
    const all = requirements(targets, sheet, rows, data);
    previews[mode] = {
      stage: base.id,
      targets: all.filter((row) => row.state !== "TRAINED"),
      eta: etaFor(targets, sheet, rows),
    };
  }
  return {
    role: "MINER", policyVersion: SUPPORT_POLICY_VERSION,
    pilot: { characterID: identity.characterID || null, name: sheet?.characterName || identity.name || "Unknown", account: identity.account || "" },
    currentStage: currentIndex >= 0 ? stages[currentIndex].id : null,
    currentStageStatus: rows ? (currentIndex >= 0 ? "READY" : stages[0].skillQualification) : "UNKNOWN",
    nextStage: next?.id || null,
    stages: stages.map(({ hardTargets, ...stage }) => stage),
    previews,
  };
}

module.exports = { STAGES, SUPPORT_POLICY_VERSION, mergeTargets, dogmaEdges, prerequisiteClosure, closeSkillTargets, targetState, qualification, etaFor, buildMinerReport };
