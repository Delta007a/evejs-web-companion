import type { BotScript } from "../bots/botScript.ts";
import type { ScriptObservation } from "./scriptConditions.ts";
import { createScriptRunner, type ScriptRunnerController, type ScriptRunnerDeps } from "./scriptRunner.ts";
import { freightHoldItemIDs } from "./miningBotLoop.ts";

export interface FleetParkingPolicy {
  readonly mode: "RETURN_HOME_DOCK" | "RETURN_HOME_UNLOAD_DOCK";
  readonly destination: { readonly stationID: number; readonly stationName: string; readonly systemName: string };
  readonly corporationDivision: number | null;
}

export function parkingScript(policy: FleetParkingPolicy): BotScript {
  if (!["RETURN_HOME_DOCK", "RETURN_HOME_UNLOAD_DOCK"].includes(policy.mode) ||
      !Number.isSafeInteger(policy.destination?.stationID) || policy.destination.stationID <= 0) {
    throw new Error("Parking requires an explicit station; starting station is not a fallback.");
  }
  const home = { entity: "station" as const, id: policy.destination.stationID,
    name: policy.destination.stationName, systemName: policy.destination.systemName };
  return { format: "evejs-bot-script", version: 1, name: "Fleet Parking", notes: "Finite operation stop, not a mining routine.",
    home, interrupts: [], program: [{ id: "park", kind: "macro",
      macro: policy.mode === "RETURN_HOME_UNLOAD_DOCK" ? "deliver-ore" : "travel-to-station",
      args: { station: { kind: "station", ref: home },
        ...(policy.corporationDivision === null ? {} : { into: { kind: "corpDivision" as const, division: policy.corporationDivision, name: null } }) },
    }],
  };
}

function readableFreight(obs: ScriptObservation): boolean {
  return obs.holds != null && obs.holds.some(hold => hold.present) &&
    obs.holds.every(hold => !hold.present || (Array.isArray(hold.items) && !hold.error));
}

// A finite use of the EXISTING runner and delivery/travel macros. It replaces
// the paused routine; it does not run another independent observation loop.
export async function runFleetParking(deps: ScriptRunnerDeps, policy: FleetParkingPolicy, deadlineMs: number,
  install: (runner: ScriptRunnerController) => void, now = Date.now): Promise<void> {
  const doc = parkingScript(policy);
  let last: ScriptObservation | null = null;
  let fatal: Error | null = null;
  let lastReadError: unknown = null;
  const deadline = () => {
    if (!Number.isFinite(deadlineMs) || now() >= deadlineMs) {
      fatal = new Error("Parking did not complete before the approved run deadline; pilot control is retained. Start a fresh approved run to recover.");
      throw fatal;
    }
  };
  const runner = createScriptRunner({ ...deps,
    observe: async hint => {
      deadline();
      let observed: ScriptObservation;
      try { observed = await deps.observe(hint); }
      catch (error) { lastReadError = error; throw error; }
      deadline();
      // Parking is a trusted, fixed finite program with no resource selectors.
      // Target assignment remains mandatory for the normal operation runner.
      last = { ...observed, miningOperation: null, miningOperationRequired: false };
      if (policy.mode === "RETURN_HOME_UNLOAD_DOCK" && last.flightStatus?.docked && !readableFreight(last)) {
        lastReadError = new Error("Parking freight holds are unreadable; unload completion cannot be confirmed.");
        throw lastReadError;
      }
      lastReadError = null;
      return last;
    },
    issue: async action => {
      deadline();
      if (!["startRoute", "warp", "dock", "undock", "align", "approach", "stopShip", "recallDrones", "unloadOre"].includes(action.kind) ||
          (action.kind === "startRoute" && action.stationID !== policy.destination.stationID) ||
          (action.kind === "dock" && action.stationID !== policy.destination.stationID)) {
        throw new Error(`Parking refused an out-of-scope action: ${action.kind}`);
      }
      return deps.issue(action);
    },
    isSessionLost: error => error === fatal || deps.isSessionLost(error),
    travelHome: () => ({ action: { kind: "wait" }, why: "Parking failed; no alternate destination is authorized.",
      phase: "Parking failed", armed: false, nextMem: {}, outcome: { kind: "blocked", reason: "Parking could not complete. Pilot control is retained." } }),
  });
  install(runner);
  runner.start(doc);
  await runner.run();
  const result = runner.snapshot();
  const observed = last as ScriptObservation | null;
  if (fatal) throw fatal;
  if (lastReadError) throw lastReadError;
  if (result.status !== "stopped" || result.pauseReason || observed?.flightStatus?.docked !== true ||
      observed.flightStatus.stationID !== policy.destination.stationID ||
      (policy.mode === "RETURN_HOME_UNLOAD_DOCK" && (!readableFreight(observed) || freightHoldItemIDs(observed.holds ?? null).length > 0))) {
    throw new Error(result.pauseReason || "Parking arrival / freight delivery was not authoritatively confirmed; pilot control is retained.");
  }
}
