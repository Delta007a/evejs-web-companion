import {
  decodeFlightStatus,
  decodeSpaceSnapshot,
  getFlightStatus,
  getSpaceSnapshot,
} from "../../../web/src/plugin-api/flying.ts";
import type { PluginRunContext } from "../../../web/src/plugin-api/backend.ts";
import type { PilotSession } from "../../../web/src/plugin-api/pilotSession.ts";
import { boundedDroneRead, checkDroneEngage } from "../combat/droneAdapter.ts";

export type BeltDroneRecovery = { characterID: number; systemID: number; beforeWrite: () => void };

type Run = Pick<PluginRunContext, "baseUrl" | "fetch">;
type Drone = { itemID: number; typeID: number | null; controlled: boolean };
type Stack = { itemID: number; typeID: number; quantity: number };
type DroneStack = Stack & { volume: number; categoryID: number };
type Holds = {
  shipID: number;
  activeShipID: number;
  bays: {
    key: string;
    present: boolean;
    error: string | null;
    capacity: { capacity: number; used: number };
    items: DroneStack[];
  }[];
};
type Panel = { bay: readonly Stack[]; out: readonly Drone[] };

const epsilon = 1e-6;
const positiveID = (n: number) => Number.isSafeInteger(n) && n > 0;
const validStack = (row: Stack) =>
  positiveID(row.itemID) &&
  positiveID(row.typeID) &&
  (positiveID(row.quantity) || row.quantity === -1);
const units = (row: Stack) => (row.quantity === -1 ? 1 : row.quantity);

function matchesBay(panel: readonly Stack[], bay: readonly DroneStack[]) {
  return (
    panel.length === bay.length &&
    bay.every((stack) =>
      panel.some(
        (row) =>
          row.itemID === stack.itemID && row.typeID === stack.typeID && units(row) === units(stack),
      ),
    )
  );
}

/** Find the smallest move that can make enough room, or the most space cargo can free. */
function firstCargoMove(stacks: readonly DroneStack[], free: number, deficit: number) {
  type Move = { stack: DroneStack; quantity: number };
  const limit = Math.min(free, deficit + Math.max(0, ...stacks.map((stack) => stack.volume)));
  const choices = new Map<number, Move | null>([[0, null]]);
  for (const stack of stacks) {
    for (const [total, first] of [...choices]) {
      const quantityLimit = Math.min(
        units(stack),
        Math.floor((limit - total + epsilon) / stack.volume),
      );
      for (let quantity = 1; quantity <= quantityLimit; quantity++) {
        const volume = Math.round((total + quantity * stack.volume) / epsilon) * epsilon;
        if (!choices.has(volume)) choices.set(volume, first ?? { stack, quantity });
      }
    }
  }
  let best = 0;
  for (const volume of choices.keys()) {
    if (best + epsilon < deficit ? volume > best : volume + epsilon >= deficit && volume < best)
      best = volume;
  }
  return choices.get(best);
}

