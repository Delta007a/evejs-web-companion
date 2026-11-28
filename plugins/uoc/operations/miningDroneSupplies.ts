import { decodeDroneBay, decodeFlightStatus } from "../../../web/src/plugin-api/flying.ts";
import { fleetDronesInSpace } from "../miningFleet/droneRecall.ts";
import { stockSource } from "../provisioning/existingHull.ts";
import { miningSupplySourceLabel, type MiningSupplySource } from "../restored/mining/miningPreparation.ts";
import { checkedInventory } from "../shared/nativeInventory.ts";
import { readDictPairs, readRowField, unwrapLong, unwrapReal } from "../shared/wire.ts";

const droneFlag = 87;
const droneCapacityAttribute = 283;
const shipBay = { kind: "shipBay", bay: "drone" } as const;
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const number = (value: unknown) => unwrapReal(value) ?? Number(unwrapLong(value) ?? NaN);

type Read = (path: string, body?: unknown) => Promise<any>;

function fittingDrones(operational: unknown) {
  if (!Array.isArray(operational)) return null;
  const targets = new Map<number, number>();
  for (const row of operational) {
    if (!Array.isArray(row) || row.length !== 3)
      throw Error("Saved fitting equipment is unreadable.");
    const [flag, typeID, quantity] = row;
    if (!positive(flag) || !positive(typeID) || !positive(quantity))
      throw Error("Saved fitting equipment is unreadable.");
    if (flag !== droneFlag) continue;
    if (targets.has(typeID))
      throw Error("Saved fitting drone quantities are unreadable.");
    targets.set(typeID, quantity);
  }
  return targets;
}

