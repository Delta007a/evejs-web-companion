import { decidePropulsionModule, type PropulsionModule } from "./propulsion.ts";
import { measureSpace } from "./autopilotLoop.ts";
import type { SpaceSnapshot } from "../store/types.ts";

export function fittedTravelPropulsion(rows: readonly { itemID: number; typeID: number; online: boolean; effect: string | null }[]): PropulsionModule[] {
  return rows.filter(row => row.online && ["moduleBonusAfterburner", "moduleBonusMicrowarpdrive"].includes(row.effect ?? ""))
    .map(row => ({ itemID: row.itemID, typeID: row.typeID, kind: row.effect === "moduleBonusAfterburner" ? "afterburner" as const : "microwarpdrive" as const }));
}

export interface TravelAssistInput {
  enabled: boolean;
  scope: string | null;
  action: { kind: string; targetID?: number | null; range?: number };
  snapshot: SpaceSnapshot | null;
  inWarp: boolean | null;
  docked: boolean | null;
  modules: readonly PropulsionModule[];
  scrammed: boolean | null;
}
export interface TravelAssistDeps {
  /** One ordinary module command, including its existing authoritative result.
   * Activation is ONE cycle, bounding ambiguous failures/crashes without a timer. */
  change(module: PropulsionModule, on: boolean): Promise<boolean>;
  log(message: string): void;
}

/** Optional shared movement decorator. No MCC/profile selector and no reads or
 * polling of its own. Only a confirmed subwarp approach can create intent. */
export function createTravelAssist(deps: TravelAssistDeps) {
  let movement: { targetID: number; scope: string; range: number } | null = null;
  let owned: { module: PropulsionModule; targetID: number; scope: string; stopAttempts: number } | null = null;
  let refused: string | null = null;
  let logged = "";
  const log = (message: string) => { if (message !== logged) { logged = message; deps.log(message); } };
  async function stop(): Promise<boolean> {
    if (!owned) return false;
    const current = owned;
    if (current.stopAttempts >= 3) return false; // single-cycle activation still expires
    current.stopAttempts++;
    try {
      if (!await deps.change(current.module, false)) throw new Error("authoritative off state not confirmed");
      log(`Travel assist deactivated ${current.module.itemID}: approach ended/authority changed.`);
      owned = null;
    } catch (error) {
      log(`Travel assist deactivation unconfirmed for ${current.module.itemID}: ${String(error)}; single cycle is bounded.`);
    }
    return true;
  }
  return {
    async beforeAction(input: TravelAssistInput): Promise<boolean> {
      const active = input.snapshot?.ship?.activeModuleIDs;
      const usable = input.enabled && input.scope !== null && input.inWarp === false && input.docked === false && active != null;
      if (owned && active != null && !active.includes(owned.module.itemID)) {
        log(`Travel assist cycle off confirmed: ${owned.module.itemID}.`);
        owned = null;
      }
      if (usable && ["approach", "orbit"].includes(input.action.kind) && input.action.targetID != null) {
        movement = { targetID: input.action.targetID, scope: input.scope!, range: input.action.range ?? 0 };
      } else if (!usable || !["wait", "lock"].includes(input.action.kind) || movement?.scope !== input.scope) movement = null;
      const measured = movement && input.snapshot ? measureSpace(input.snapshot)?.distances.get(movement.targetID) : undefined;
      const distance = measured == null || !Number.isFinite(measured) ? undefined : measured - (movement?.range ?? 0);
      if (distance == null || distance <= 5_000) movement = null;
      if (owned && (!movement || owned.scope !== movement.scope || owned.targetID !== movement.targetID ||
          (input.scrammed === true && owned.module.kind === "microwarpdrive"))) return stop();
      if (!movement || owned || distance! <= 10_000 || input.action.kind === "lock") return false;
      const key = `${movement.scope}:${movement.targetID}`;
      if (refused === key) return false;
      // Respect externally active modules. AB first, then itemID; shared policy
      // still owns capacitor/scram rules. Never activate both AB and MWD.
      if (input.modules.some(module => active!.includes(module.itemID))) { log("Travel assist skipped: propulsion already externally active."); return false; }
      const modules = input.modules.filter(module => module.kind !== null)
        .sort((a, b) => Number(a.kind !== "afterburner") - Number(b.kind !== "afterburner") || a.itemID - b.itemID);
      const picked = decidePropulsionModule({ modules, activeModuleIDs: new Set(active!), capacitorRatio: input.snapshot?.ship?.capacitorRatio ?? null,
        wantBurn: true, capFloor: 0.3, scrammed: input.scrammed });
      if (picked.kind !== "light") {
        const reason = modules.length === 0 ? "no online fitted propulsion with known effect"
          : input.scrammed === true && modules.every(module => module.kind !== "afterburner") ? "MWD blocked by warp scrambler"
          : "capacitor below 30% floor";
        log(`Travel assist skipped: ${reason}.`); return false;
      }
      owned = { module: picked.module, ...movement, stopAttempts: 0 };
      try {
        if (!await deps.change(picked.module, true)) throw new Error("activation not confirmed");
        log(`Travel assist activated ${picked.module.kind} ${picked.module.itemID}: subwarp approach ${movement.targetID}.`);
      } catch (error) {
        refused = key;
        movement = null;
        log(`Travel assist activation refused/unconfirmed: ${String(error)}; ordinary movement continues.`);
        // Keep custody of an ambiguous write until the next observation/off.
      }
      return true;
    },
    async requestStop(): Promise<void> { movement = null; await stop(); },
    pending(): boolean { return owned !== null; },
    confirmStopped(activeModuleIDs: readonly number[] | null): void {
      if (owned && activeModuleIDs !== null && !activeModuleIDs.includes(owned.module.itemID)) {
        log(`Travel assist off confirmed during cleanup: ${owned.module.itemID}.`);
        owned = null;
      }
    },
  };
}