/** Resolve a proven bay overflow during belt departure with the game's own inventory and drone commands. */
export async function makeRoomForReturningDrones(
  run: Run,
  session: PilotSession,
  shipID: number,
  recovery: BeltDroneRecovery,
  bay: readonly Stack[],
  controlled: readonly Drone[],
  readPanel: () => Promise<Panel>,
): Promise<{ changed: boolean; notice?: string }> {
  const request = { ...session.flow.requestOptions(), baseUrl: run.baseUrl, fetch: run.fetch };
  const route = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await run.fetch(
      new URL(path, run.baseUrl),
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const value = await response.json();
    if (!response.ok || value?.ok !== true)
      throw Error(
        value?.message ?? value?.error ?? "The game did not confirm the inventory request.",
      );
    return value;
  };
  const readHolds = async () => {
    const raw = await boundedDroneRead(
      () => route<Holds>(`/api/bridge/ship/${shipID}/bays?keys=drone%2Ccargo`),
      12000,
    );
    if (raw.shipID !== shipID || raw.activeShipID !== shipID || !Array.isArray(raw.bays))
      throw Error("Drone bay recovery requires the held ship's own inventory.");
    return raw.bays;
  };
  const checkedHold = (holds: Holds["bays"], key: string) => {
    const hold = holds.find((row) => row.key === key);
    if (
      !hold ||
      hold.present !== true ||
      hold.error !== null ||
      !Number.isFinite(hold.capacity?.capacity) ||
      hold.capacity.capacity <= 0 ||
      !Number.isFinite(hold.capacity?.used) ||
      hold.capacity.used < 0 ||
      !Array.isArray(hold.items) ||
      !hold.items.every(validStack) ||
      new Set(hold.items.map((row) => row.itemID)).size !== hold.items.length
    )
      throw Error("The " + key + " hold capacity or inventory could not be verified.");
    return hold;
  };
  const typeIDs = [...new Set(controlled.map((row) => row.typeID))];
  if (typeIDs.some((id) => id === null)) throw Error("A returning drone's type is unknown.");
  const [holds, facts] = await Promise.all([
    readHolds(),
    boundedDroneRead(
      () =>
        route<{ volumes?: Record<string, number>; capped?: boolean }>(
          "/api/types/volumes?typeIDs=" + typeIDs.join(","),
        ),
      12000,
    ),
  ]);
  const drone = checkedHold(holds, "drone");
  const unitVolume = (typeID: number | null) => facts.volumes?.[String(typeID)] ?? 0;
  if (
    facts.capped ||
    controlled.some((row) => {
      const volume = unitVolume(row.typeID);
      return typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0;
    })
  )
    throw Error("Returning drone volumes could not be verified.");
  const used = drone.items.reduce((total, row) => total + units(row) * row.volume, 0);
  const returning = controlled.reduce((total, row) => total + unitVolume(row.typeID), 0);
  // Web Companion normally reports physical contents. Its native GetCapacity
  // fallback includes the reservation for drones still controlled in space.
  const reportedUsed = drone.capacity.used;
  if (
    !matchesBay(bay, drone.items) ||
    !drone.items.every(
      (row) => row.categoryID === 18 && Number.isFinite(row.volume) && row.volume > 0,
    ) ||
    (Math.abs(used - reportedUsed) > epsilon && Math.abs(used + returning - reportedUsed) > epsilon)
  )
    return {
      changed: false,
      notice:
        "Drone bay contents changed or could not be verified. Rechecking before any inventory move.",
    };

  const deficit = used + returning - drone.capacity.capacity;
  if (deficit <= epsilon) return { changed: false };
  const cargo = checkedHold(holds, "cargo");
  const spares = [...drone.items].sort(
    (a, b) =>
      Number(typeIDs.includes(b.typeID)) - Number(typeIDs.includes(a.typeID)) ||
      a.itemID - b.itemID,
  );
  const move = firstCargoMove(
    spares,
    Math.max(0, cargo.capacity.capacity - cargo.capacity.used),
    deficit,
  );

  const flight = decodeFlightStatus(
    (await boundedDroneRead(() => getFlightStatus(request), 12000)).flight,
  );
  if (
    flight.shipID !== shipID ||
    !flight.inSpace ||
    flight.docked ||
    flight.solarSystemID !== recovery.systemID ||
    (flight.transition && flight.transition.phase !== "ready") ||
    flight.shipMode?.toUpperCase() === "WARP"
  )
    throw Error("The held ship must be settled in the old belt system for drone bay recovery.");
  const latest = await readPanel();
  const latestControlled = latest.out.filter((row) => row.controlled);
  if (
    !matchesBay(latest.bay, drone.items) ||
    latestControlled.length !== controlled.length ||
    latestControlled.some(
      (row) =>
        !controlled.some(
          (previous) => previous.itemID === row.itemID && previous.typeID === row.typeID,
        ),
    )
  )
    return {
      changed: false,
      notice:
        "Drone disposition changed during the capacity check. Rechecking before any inventory move.",
    };
  const scene = decodeSpaceSnapshot(
    (await boundedDroneRead(() => getSpaceSnapshot(request), 8000)).space,
  );
  if (
    !scene.inSpace ||
    scene.stateValid === false ||
    scene.shipID !== shipID ||
    scene.ship?.itemID !== shipID ||
    scene.solarSystemID !== recovery.systemID ||
    !controlled.every((drone) =>
      scene.entities.some(
        (entity) =>
          entity.kind === "drone" &&
          entity.itemID === drone.itemID &&
          entity.typeID === drone.typeID &&
          entity.ownerID === recovery.characterID &&
          entity.controllerID === shipID,
      ),
    )
  )
    throw Error("The returning drones could not be verified in the held ship's current grid.");

  if (move) {
    const { stack, quantity } = move;
    recovery.beforeWrite();
    let failure: unknown;
    try {
      await route("/api/bridge/inventory/transfer", {
        itemIDs: [stack.itemID],
        qty: quantity,
        from: { kind: "shipBay", bay: "drone" },
        to: { kind: "cargo" },
        expectedScope: { shipID, solarSystemID: recovery.systemID },
      });
    } catch (error) {
      failure = error;
    }
    const after = await readHolds();
    const sourceAfter = checkedHold(after, "drone").items.find(
      (row) => row.itemID === stack.itemID,
    );
    const totalType = (rows: readonly Stack[]) =>
      rows.reduce((total, row) => (row.typeID === stack.typeID ? total + units(row) : total), 0);
    const cargoGain = totalType(checkedHold(after, "cargo").items) - totalType(cargo.items);
    if (
      units(stack) - (sourceAfter ? units(sourceAfter) : 0) !== quantity ||
      cargoGain !== quantity
    )
      throw Error(
        "Moving drones to cargo was not confirmed. Check both holds before trying again.",
        { cause: failure },
      );
    return {
      changed: true,
      notice: "Moved " + quantity + " drone(s) to cargo to make room for recall.",
    };
  }

  // Once cargo cannot free any more space, releasing the largest drones first
  // covers the remaining deficit with the fewest drones.
  const leave: number[] = [];
  let remaining = deficit;
  for (const row of [...controlled].sort(
    (a, b) => unitVolume(b.typeID) - unitVolume(a.typeID) || a.itemID - b.itemID,
  )) {
    if (remaining <= epsilon) break;
    leave.push(row.itemID);
    remaining -= unitVolume(row.typeID);
  }
  if (remaining > epsilon)
    throw Error("The drone bay would still be over capacity after releasing the entire flight.");
  recovery.beforeWrite();
  let failure: unknown;
  try {
    checkDroneEngage(
      await session.flow.flying.bridgeDo("entity", "CmdAbandonDrone", [leave]),
      leave,
    );
  } catch (error) {
    failure = error;
  }
  const after = await readPanel();
  if (!leave.every((id) => after.out.some((row) => row.itemID === id && !row.controlled)))
    throw Error(
      "The game has not confirmed release of the selected drones. Rechecking the held flight.",
      { cause: failure },
    );
  return {
    changed: true,
    notice: "Drones not recovered to the bay because it is full: " + leave.join(", ") + ".",
  };
}
