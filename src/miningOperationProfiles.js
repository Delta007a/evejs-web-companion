"use strict";

// MCC-owned scripts use the ordinary script runner. IDs identify behavior,
// while rev and botHost's document hash pin the exact granted implementation.
const BELT_MINER_ID = "mcc.belt.hauler-service.miner";
const BELT_HAULER_ID = "mcc.belt.hauler-service.hauler";
const PROFILES = Object.freeze({
  MINER: { scriptID: BELT_MINER_ID, name: "Belt Miner / Hauler Service", rev: 2 },
  HAULER: { scriptID: BELT_HAULER_ID, name: "Belt Hauler", rev: 1 },
});
// Families own distinct implementations. Future families cannot route through
// a belt routine merely because they share a member role.
const PROFILE_FAMILIES = Object.freeze({
  BELT: { family: "BELT", executable: true, profiles: PROFILES, build: buildBeltProfile },
  ORE_ANOMALY: { family: "ORE_ANOMALY", executable: false, profiles: {}, reason: "Ore Anomaly profiles are not implemented." },
  ICE: { family: "ICE", executable: false, profiles: {}, reason: "Ice profiles are not implemented." },
  GAS: { family: "GAS", executable: false, profiles: {}, reason: "Gas profiles are not implemented." },
});
const familyCapabilities = () => Object.values(PROFILE_FAMILIES).map(({ build, ...metadata }) => metadata);

function standardProfileFor(definition, member) {
  if ((member?.routineMode || (member?.automationID ? "CUSTOM" : "STANDARD")) !== "STANDARD" || definition?.unloadPolicy !== "HAULER_SERVICE" ||
      definition.area?.targetClasses?.length !== 1) return null;
  const family = PROFILE_FAMILIES[definition.area.targetClasses[0]];
  return family?.executable ? family.profiles[member.role] || null : null;
}

function buildStandardProfile(definition, member) {
  const family = PROFILE_FAMILIES[definition?.area?.targetClasses?.[0]];
  return family?.executable ? family.build(definition, member) : null;
}

function buildBeltProfile(definition, member) {
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
        // Drone management is opt-in in the ordinary runner, including every
        // re-entry after jettison. Omitting this toggle leaves a modules-only miner.
        { id: "mine", kind: "macro", macro: "mine-at-belt", args: { belt, drones: { kind: "toggle", enabled: true } }, until: { kind: "ore-hold-at-least", fraction: 0.9 } },
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

module.exports = { BELT_MINER_ID, BELT_HAULER_ID, PROFILES, PROFILE_FAMILIES, familyCapabilities, standardProfileFor, buildStandardProfile };
