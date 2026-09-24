"use strict";

const EXECUTABLE_TARGET_CLASSES = Object.freeze(["BELT", "ORE_ANOMALY"]);
const DEFERRED_TARGET_CLASSES = Object.freeze(["ICE", "GAS"]);

function stamp(now) {
  return new Date(now()).toISOString();
}

function auditMiningScript(doc) {
  const macros = [];
  function visit(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "macro") macros.push(node);
      if (node.kind === "loop") visit(node.body);
      if (node.kind === "branch") {
        visit(node.then);
        visit(node.else);
      }
    }
  }
  visit(doc?.program);
  const names = new Set(macros.map((row) => row.macro));
  const mineSteps = macros.filter((row) => row.macro === "mine-at-belt");
  const hasOrePreference = mineSteps.some((row) => {
    const arg = row.args?.ores;
    return arg && arg.kind === "oreList" && Array.isArray(arg.ores) && arg.ores.length > 0;
  });
  const belt = mineSteps.some((row) => row.args?.belt?.belt?.mode !== "site");
  const oreAnomaly = names.has("warp-to-ore-anomaly") && mineSteps.some((row) => row.args?.belt?.belt?.mode === "site");
  return {
    targetClasses: [belt ? "BELT" : null, oreAnomaly ? "ORE_ANOMALY" : null].filter(Boolean),
    hasOrePreference,
    miner: mineSteps.length > 0,
    hauler: names.has("travel-to-belt") && names.has("loot-containers") && names.has("deliver-ore"),
    normalJettison: names.has("jettison-ore"),
    selfUnload: names.has("deliver-ore"),
    macros: [...names],
  };
}