/** Match the reviewed drone fit on the held hull using the selected stock. */
export async function prepareMiningDroneSupplies(
  read: Read,
  review: any,
  source: MiningSupplySource,
  beforeTransfer?: () => void,
) {
  const targets = fittingDrones(review.contract?.operational);
  const scope: { shipID: number; shipTypeID: number; locationID: number } = review.context;
  if (!targets || scope.shipTypeID !== review.contract.shipTypeID)
    return { targets: [], issues: [] };

  async function dock() {
    const { flight } = await read("/api/bridge/flight/status");
    const state = decodeFlightStatus(flight);
    if (
      state.shipID !== scope.shipID ||
      state.docked !== true ||
      state.stationID !== scope.locationID ||
      !positive(state.solarSystemID) ||
      (state.transition && state.transition.phase !== "ready")
    )
      throw Error("The active ship or preparation station changed.");
  }

  const invalidate = (locationID: number) =>
    read("/api/bridge/call", {
      service: "invCache",
      method: "InvalidateLocationCache",
      args: [locationID],
      pilot: true,
      confirm: true,
    });

  async function drones(refresh = false) {
    if (refresh) await invalidate(scope.shipID);
    const raw = await read("/api/bridge/drones");
    const bay = decodeDroneBay(raw.bay);
    const out = fleetDronesInSpace(raw.inSpace);
    if (
      raw.activeShipID !== scope.shipID ||
      raw.errors?.bay !== null ||
      raw.errors?.inSpace !== null ||
      !Array.isArray(raw.bay) ||
      !bay ||
      bay.length !== raw.bay.length ||
      raw.bay.some((row: { quantity?: unknown } | null) => {
        const quantity = number(row?.quantity);
        return !positive(quantity) && ![-1, -2].includes(quantity);
      }) ||
      !out
    )
      throw Error("The held ship's drones could not be verified.");

    const stowed = bay.map(({ itemID, typeID, quantity }) => ({
      itemID,
      typeID,
      quantity: quantity < 0 ? 1 : quantity,
    }));
    const inside = new Set(stowed.map((row) => row.itemID));
    const aboard = [...stowed];
    for (const drone of out) {
      if (!drone.controlled || inside.has(drone.itemID)) continue;
      if (drone.typeID === null)
        throw Error("A drone controlled by the held ship has no verified type.");
      aboard.push({ itemID: drone.itemID, typeID: drone.typeID, quantity: 1 });
    }

    const ship = readDictPairs(raw.shipInfo).find(([id]) => number(id) === scope.shipID)?.[1];
    const attributes = readDictPairs(readRowField(ship, "attributes"));
    const capacity = number(attributes.find(([id]) => number(id) === droneCapacityAttribute)?.[1]);
    return { stowed, aboard, capacity };
  }

  const count = (aboard: Awaited<ReturnType<typeof drones>>["aboard"], typeID: number) =>
    aboard.reduce((total, row) => total + (row.typeID === typeID ? row.quantity : 0), 0);
  await dock();
  let state = await drones();
  const difference = (typeID: number) => count(state.aboard, typeID) - (targets.get(typeID) ?? 0);
  const typeIDs = [...new Set([...targets.keys(), ...state.aboard.map((row) => row.typeID)])];
  if (typeIDs.every((typeID) => difference(typeID) === 0))
    return { targets: [], issues: [] };

  const { names } = await read("/api/names", {
    items: typeIDs.map((id) => ({ kind: "type", id })),
  });
  const label = (typeID: number) => names?.["type:" + typeID] ?? "Type " + typeID;
  const { pin } = review.source;
  const from = stockSource(review);
  const office = from.kind === "corp" ? /^corpOffice:(\d+)$/.exec(pin.office)?.[1] : undefined;
  const inventory = from.kind === "hangar" ? "hangar" : Number(office);
  if (
    from.kind !== source.kind ||
    (from.kind === "corp" &&
      (source.kind !== "corp" ||
        source.division !== from.division ||
        source.corporationID !== pin.ownerID ||
        !positive(inventory)))
  )
    throw Error("The stock location differs from the selected drone supply source.");
  async function readStock() {
    if (typeof inventory === "number") await invalidate(inventory);
    else if (positive(pin.locationID)) await invalidate(pin.locationID);
    const raw = await read("/api/bridge/call", {
      service: "invbroker",
      method: "List",
      args: [],
      kwargs: { flag: pin.flag },
      of: inventory,
      pilot: true,
    });
    const rows = checkedInventory(raw.result);
    if (rows.some((row) =>
      row.ownerID !== pin.ownerID || row.locationID !== pin.locationID || row.flagID !== pin.flag,
    ))
      throw Error("The drone stock inventory scope could not be verified.");
    return rows;
  }

  let stock = await readStock();
  const available = new Map([...targets.keys()].map((id) => [id, count(stock, id)]));
  const issues: string[] = [];

  if (
    beforeTransfer &&
    review.canApply === true &&
    review.source.access.take === true &&
    (state.stowed.some(({ typeID }) => difference(typeID) > 0) ||
      [...targets.keys()].some((typeID) => difference(typeID) < 0 && available.get(typeID)))
  ) {
    const facts = await read("/api/types/volumes?typeIDs=" + typeIDs.join(","));
    const volume = (id: number) => {
      const value = facts.volumes?.[id];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        throw Error("The volume of " + label(id) + " could not be verified.");
      return value;
    };
    function effectiveCapacity() {
      if (!Number.isFinite(state.capacity) || state.capacity < 0 || facts.capped)
        throw Error("The active ship's effective Drone Bay capacity could not be verified.");
      return state.capacity;
    }
    async function freeRoom() {
      // Use the held hull's Dogma capacity with the bays API's reported usage.
      const capacity = effectiveCapacity();
      const result = await read(`/api/bridge/ship/${scope.shipID}/bays?keys=drone`);
      const bay = Array.isArray(result.bays)
        ? result.bays.find((row: { key?: unknown } | null) => row?.key === "drone")
        : null;
      const used = number(bay?.capacity?.used);
      if (
        result.shipID !== scope.shipID ||
        result.activeShipID !== scope.shipID ||
        bay?.error !== null ||
        !Number.isFinite(used) ||
        used < 0
      )
        throw Error("The active ship's Drone Bay usage could not be verified.");
      // GetCapacity can already include the returning flight. Count its volume
      // only once, and keep any reservation that the bay read reports.
      const reserved = state.aboard.reduce((used, row) => used + row.quantity * volume(row.typeID), 0);
      return Math.max(0, capacity - Math.max(reserved, used));
    }

    type Location = typeof from | typeof shipBay;
    const transfer = async (itemID: number, qty: number, origin: Location, destination: Location) => {
      await dock();
      beforeTransfer();
      let failure: unknown, applied: boolean | undefined;
      try {
        // The docked transfer route checks both inventories. Its expectedScope
        // option is for in-space transfers.
        applied = (await read("/api/bridge/inventory/transfer", {
          itemIDs: [itemID], qty, from: origin, to: destination,
        })).applied;
      } catch (error) {
        failure = error;
      }
      await dock();
      state = await drones(true);
      return { applied, failure };
    };

    state = await drones(true);
    effectiveCapacity();
    const sourceLabel = miningSupplySourceLabel(source);
    for (const { itemID } of state.stowed) {
      const stack = state.stowed.find((row) => row.itemID === itemID);
      if (!stack) continue;
      const { typeID, quantity } = stack;
      const qty = Math.min(quantity, difference(typeID));
      if (qty <= 0) continue;
      if (stock.some((row) => row.itemID === itemID))
        throw Error("A drone is listed in both the Drone Bay and the selected stock.");

      const stowedBefore = count(state.stowed, typeID);
      const { applied, failure } = await transfer(itemID, qty, shipBay, from);
      const remaining = state.stowed.find((row) => row.itemID === itemID);
      const removed = stowedBefore - count(state.stowed, typeID);
      const selected = quantity - (remaining?.quantity ?? 0);
      const description = `${qty} ${label(typeID)} to ${sourceLabel}`;
      if (applied === false && removed === 0 && selected === 0)
        throw Error(`The inventory declined the return of ${description}.`);

      const stockAfter = await readStock();
      const landed = stockAfter.some((row) =>
        row.itemID === itemID && row.typeID === typeID && row.quantity === qty,
      );
      const gained = count(stockAfter, typeID) - count(stock, typeID);
      if (
        removed !== qty || selected !== qty || (remaining && remaining.typeID !== typeID) ||
        (!landed && gained !== qty)
      ) {
        const detail = failure instanceof Error ? ` ${failure.message}` : "";
        throw Error(`The return of ${description} could not be confirmed.${detail}`, { cause: failure });
      }
      stock = stockAfter;
    }

    for (const [typeID, target] of targets) {
      available.set(typeID, count(stock, typeID));
      for (const stack of stock.filter((row) => row.typeID === typeID)) {
        const current = count(state.aboard, typeID);
        if (current >= target) break;
        const fit = Math.floor(await freeRoom() / volume(typeID) + 1e-7);
        const wanted = Math.min(target - current, stack.quantity);
        const qty = Math.min(wanted, fit);
        if (qty <= 0) {
          issues.push("Drone Bay has no room for more " + label(typeID) + ".");
          break;
        }
        if (qty < wanted)
          issues.push("Drone Bay has room for only " + qty + " more " + label(typeID) + ".");
        const { applied, failure } = await transfer(stack.itemID, qty, from, shipBay);
        const gained = count(state.aboard, typeID) - current;
        const refusal = failure as { code?: string; status?: number } | undefined;
        const stackGone = refusal?.status === 409 && refusal.code === "ITEMS_NOT_AT_SOURCE";
        if (gained === 0 && (applied === false || stackGone)) {
          if (stackGone) available.set(typeID, (available.get(typeID) ?? 0) - stack.quantity);
          else issues.push("The inventory declined the transfer of " + label(typeID) + ".");
          continue;
        }
        if (gained !== qty)
          throw Error("The transfer of " + label(typeID) + " could not be confirmed. Check the Drone Bay.", {
            cause: failure,
          });
        available.set(typeID, (available.get(typeID) ?? 0) - gained);
        if (qty < wanted) break;
      }
    }
  }

  for (const typeID of new Set(state.aboard.map((row) => row.typeID))) {
    const excess = difference(typeID);
    if (excess <= 0) continue;
    const stowed = Math.min(excess, count(state.stowed, typeID));
    if (stowed) issues.push(`The Drone Bay holds ${stowed} extra ${label(typeID)} for this fitting.`);
    if (excess > stowed)
      issues.push(`This ship controls ${excess - stowed} extra ${label(typeID)} still in space.`);
  }

  return {
    targets: [...targets].map(([typeID, target]) => {
      const current = count(state.aboard, typeID);
      const deficit = Math.max(0, target - current);
      return {
        typeID, name: label(typeID), target, current, deficit, available: available.get(typeID) ?? 0,
        mode: "TOTAL_ABOARD" as const, eligibleFlags: [droneFlag], required: false,
        state: deficit === 0 ? "FULL" : current === 0 ? "MISSING" : "LOW",
      };
    }),
    issues,
  };
}
