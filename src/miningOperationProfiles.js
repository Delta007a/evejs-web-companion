"use strict";

// MCC-owned scripts use the ordinary script runner. IDs identify behavior,
// while rev and botHost's document hash pin the exact granted implementation.
const BELT_MINER_ID = "mcc.belt.hauler-service.miner";
const BELT_HAULER_ID = "mcc.belt.hauler-service.hauler";
const PROFILE_REV = 1;
const PROFILES = Object.freeze({
  MINER: { scriptID: BELT_MINER_ID, name: "Belt Miner / Hauler Service", rev: PROFILE_REV },
  HAULER: { scriptID: BELT_HAULER_ID, name: "Belt Hauler", rev: PROFILE_REV },
});

function standardProfileFor(definition, member) {
  if ((member?.routineMode || (member?.automationID ? "CUSTOM" : "STANDARD")) !== "STANDARD" || definition?.unloadPolicy !== "HAULER_SERVICE" ||
      definition.area?.targetClasses?.length !== 1 || definition.area.targetClasses[0] !== "BELT") return null;
  return PROFILES[member.role] || null;
}

function buildStandardProfile(definition, member) {
  const profile = standardProfileFor(definition, member);
  if (!profile) return null;
  const destination = definition.unloadDestination;
  if (!Number.isSafeInteger(destination?.stationID) || destination.stationID <= 0 ||
      !Number.isSafeInteger(destination?.corporationDivision) || destination.corporationDivision < 1 || destination.corporationDivision > 7 ||
      !destination.stationName || !destination.systemName) return null;
  const station = { entity: "station", id: destination.stationID, name: destination.stationName, systemName: destination.systemName };
  const belt = { kind: "belt", belt: { mode: "nearest" } };
  const doc = {
    format: "evejs-bot-script", version: 1, name: profile.name,
    notes: "MCC standard BELT profile. Resource target comes only from operation.currentTarget.",
    home: station, interrupts: [],
    program: member.role === "MINER" ? [{
      id: "loop", kind: "loop", repeat: { kind: "forever" }, body: [
        { id: "undock", kind: "macro", macro: "undock", args: {} },
        { id: "mine", kind: "macro", macro: "mine-at-belt", args: { belt }, until: { kind: "ore-hold-at-least", fraction: 0.9 } },
        { id: "jettison", kind: "macro", macro: "jettison-ore", args: {} },
      ],
    }] : [{
      id: "loop", kind: "loop", repeat: { kind: "forever" }, body: [
        { id: "hold-check", kind: "branch", when: { kind: "ore-hold-at-least", fraction: 0.9 },
          then: [{ id: "deliver", kind: "macro", macro: "deliver-ore", args: {
            station: { kind: "station", ref: station },
            into: { kind: "corpDivision", division: destination.corporationDivision, name: null },
          } }],
          else: [
            { id: "undock", kind: "macro", macro: "undock", args: {} },
            { id: "travel", kind: "macro", macro: "travel-to-belt", args: { belt } },
            { id: "loot", kind: "macro", macro: "loot-containers", args: {} },
          ],
        },
        { id: "idle", kind: "macro", macro: "wait", args: { seconds: { kind: "count", value: 3 } } },
      ],
    }],
  };
  return { ...profile, doc };
}

module.exports = { BELT_MINER_ID, BELT_HAULER_ID, PROFILE_REV, PROFILES, standardProfileFor, buildStandardProfile };