function createMiningOperations(options) {
  const store = options.store;
  const targetBoard = options.targetBoard;
  const beltMemory = options.beltMemory;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const runtimes = new Map();

  function definition(operationID) {
    return store.get(operationID);
  }

  function freshRuntime(def) {
    return {
      operationID: def.operationID,
      state: "DRAFT",
      currentTarget: null,
      executionTargetClasses: [],
      members: new Map(def.members.map((member) => [member.characterID, {
        characterID: member.characterID,
        role: member.role,
        botID: null,
        runtimeState: "DRAFT",
        phase: null,
        reason: null,
      }])),
      drainingTargets: [],
      rendezvous: null,
      history: [],
      createdAt: stamp(now),
      startedAt: null,
      stoppedAt: null,
      stopFailures: [],
    };
  }

  function runtimeFor(operationID) {
    const def = definition(operationID);
    if (!def) return null;
    let runtime = runtimes.get(def.operationID);
    if (!runtime) {
      runtime = freshRuntime(def);
      runtimes.set(def.operationID, runtime);
    }
    // Definitions can be edited while stopped. Rebuild missing member rows but
    // never pretend a removed active member disappeared from botHost.
    for (const member of def.members) {
      if (!runtime.members.has(member.characterID)) {
        runtime.members.set(member.characterID, {
          characterID: member.characterID,
          role: member.role,
          botID: null,
          runtimeState: "DRAFT",
          phase: null,
          reason: null,
        });
      }
    }
    return runtime;
  }

  function history(runtime, kind, target = null, evidence = null) {
    runtime.history.push({ kind, at: stamp(now), target, evidence });
    if (runtime.history.length > 100) runtime.history.splice(0, runtime.history.length - 100);
  }

  function begin(operationID, executionTargetClasses) {
    const def = definition(operationID);
    if (!def) return { ok: false, code: "MINING_OPERATION_NOT_FOUND", message: "That Mining Operation no longer exists." };
    const runtime = runtimeFor(operationID);
    if (!["DRAFT", "STOPPED"].includes(runtime.state)) {
      return { ok: false, code: "MINING_OPERATION_ACTIVE", message: "That Mining Operation is already active." };
    }
    runtime.state = "ASSEMBLING";
    runtime.currentTarget = null;
    runtime.executionTargetClasses = [...new Set(executionTargetClasses)];
    runtime.drainingTargets = [];
    runtime.rendezvous = null;
    runtime.startedAt = stamp(now);
    runtime.stoppedAt = null;
    runtime.stopFailures = [];
    for (const member of def.members) {
      runtime.members.set(member.characterID, {
        characterID: member.characterID,
        role: member.role,
        botID: null,
        runtimeState: "STARTING",
        phase: "Starting saved automation",
        reason: null,
      });
    }
    return { ok: true, runtime };
  }

  function memberStarted(operationID, characterID, botID) {
    const runtime = runtimeFor(operationID);
    const member = runtime?.members.get(Number(characterID));
    if (!member) return false;
    member.botID = botID;
    member.runtimeState = "RUNNING";
    member.phase = "Waiting for operation target";
    member.reason = null;
    return true;
  }

  function releaseRendezvousIfReady(runtime) {
    const barrier = runtime.rendezvous;
    if (!barrier) return false;
    const pending = barrier.required.filter((id) => !barrier.ready.includes(id));
    if (pending.length > 0) return false;
    for (const characterID of barrier.required) {
      const member = runtime.members.get(characterID);
      if (member?.runtimeState === "READY_FOR_RENDEZVOUS") {
        member.runtimeState = "RUNNING";
        member.phase = "Relocating with main body";
      }
    }
    runtime.rendezvous = null;
    runtime.currentTarget = null;
    if (runtime.state !== "DEGRADED") runtime.state = "RELOCATING";
    history(runtime, "RENDEZVOUS_RELEASED", barrier.target, null);
    return true;
  }

  function memberFailed(operationID, characterID, reason) {
    const runtime = runtimeFor(operationID);
    const member = runtime?.members.get(Number(characterID));
    if (!member) return false;
    member.runtimeState = "FAILED";
    member.phase = "Unavailable";
    member.reason = String(reason || "This member could not start.");
    runtime.state = "DEGRADED";
    if (runtime.rendezvous) {
      runtime.rendezvous.required = runtime.rendezvous.required.filter((id) => id !== Number(characterID));
      releaseRendezvousIfReady(runtime);
    }
    return true;
  }

  function finishLaunch(operationID) {
    const runtime = runtimeFor(operationID);
    if (!runtime) return null;
    const failed = [...runtime.members.values()].some((member) => member.runtimeState === "FAILED");
    const runningMiners = [...runtime.members.values()].some(
      (member) => member.role === "MINER" && member.runtimeState === "RUNNING",
    );
    runtime.state = failed ? "DEGRADED" : runningMiners ? "TRAVELING" : "DEGRADED";
    return runtime;
  }

  function reserveCandidate(operationID, characterID, candidate) {
    const def = definition(operationID);
    const runtime = runtimeFor(operationID);
    const member = runtime?.members.get(Number(characterID));
    if (!def || !runtime || !member || member.role !== "MINER") {
      return { acquired: false, reason: "NOT_OPERATION_MINER", target: null };
    }
    if (runtime.currentTarget !== null) {
      return { acquired: true, reason: null, target: runtime.currentTarget };
    }
    const type = String(candidate?.targetType || "").toUpperCase();
    const systemID = Number(candidate?.systemID);
    if (!runtime.executionTargetClasses.includes(type) || !def.area.targetClasses.includes(type)) {
      return { acquired: false, reason: "TARGET_CLASS_NOT_EXECUTABLE", target: null };
    }
    // v0.1's discovery authority is current-system only. CURRENT_AND_ADJACENT is
    // represented, but candidates from an unscanned neighbour are never accepted.
    if (systemID !== def.area.anchorSystemID) {
      return { acquired: false, reason: "OUTSIDE_EXECUTABLE_AREA", target: null };
    }
    if (type === "BELT") {
      const dry = beltMemory.dryBelts(String(candidate.systemName || ""));
      if (dry.some((row) => row.beltName === candidate.targetName && row.all)) {
        return { acquired: false, reason: "DEPLETED", target: null };
      }
      // Belt memory owns the respawn/reset clock. Once its TTL has forgotten a
      // belt, remove only the target-board projection of that same evidence so
      // a permanent second depletion truth cannot outlive the authority.
      const key = `BELT:${systemID}:${String(candidate.targetName || "").trim()}`;
      const projected = targetBoard.get(key);
      if (projected?.state === "DEPLETED" && projected.depletionEvidence?.source === "belt-memory") {
        targetBoard.clearDepleted(key);
      }
    } else if (type === "ORE_ANOMALY") {
      // A scanner label that was confirmed absent and is visible again is
      // current authoritative evidence of a new site identity. Only that
      // disappearance proof resets; an empty rock grid may linger in the
      // scanner and must not be made claimable again merely because it lists.
      const key = `ORE_ANOMALY:${systemID}:${String(candidate.targetName || "").trim()}`;
      const projected = targetBoard.get(key);
      if (projected?.state === "DEPLETED" && projected.depletionEvidence?.scannerDisappeared === true) {
        targetBoard.clearDepleted(key);
      }
    }
    const result = targetBoard.reserve(operationID, candidate);
    if (result.acquired) {
      runtime.currentTarget = result.target;
      if (runtime.state !== "DEGRADED") runtime.state = "TRAVELING";
      history(runtime, "TARGET_RESERVED", result.target, null);
    }
    return result;
  }

  function activateTarget(operationID, characterID, key) {
    const runtime = runtimeFor(operationID);
    const member = runtime?.members.get(Number(characterID));
    if (!runtime || !member || member.role !== "MINER" || runtime.currentTarget?.targetKey !== key) return false;
    if (!targetBoard.activate(operationID, key)) return false;
    runtime.currentTarget = targetBoard.get(key);
    if (runtime.state !== "DEGRADED") runtime.state = "MINING";
    member.phase = "Mining operation target";
    history(runtime, "TARGET_ACTIVE", runtime.currentTarget, null);
    return true;
  }

  function depleteTarget(operationID, characterID, key, evidence = {}) {
    const def = definition(operationID);
    const runtime = runtimeFor(operationID);
    const member = runtime?.members.get(Number(characterID));
    const target = runtime?.currentTarget;
    if (!def || !runtime || !member || member.role !== "MINER" || target?.targetKey !== key) return false;
    // More than one miner will observe the same empty grid. The first report
    // establishes the fleet-wide clearance barrier; later reports are the
    // individual confirmations that each miner has disposed of its remainder.
    if (runtime.rendezvous?.target?.targetKey === key) {
      if (!runtime.rendezvous.ready.includes(Number(characterID))) {
        runtime.rendezvous.ready.push(Number(characterID));
      }
      member.runtimeState = "READY_FOR_RENDEZVOUS";
      member.phase = "Clear of depleted target";
      releaseRendezvousIfReady(runtime);
      return true;
    }
    const proof = {
      source: target.targetType === "BELT" ? "belt-memory" : "scanner/grid",
      reportedByCharacterID: Number(characterID),
      ...evidence,
    };
    if (target.targetType === "BELT" && target.systemName) {
      beltMemory.markDry(target.systemName, target.targetName, null);
    }
    const activeHaulers = def.unloadPolicy === "HAULER_SERVICE"
      ? [...runtime.members.values()]
        .filter((row) => row.role === "HAULER" && row.runtimeState === "RUNNING")
        .map((row) => row.characterID)
      : [];
    const draining = activeHaulers.length > 0;
    if (!targetBoard.markDepleted(operationID, key, proof, draining)) {
      runtime.currentTarget = null;
      runtime.rendezvous = null;
      runtime.state = "DEGRADED";
      history(runtime, "TARGET_CLAIM_LOST", null, { targetKey: key });
      return false;
    }
    history(runtime, "TARGET_DEPLETED", target, proof);
    const required = [...runtime.members.values()]
      .filter((row) => row.role === "MINER" && row.runtimeState === "RUNNING")
      .map((row) => row.characterID);
    if (def.unloadPolicy === "HAULER_SERVICE") {
      if (draining) {
        runtime.drainingTargets.push({ target: targetBoard.get(key), pendingHaulers: activeHaulers });
      }
      runtime.currentTarget = targetBoard.get(key);
      runtime.rendezvous = {
        kind: "MINER_CLEARANCE",
        target: runtime.currentTarget,
        required,
        // The reporting miner has already confirmed the forced partial dump.
        ready: [Number(characterID)],
      };
      member.runtimeState = "READY_FOR_RENDEZVOUS";
      member.phase = "Clear of depleted target";
      if (runtime.state !== "DEGRADED") runtime.state = draining ? "DRAINING" : "RELOCATING";
      releaseRendezvousIfReady(runtime);
    } else {
      runtime.currentTarget = targetBoard.get(key);
      runtime.rendezvous = { kind: "SELF_UNLOAD", target: runtime.currentTarget, required, ready: [] };
      if (runtime.state !== "DEGRADED") runtime.state = "UNLOADING";
    }
    return true;
  }

  function markReady(operationID, characterID) {
    const runtime = runtimeFor(operationID);
    const id = Number(characterID);
    const member = runtime?.members.get(id);
    if (!runtime?.rendezvous || !member || member.role !== "MINER") return false;
    if (!runtime.rendezvous.ready.includes(id)) runtime.rendezvous.ready.push(id);
    member.runtimeState = "READY_FOR_RENDEZVOUS";
    member.phase = "Ready for rendezvous";
    releaseRendezvousIfReady(runtime);
    return true;
  }

  function finishDrain(operationID, characterID, targetKey) {
    const runtime = runtimeFor(operationID);
    const id = Number(characterID);
    const member = runtime?.members.get(id);
    if (!runtime || !member || member.role !== "HAULER") return false;
    let changed = false;
    for (const drain of runtime.drainingTargets) {
      if (drain.target.targetKey !== String(targetKey || "")) continue;
      const before = drain.pendingHaulers.length;
      drain.pendingHaulers = drain.pendingHaulers.filter((pilot) => pilot !== id);
      if (before !== drain.pendingHaulers.length) changed = true;
      if (drain.pendingHaulers.length === 0) targetBoard.finishDraining(operationID, drain.target.targetKey);
    }
    runtime.drainingTargets = runtime.drainingTargets.filter((row) => row.pendingHaulers.length > 0);
    if (changed) {
      member.runtimeState = "RUNNING";
      member.phase = "Catching up to current target";
    }
    return changed;
  }

  function assignment(operationID, characterID) {
    const def = definition(operationID);
    const runtime = runtimeFor(operationID);
    const memberDef = def?.members.find((row) => row.characterID === Number(characterID));
    const member = runtime?.members.get(Number(characterID));
    if (!def || !runtime || !memberDef || !member) return null;
    if (runtime.currentTarget?.claimedByOperationID === operationID) {
      const key = runtime.currentTarget.targetKey;
      if (targetBoard.heartbeat(operationID, key)) {
        runtime.currentTarget = targetBoard.get(key);
      } else {
        runtime.currentTarget = null;
        runtime.rendezvous = null;
        runtime.state = "DEGRADED";
        history(runtime, "TARGET_CLAIM_LOST", null, { targetKey: key });
      }
    }
    const tail = runtime.drainingTargets.find((row) => row.pendingHaulers.includes(Number(characterID))) || null;
    if (tail?.target?.targetKey) targetBoard.heartbeat(operationID, tail.target.targetKey);
    return {
      operationID,
      operationName: def.name,
      role: memberDef.role,
      unloadPolicy: def.unloadPolicy,
      area: def.area,
      state: runtime.state,
      currentTarget: runtime.currentTarget,
      logisticsTarget: tail?.target ?? null,
      rendezvous: runtime.rendezvous === null ? null : {
        kind: runtime.rendezvous.kind,
        required: [...runtime.rendezvous.required],
        ready: [...runtime.rendezvous.ready],
        thisMemberReady: runtime.rendezvous.ready.includes(Number(characterID)),
      },
    };
  }

  function beginStop(operationID) {
    const runtime = runtimeFor(operationID);
    if (!runtime) return null;
    if (runtime.state !== "STOPPED") runtime.state = "STOPPING";
    runtime.stopFailures = [];
    return runtime;
  }

  function finishStop(operationID, failures) {
    const runtime = runtimeFor(operationID);
    if (!runtime) return null;
    runtime.stopFailures = failures.map((row) => ({ ...row }));
    if (failures.length > 0) {
      runtime.state = "STOPPING";
      return runtime;
    }
    targetBoard.releaseOperation(operationID);
    runtime.currentTarget = null;
    runtime.drainingTargets = [];
    runtime.rendezvous = null;
    runtime.state = "STOPPED";
    runtime.stoppedAt = stamp(now);
    for (const member of runtime.members.values()) {
      if (member.runtimeState !== "FAILED") {
        member.runtimeState = "STOPPED";
        member.phase = "Stopped safely";
      }
    }
    return runtime;
  }

  function reconcileBots(bots) {
    const active = new Map();
    for (const bot of bots || []) {
      if (!bot.operationID || bot.endedAt) continue;
      active.set(Number(bot.characterID), bot);
      const def = definition(bot.operationID);
      if (!def) continue;
      const runtime = runtimeFor(bot.operationID);
      const row = runtime.members.get(Number(bot.characterID));
      if (row) {
        row.botID = bot.botID;
        row.runtimeState = bot.status;
        row.phase = bot.phase;
        row.reason = bot.why;
      }
      if (runtime.state === "DRAFT" || runtime.state === "STOPPED") {
        runtime.state = "DEGRADED";
        runtime.startedAt = bot.startedAt;
        history(runtime, "RECOVERED_UNKNOWN", null, { reason: "botHost resumed without a trusted current target" });
      }
    }
    for (const [operationID, runtime] of runtimes) {
      if (["DRAFT", "STOPPED", "STOPPING"].includes(runtime.state)) continue;
      for (const row of runtime.members.values()) {
        if (row.botID && !active.has(row.characterID) && !["FAILED", "STOPPED"].includes(row.runtimeState)) {
          memberFailed(operationID, row.characterID, "The hosted automation is no longer running.");
        }
      }
    }
  }

  function publicRuntime(def, runtime) {
    const members = def.members.map((member) => ({ ...member, ...(runtime.members.get(member.characterID) || {}) }));
    return {
      operationID: def.operationID,
      state: runtime.state,
      currentTarget: runtime.currentTarget,
      members,
      logisticsTail: runtime.drainingTargets.map((row) => ({
        target: row.target,
        pendingHaulers: [...row.pendingHaulers],
      })),
      rendezvous: runtime.rendezvous === null ? null : {
        kind: runtime.rendezvous.kind,
        target: runtime.rendezvous.target,
        required: [...runtime.rendezvous.required],
        ready: [...runtime.rendezvous.ready],
      },
      history: [...runtime.history],
      startedAt: runtime.startedAt,
      stoppedAt: runtime.stoppedAt,
      stopFailures: [...runtime.stopFailures],
    };
  }

  function list(bots = []) {
    reconcileBots(bots);
    return store.list().map((def) => ({ definition: def, runtime: publicRuntime(def, runtimeFor(def.operationID)) }));
  }

  function remove(operationID) {
    const runtime = runtimeFor(operationID);
    if (runtime && !["DRAFT", "STOPPED"].includes(runtime.state)) {
      return { ok: false, code: "MINING_OPERATION_ACTIVE", message: "Stop the operation before deleting it." };
    }
    runtimes.delete(String(operationID));
    return { ok: store.remove(operationID) };
  }

  return {
    store,
    targetBoard,
    list,
    definition,
    runtimeFor,
    begin,
    memberStarted,
    memberFailed,
    finishLaunch,
    reserveCandidate,
    activateTarget,
    depleteTarget,
    markReady,
    finishDrain,
    assignment,
    beginStop,
    finishStop,
    reconcileBots,
    remove,
  };
}

module.exports = {
  createMiningOperations,
  auditMiningScript,
  EXECUTABLE_TARGET_CLASSES,
  DEFERRED_TARGET_CLASSES,
};
