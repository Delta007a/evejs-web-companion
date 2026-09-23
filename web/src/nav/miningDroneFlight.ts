// Pure drone sub-ladder of the mining bot. The existing controller owns all IO.
import type { DroneBayStack, DroneInSpace } from "../store/types.ts";
import type { DroneRole } from "./droneRoles.ts";

export const MINING_DRONE_ORDER_ATTEMPTS = 3;
const DEFENSE_CLEAR_OBSERVATIONS = 3;
const RECALL_RETRY_OBSERVATIONS = 15;
const MAX_RECALL_OBSERVATIONS = 90;

export interface MiningDroneState {
  readonly bay: readonly DroneBayStack[] | null;
  readonly out: readonly DroneInSpace[] | null;
  readonly maxActive: number | null;
  readonly roles: Readonly<Record<number, DroneRole | null>>;
}
export interface MiningDroneMemory {
  readonly combat: boolean;
  readonly clearTicks: number;
  readonly returning: readonly number[];
  readonly recallTicks: number;
  readonly commandKey: string;
  readonly blockedLaunchKey?: string;
  readonly attempts: number;
  readonly cooldown: number;
}
export const freshDroneMemory = (): MiningDroneMemory => ({
  combat: false, clearTicks: 0, returning: [], recallTicks: 0,
  commandKey: "", attempts: 0, cooldown: 0,
});
export type MiningDroneAction =
  | { readonly kind: "launch"; readonly drones: readonly { itemID: number; quantity: number }[] }
  | { readonly kind: "recallDrones"; readonly droneIDs: readonly number[] }
  | { readonly kind: "mineDrones" | "engageDrones"; readonly droneIDs: readonly number[]; readonly targetID: number }
  | { readonly kind: "wait"; readonly reason: string }
  | { readonly kind: "pause"; readonly reason: string };

/** No defaults for unreadable quantities or limits; one entry per real stack. */
export function miningDroneTopUp(bay: readonly DroneBayStack[], slots: number) {
  const drones: { itemID: number; quantity: number }[] = [];
  const seen = new Set<number>();
  if (!Number.isSafeInteger(slots) || slots <= 0) return drones;
  for (const stack of bay) {
    if (seen.has(stack.itemID)) continue;
    seen.add(stack.itemID);
    if (!Number.isSafeInteger(stack.itemID) || stack.itemID <= 0 ||
        !Number.isSafeInteger(stack.quantity) || stack.quantity <= 0) continue;
    const quantity = Math.min(slots, stack.quantity);
    drones.push({ itemID: stack.itemID, quantity });
    slots -= quantity;
    if (slots === 0) break;
  }
  return drones;
}

export function decideMiningDroneFlight(
  state: MiningDroneState | null,
  previous: MiningDroneMemory,
  hostileID: number | null,
  rockID: number | null,
  leaving: boolean,
): { action: MiningDroneAction | null; memory: MiningDroneMemory; failedDefense?: boolean } {
  const memory = { ...previous };
  const result = (action: MiningDroneAction | null, failedDefense = false) => ({ action, memory, failedDefense });
  const wait = (reason: string) => result({ kind: "wait", reason });
  // A failed read never counts as a clear grid or confirms a return.
  if (state?.out == null) {
    memory.clearTicks = 0;
    return leaving || hostileID !== null ? wait("reading drone control state") : result(null);
  }
  if (hostileID !== null) {
    memory.combat = true;
    memory.clearTicks = 0;
  } else if (memory.combat) {
    memory.clearTicks++;
    if (memory.clearTicks >= DEFENSE_CLEAR_OBSERVATIONS) memory.combat = false;
  }
  if (memory.combat !== previous.combat) memory.blockedLaunchKey = undefined;
  const out = state.out.filter(d => d.controlled);
  const role = memory.combat ? "combat" : "mining";
  const roleOf = (typeID: number | null) => typeID === null ? null : state.roles[typeID];
  const pending = state.out.filter(d => memory.returning.includes(d.itemID));
  const wrong = out.filter(d => leaving || d.activity === "returning" || roleOf(d.typeID) !== role);
  // Once recalled, complete that return even if the threat changes mid-flight.
  const returning = [...new Set([...pending, ...wrong].map(d => d.itemID))];
  if (returning.length > 0) {
    memory.recallTicks++;
    const newIDs = returning.filter(id => !memory.returning.includes(id));
    memory.returning = returning;
    if (memory.recallTicks > MAX_RECALL_OBSERVATIONS) return result({ kind: "pause", reason: "Drones have not returned; travel and flight switching stopped." });
    if (newIDs.length > 0 || memory.recallTicks % RECALL_RETRY_OBSERVATIONS === 0) {
      return result({ kind: "recallDrones", droneIDs: returning });
    }
    return wait("waiting for drones to return");
  }
  memory.returning = [];
  memory.recallTicks = 0;
  if (leaving) return result(null);
  const targetID = memory.combat ? hostileID : rockID;
  if (targetID === null) return result(null);
  if (state.maxActive === null || !Number.isSafeInteger(state.maxActive) || state.maxActive < 0) return result(null);
  const drones = miningDroneTopUp((state.bay ?? []).filter(d => roleOf(d.typeID) === role), state.maxActive - out.length);
  const idle = out.filter(d => d.targetID !== targetID ||
    !(memory.combat ? ["fighting", "chasing", "approaching"] : ["mining", "approaching"]).includes(d.activity ?? ""));
  const launchKey = JSON.stringify([role, drones, out.map(d => d.itemID)]);
  const action: MiningDroneAction | null = drones.length > 0 && launchKey !== memory.blockedLaunchKey ? { kind: "launch", drones } :
    idle.length > 0 ? { kind: memory.combat ? "engageDrones" : "mineDrones", droneIDs: idle.map(d => d.itemID), targetID } : null;
  if (action === null) {
    memory.commandKey = "";
    memory.attempts = 0;
    memory.cooldown = 0;
    return result(null);
  }
  const key = JSON.stringify([role, action, out.map(d => d.itemID)]);
  if (key !== memory.commandKey) {
    memory.commandKey = key;
    memory.attempts = 0;
    memory.cooldown = 0;
  }
  if (memory.cooldown > 0) { memory.cooldown--; return memory.combat ? wait("waiting for drone order confirmation") : result(null); }
  if (memory.attempts >= MINING_DRONE_ORDER_ATTEMPTS) {
    if (action.kind === "launch") memory.blockedLaunchKey = launchKey;
    return result(null, memory.combat && (action.kind !== "launch" || out.length === 0));
  }
  memory.attempts++;
  memory.cooldown = 3;
  return result(action);
}
