"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const staticData = require("./staticData");

const STORE_FILENAME = "mining-operations.json";
const ROLES = new Set(["MINER", "HAULER", "DEFENDER"]);
const REACH = new Set(["CURRENT_SYSTEM", "CURRENT_AND_ADJACENT"]);
const TARGET_CLASSES = new Set(["BELT", "ORE_ANOMALY", "ICE", "GAS"]);
const UNLOAD = new Set(["HAULER_SERVICE", "SELF_UNLOAD"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanText(value, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeDefinition(value, existing = null, now = () => new Date().toISOString(), uuid = crypto.randomUUID, resolveSystem = staticData.getSolarSystem) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail("MINING_OPERATION_INVALID", "That is not a Mining Operation definition.");
  }
  const name = cleanText(value.name, 80);
  const anchorSystemID = Number(value.area?.anchorSystemID);
  const reach = cleanText(value.area?.reach).toUpperCase();
  const targetClasses = Array.isArray(value.area?.targetClasses)
    ? [...new Set(value.area.targetClasses.map((row) => cleanText(row).toUpperCase()).filter((row) => TARGET_CLASSES.has(row)))]
    : [];
  const unloadPolicy = cleanText(value.unloadPolicy).toUpperCase();
  if (!name) throw fail("MINING_OPERATION_INVALID", "Give the operation a name.");
  if (!Number.isSafeInteger(anchorSystemID) || anchorSystemID <= 0) {
    throw fail("MINING_OPERATION_INVALID", "Choose an anchor solar system.");
  }
  const system = resolveSystem(anchorSystemID);
  if (!system || !system.solarSystemName) {
    throw fail("MINING_OPERATION_INVALID", "Choose a known anchor solar system from the map catalog.");
  }
  const anchorSystemName = String(system.solarSystemName);
  if (value.area?.anchorSystemName && cleanText(value.area.anchorSystemName, 120) !== anchorSystemName) {
    throw fail("MINING_OPERATION_INVALID", "Anchor system name and ID do not identify the same solar system.");
  }
  if (!REACH.has(reach)) throw fail("MINING_OPERATION_INVALID", "Choose a supported area reach.");
  if (targetClasses.length === 0) throw fail("MINING_OPERATION_INVALID", "Choose at least one target class.");
  if (!UNLOAD.has(unloadPolicy)) throw fail("MINING_OPERATION_INVALID", "Choose an unload policy.");
  if (!Array.isArray(value.members) || value.members.length === 0) {
    throw fail("MINING_OPERATION_INVALID", "Add at least one pilot.");
  }
  const seen = new Set();
  const members = value.members.map((row) => {
    const characterID = Number(row?.characterID);
    const role = cleanText(row?.role).toUpperCase();
    const automationID = cleanText(row?.automationID, 160);
    const accountName = cleanText(row?.accountName, 120);
    if (!Number.isSafeInteger(characterID) || characterID <= 0 || seen.has(characterID)) {
      throw fail("MINING_OPERATION_INVALID", "Every member must be a different valid pilot.");
    }
    if (!ROLES.has(role)) throw fail("MINING_OPERATION_INVALID", "Every member needs an explicit role.");
    if (!automationID && role !== "DEFENDER") throw fail("MINING_OPERATION_INVALID", "Executable members need an operation routine reference.");
    if (!accountName) throw fail("MINING_OPERATION_INVALID", "Every member needs its owning account reference.");
    seen.add(characterID);
    return {
      characterID,
      characterName: cleanText(row.characterName, 120) || `Pilot ${characterID}`,
      accountName,
      role,
      automationID,
    };
  });
  if (!members.some((member) => member.role === "MINER")) {
    throw fail("MINING_OPERATION_INVALID", "A Mining Operation needs at least one MINER.");
  }
  if (unloadPolicy === "HAULER_SERVICE" && !members.some((member) => member.role === "HAULER")) {
    throw fail("MINING_OPERATION_INVALID", "Hauler service needs at least one HAULER member.");
  }
  if (unloadPolicy === "SELF_UNLOAD" && members.some((member) => member.role === "HAULER")) {
    throw fail("MINING_OPERATION_INVALID", "Self unload does not use HAULER members.");
  }
  const stamp = now();
  return {
    operationID: existing?.operationID || cleanText(value.operationID, 160) || uuid(),
    name,
    area: {
      anchorSystemID,
      anchorSystemName,
      reach,
      targetClasses,
    },
    targetPolicy: "ANY_ELIGIBLE",
    unloadPolicy,
    members,
    createdAt: existing?.createdAt || stamp,
    updatedAt: stamp,
  };
}

function createMiningOperationStore(options) {
  const dataDir = options.dataDir;
  const now = options.now || (() => new Date().toISOString());
  const uuid = options.uuid || (() => crypto.randomUUID());
  const resolveSystem = options.resolveSystem || staticData.getSolarSystem;
  const filePath = path.join(dataDir, STORE_FILENAME);

  function readAll() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return parsed && Array.isArray(parsed.operations) ? parsed.operations : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  function writeAll(operations) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ version: 1, operations }, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  }

  return {
    list() {
      return readAll();
    },
    get(operationID) {
      return readAll().find((row) => row.operationID === String(operationID)) || null;
    },
    save(value) {
      const all = readAll();
      const index = all.findIndex((row) => row.operationID === String(value?.operationID || ""));
      const definition = normalizeDefinition(value, index >= 0 ? all[index] : null, now, uuid, resolveSystem);
      if (index >= 0) all[index] = definition;
      else all.push(definition);
      writeAll(all);
      return definition;
    },
    remove(operationID) {
      const all = readAll();
      const next = all.filter((row) => row.operationID !== String(operationID));
      if (next.length === all.length) return false;
      writeAll(next);
      return true;
    },
  };
}

module.exports = { createMiningOperationStore, normalizeDefinition, STORE_FILENAME };
