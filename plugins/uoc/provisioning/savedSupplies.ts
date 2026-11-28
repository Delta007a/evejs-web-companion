import { boundDogma, getShipBays, decodeShipBays } from "../../../web/src/plugin-api/flying.ts";
import type { PluginRunContext } from "../../../web/src/plugin-api/backend.ts";
import { checkedInventory } from "../shared/nativeInventory.ts";
import { fittingItems } from "../shared/savedFitting.ts";
import { unwrapLong } from "../shared/wire.ts";
import { stockRows, stockSource } from "./existingHull.ts";

type Read = (path: string, body?: unknown) => Promise<any>;
type Target = {
  typeID: number;
  name: string;
  target: number;
  current: number;
  deficit: number;
  mode: "TOTAL_ABOARD" | "CARRIED_SPARES";
  eligibleFlags: number[];
  state: "FULL" | "LOW" | "MISSING";
};
type SlotCharge = { typeID: number; quantity: number };
type Slot = { id: number; typeID: number; flag: number; charge: SlotCharge | undefined };
type TypeFacts = {
  categoryID: number | null;
  groupID: number | null;
  attributes: [number, number | null][];
};
const cargo = 5,
  ammoHold = 143;
const capacity = 38,
  size = 128,
  volume = 161;
const groups = [604, 605, 606, 609, 610];
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isCharge = (target: Target) => target.eligibleFlags.includes(ammoHold);

function supplyTargets(review: any): Target[] {
  const { targets, supplies } = review.status ?? {},
    declared = review.contract?.supplies;
  if (
    !Array.isArray(targets) ||
    !Array.isArray(declared) ||
    targets.length !== declared.length ||
    !["FULL", "LOW", "MISSING"].includes(supplies) ||
    targets.some(
      (t) =>
        !t ||
        !positive(t.typeID) ||
        !positive(t.target) ||
        !Number.isSafeInteger(t.current) ||
        t.current < 0 ||
        typeof t.name !== "string" ||
        !["CARRIED_SPARES", "TOTAL_ABOARD"].includes(t.mode) ||
        !Array.isArray(t.eligibleFlags) ||
        !declared.some(
          (d: Target) =>
            d.typeID === t.typeID &&
            d.target === t.target &&
            d.mode === t.mode &&
            JSON.stringify(d.eligibleFlags) === JSON.stringify(t.eligibleFlags),
        ),
    ) ||
    new Set(targets.map((t) => t.typeID)).size !== targets.length
  )
    throw Error("Saved fitting supply quantities could not be verified.");
  return targets.map((t) => ({ ...t, deficit: Math.max(0, t.target - t.current) }));
}

const state = (quantity: number, target: number) =>
  quantity >= target ? "FULL" : quantity === 0 ? "MISSING" : "LOW";
const attribute = (facts: TypeFacts | undefined, id: number) =>
  facts?.attributes.find(([key]) => key === id)?.[1] ?? 0;

async function readTypeFacts(read: Read, types: number[]): Promise<Map<number, TypeFacts>> {
  const found = new Map<number, TypeFacts>();
  for (let offset = 0; offset < types.length; offset += 50) {
    const batch = types.slice(offset, offset + 50);
    const result = await read(`/api/client-data/dogma-types?typeIDs=${batch.join(",")}`);
    if (result.available !== true) throw Error("Charge compatibility data is unavailable.");
    for (const typeID of batch) {
      const type = result.types?.[typeID];
      if (!Array.isArray(type?.attributes))
        throw Error(`Charge compatibility data for type ${typeID} is unavailable.`);
      found.set(typeID, type);
    }
  }
  return found;
}

/** Use the Dogma groups and size for the module, with EveJS's one-unit fallback if capacity is absent. */
function magazine(facts: Map<number, TypeFacts>, moduleType: number, chargeType: number): number {
  const module = facts.get(moduleType),
    charge = facts.get(chargeType);
  if (
    charge?.categoryID !== 8 ||
    !positive(charge.groupID) ||
    !groups.some((id) => attribute(module, id) === charge.groupID)
  )
    return 0;
  const chargeSize = attribute(module, size);
  if (chargeSize > 0 && attribute(charge, size) !== chargeSize) return 0;
  const space = attribute(module, capacity),
    unit = attribute(charge, volume);
  return space > 0 && unit > 0 ? Math.floor(space / unit + 1e-7) : 1;
}

function linkedModules(raw: unknown): Set<number> {
  const banks = Array.isArray(raw) ? raw[2] : null;
  if (banks?.type !== "dict" || !Array.isArray(banks.entries))
    throw Error("Weapon grouping could not be verified.");
  const linked = new Set<number>();
  for (const [master, members] of banks.entries) {
    const slaves = Array.isArray(members)
      ? members
      : members?.type === "list"
        ? members.items
        : null;
    if (!Array.isArray(slaves)) throw Error("Weapon grouping could not be verified.");
    for (const item of [master, ...slaves]) {
      const id = Number(unwrapLong(item));
      if (!positive(id)) throw Error("A grouped module identity is unreadable.");
      linked.add(id);
    }
  }
  return linked;
}

/** Finish the already verified ship using only the reviewed fitting and stock. */
export async function applySavedSupplies(
  run: Pick<PluginRunContext, "baseUrl" | "fetch">,
  read: Read,
  input: { providerCharacterID: number; corporationID: number; fittingID: number; source: unknown },
  final: any,
  readFinal: () => Promise<any>,
  beforeWrite: () => void,
) {
  const { shipID, characterID, corporationID, locationID } = final.context;
  const definition = final.contract.definition;
  const policy = final.contract.supplyPolicyFingerprint;
  const structural = final.contract.structural as [number, number, number][];
  const targets = supplyTargets(final),
    charges = targets.filter(isCharge);
  const options = { baseUrl: run.baseUrl, fetch: run.fetch };
  const ask = async (service: string, method: string, args: unknown[], extra: object = {}) =>
    (await read("/api/bridge/call", { service, method, args, kwargs: null, pilot: true, ...extra }))
      .result;
  const assertDock = async () => {
    const { flight } = await read("/api/bridge/flight/status");
    if (flight?.docked !== true || flight.shipID !== shipID || flight.stationID !== locationID)
      throw Error("The active ship or dock changed during saved supply loading.");
  };
  const readHolds = async () => {
    await ask("invCache", "InvalidateLocationCache", [shipID], { confirm: true });
    const rows = (
      await Promise.all(
        [cargo, ammoHold].map(async (flag) => {
          const listed = checkedInventory(await ask("invbroker", "List", [flag], { of: shipID }));
          if (
            listed.some(
              (row) =>
                row.ownerID !== characterID || row.locationID !== shipID || row.flagID !== flag,
            )
          )
            throw Error("Charge cargo does not belong to the verified ship and hold.");
          return listed;
        }),
      )
    ).flat();
    if (new Set(rows.map((row) => row.itemID)).size !== rows.length)
      throw Error("Charge cargo does not belong to the verified ship.");
    return rows;
  };
  const observe = async () => {
    await assertDock();
    const { allInfo } = await boundDogma(options);
    const dogma = allInfo.value;
    if (
      allInfo.error ||
      !dogma ||
      Number(dogma.activeShipID) !== shipID ||
      Number(dogma.characterID) !== characterID
    )
      throw Error("The fitted modules and their charges could not be verified on the held ship.");
    const fitted = new Map<number, Slot>();
    const loaded = dogma.ships.filter((item) => item.sublocation || item.categoryID === 8);
    for (const [flag, typeID] of structural) {
      const modules = dogma.ships.filter(
        (item) =>
          item.flagID === flag &&
          item.typeID === typeID &&
          !item.sublocation &&
          Number(item.locationID) === shipID &&
          Number(item.ownerID) === characterID,
      );
      const id = Number(modules[0]?.itemID);
      if (modules.length !== 1 || !positive(id))
        throw Error(`The exact fitted module in slot ${flag} is unreadable.`);
      const entries = loaded.filter(
        (item) => item.flagID === flag && Number(item.locationID) === shipID,
      );
      // In station GetAllInfo can describe the same charge with both an item
      // row and a sublocation. Attribute 805 on the sublocation follows reloads.
      const sublocations = entries.filter((item) => item.sublocation);
      const active = (sublocations.length ? sublocations : entries).flatMap((entry) => {
        const counts = entry.attributes.filter((a) => a.attributeID === 805);
        const quantity = entry.stacksize ?? (entry.quantity === -1 ? 1 : entry.quantity);
        const observed = counts.length ? counts[0]!.value : entry.sublocation ? null : quantity;
        if (
          counts.length > 1 ||
          !positive(entry.typeID) ||
          (entry.ownerID !== null && Number(entry.ownerID) !== characterID) ||
          typeof observed !== "number" ||
          !Number.isSafeInteger(observed) ||
          observed < 0
        )
          throw Error(`Loaded charge in slot ${flag} is unreadable.`);
        return observed > 0 ? [{ typeID: entry.typeID, quantity: observed }] : [];
      });
      if (active.length > 1) throw Error(`Multiple loaded charges in slot ${flag} are ambiguous.`);
      fitted.set(flag, { id, typeID, flag, charge: active[0] });
    }
    return { fitted, linked: linkedModules(dogma.shipState), holds: await readHolds() };
  };
  let observation = charges.length ? await observe() : null;
  let native = final;
  const carried = (typeID: number) =>
    observation?.holds.reduce((sum, row) => sum + (row.typeID === typeID ? row.quantity : 0), 0) ??
    0;
  const loaded = (typeID: number) =>
    [...(observation?.fitted.values() ?? [])].reduce(
      (sum, slot) => sum + (slot.charge?.typeID === typeID ? slot.charge.quantity : 0),
      0,
    );
  const actualTargets = () =>
    supplyTargets(native).map((t) => {
      if (!isCharge(t)) return t;
      const current = carried(t.typeID) + loaded(t.typeID);
      return {
        ...t,
        mode: "TOTAL_ABOARD" as const,
        current,
        deficit: Math.max(0, t.target - current),
        state: state(current, t.target),
      };
    });
  const recheck = async () => {
    native = await readFinal();
    if (
      native.contract.definitionFingerprint !== final.contract.definitionFingerprint ||
      native.contract.supplyPolicyFingerprint !== policy
    )
      throw Error("The saved fitting supply policy changed during verification.");
    if (charges.length) observation = await observe();
  };

  if (actualTargets().some((t) => t.deficit > 0)) {
    const stock = await read("/api/bridge/provisioning/review", input);
    if (
      JSON.stringify(stock.context) !== JSON.stringify(final.context) ||
      JSON.stringify(stock.source?.pin) !== JSON.stringify(final.source.pin) ||
      typeof final.contract.definitionFingerprint !== "string" ||
      typeof policy !== "string" ||
      stock.contract?.definitionFingerprint !== final.contract.definitionFingerprint ||
      stock.contract?.supplyPolicyFingerprint !== policy ||
      stock.status?.equipment !== "VERIFIED"
    )
      throw Error("The active ship, fitting or supply source changed before replenishment.");
    if (
      stock.canApply !== true ||
      typeof stock.reviewID !== "string" ||
      typeof stock.reviewHash !== "string"
    )
      throw Error("The selected source is unavailable for saved supply replenishment.");
    const nativeTargets = supplyTargets(stock);
    const corrected = actualTargets().some(
      (t) => nativeTargets.find((n) => n.typeID === t.typeID)?.deficit !== t.deficit,
    );
    if (!corrected) {
      beforeWrite();
      const receipt = await read("/api/bridge/provisioning/replenish", {
        reviewID: stock.reviewID,
        reviewHash: stock.reviewHash,
        confirm: true,
      }).catch((error) =>
        read("/api/bridge/provisioning/reconcile", { operationID: stock.reviewID }).catch(() => {
          throw error;
        }),
      );
      if (
        receipt.operationID !== stock.reviewID ||
        !["COMPLETE", "RECONCILED"].includes(receipt.state)
      )
        throw Error(
          `Saved supply replenishment ${stock.reviewID} requires review. No transfer was replayed.`,
        );
      await recheck();
    } else {
      // Replenish targets the hold for cargo-only charges. Where some are already
      // loaded, send only the exact remaining deficit through the same inventory Add.
      const facts = await readTypeFacts(
        read,
        targets.map((t) => t.typeID),
      );
      for (const original of actualTargets()) {
        let target = original;
        while (target.deficit > 0) {
          stockSource(native);
          if (native.source.access.take !== true)
            throw Error("The selected stock division no longer allows Take.");
          const source = stockRows(native).find(
            (row) => row.typeID === target.typeID && !row.singleton,
          );
          if (!source) break;
          const unit = attribute(facts.get(target.typeID), volume);
          if (!(unit > 0)) throw Error(`The volume of ${target.name} could not be verified.`);
          const keys = [ammoHold, 133, cargo]
            .filter((flag) => target.eligibleFlags.includes(flag))
            .map((flag) => (flag === ammoHold ? "ammo" : flag === 133 ? "fuel" : "cargo"));
          const bays = decodeShipBays((await getShipBays(shipID, options, keys)).bays);
          const bay = keys
            .map((key) => bays.find((b) => b.key === key))
            .find(
              (b) =>
                b?.present === true &&
                !b.error &&
                b.capacity &&
                b.capacity.capacity - b.capacity.used >= unit - 1e-7,
            );
          if (!bay?.capacity) break;
          const quantity = Math.min(
            target.deficit,
            source.quantity,
            Math.floor((bay.capacity.capacity - bay.capacity.used) / unit + 1e-7),
          );
          if (!positive(quantity)) break;
          const flag = bay.key === "ammo" ? ammoHold : bay.key === "fuel" ? 133 : cargo;
          await assertDock();
          beforeWrite();
          const refusal = await ask("invbroker", "Add", [source.itemID, source.locationID], {
            of: shipID,
            confirm: true,
            kwargs: { qty: quantity, flag },
          }).then(
            () => null,
            (error) => String(error?.message ?? error),
          );
          const before = target.current;
          await recheck();
          target = actualTargets().find((t) => t.typeID === original.typeID)!;
          if (target.current - before !== quantity)
            throw Error(
              refusal ?? `The exact replenishment of ${target.name} could not be verified.`,
            );
        }
      }
    }
  }

  const problems: string[] = [];
  const checks: {
    flagID: number;
    typeID: number;
    name: string;
    target: number;
    current: number;
    state: Target["state"];
  }[] = [];
  if (observation) {
    try {
      const explicit = new Map<number, { typeID: number; quantity: number }>();
      if (charges.some((t) => t.mode === "TOTAL_ABOARD")) {
        if (input.corporationID !== corporationID)
          throw Error("Saved slot charges require a fitting from the held pilot's corporation.");
        const fit = fittingItems(
          await ask("corpFittingMgr", "GetFittings", [input.corporationID]),
          {
            fittingID: input.fittingID,
            corporationID: input.corporationID,
            goalTypeID: final.contract.shipTypeID,
            fingerprint: definition.fingerprint,
          },
        );
        for (const [typeID, flag, quantity] of fit) {
          if (flag === cargo || !charges.some((t) => t.typeID === typeID)) continue;
          const saved = explicit.get(flag);
          if (!observation.fitted.has(flag) || (saved && saved.typeID !== typeID))
            throw Error(
              `The fitting does not specify one charge type for an installed module in slot ${flag}.`,
            );
          explicit.set(flag, { typeID, quantity: (saved?.quantity ?? 0) + quantity });
        }
      }
      const facts = await readTypeFacts(read, [
        ...new Set([...structural.map(([, id]) => id), ...charges.map((t) => t.typeID)]),
      ]);
      const slots = [...observation.fitted.values()].sort(
        (a, b) =>
          Number(explicit.has(b.flag)) - Number(explicit.has(a.flag)) ||
          Number(!!a.charge) - Number(!!b.charge) ||
          a.flag - b.flag,
      );
      for (const [i, expected] of slots.entries()) {
        const saved = explicit.get(expected.flag);
        const slot = observation.fitted.get(expected.flag);
        if (!slot || slot.id !== expected.id)
          throw Error("An installed module changed during saved supply loading.");
        const compatible = charges.filter(
          (t) => t.mode === "CARRIED_SPARES" && magazine(facts, slot.typeID, t.typeID) > 0,
        );
        const available = (t: Target) =>
          Math.min(carried(t.typeID), Math.max(0, t.target - loaded(t.typeID)));
        const chosen = saved
          ? charges.find((t) => t.typeID === saved.typeID)
          : (compatible.find((t) => t.typeID === slot.charge?.typeID) ??
            compatible.find((t) => available(t) > 0) ??
            compatible[0]);
        if (!chosen) continue;
        const max = magazine(facts, slot.typeID, chosen.typeID);
        if (!max) {
          problems.push(
            `${chosen.name} is incompatible with the fitted module in slot ${slot.flag}.`,
          );
          continue;
        }
        const inSlot = (slot: Slot) =>
          slot.charge?.typeID === chosen.typeID ? slot.charge.quantity : 0;
        const initial = inSlot(slot);
        // Give other compatible empty modules a share when the fit carries less than full magazines.
        const peers = slots
          .slice(i + 1)
          .filter(
            (s) =>
              !explicit.has(s.flag) && !s.charge && magazine(facts, s.typeID, chosen.typeID) > 0,
          ).length;
        const stock = available(chosen);
        const share = Math.max(1, Math.floor(stock / (peers + 1)));
        const topUp = Math.max(0, Math.min(max - initial, share, stock));
        const quantity = saved ? Math.min(max, saved.quantity) : initial + topUp;
        const need = Math.max(0, quantity - initial);
        if (need && observation.linked.has(slot.id)) {
          problems.push(
            `Slot ${slot.flag} is linked to a weapon bank. Ungroup it before loading its saved charges.`,
          );
          continue;
        }
        for (const flag of [ammoHold, cargo]) {
          const current = observation.fitted.get(slot.flag);
          if (!current || current.id !== slot.id)
            throw Error("An installed module changed during saved supply loading.");
          let remaining = quantity - inSlot(current);
          if (remaining <= 0) break;
          const selected = observation.holds.filter(
            (r) => r.flagID === flag && r.typeID === chosen.typeID,
          );
          const ids: number[] = [];
          let amount = 0;
          for (const row of selected) {
            const qty = Math.min(remaining, row.quantity);
            if (qty < row.quantity) {
              // LoadAmmo fills from the named stacks. Use the same exact split as
              // the client's Shift-drop fitting action to leave the rest in its hold.
              await assertDock();
              beforeWrite();
              const split = await ask("invbroker", "Add", [row.itemID, shipID], {
                of: shipID,
                confirm: true,
                kwargs: { qty, flag },
              });
              const id = Number(unwrapLong(split));
              const splitRows = await readHolds();
              if (
                !positive(id) ||
                id === row.itemID ||
                !splitRows.some(
                  (r) =>
                    r.itemID === id &&
                    r.typeID === chosen.typeID &&
                    r.flagID === flag &&
                    r.quantity === qty,
                )
              )
                throw Error(
                  `The exact stack of ${chosen.name} for slot ${slot.flag} could not be split.`,
                );
              ids.push(id);
            } else ids.push(row.itemID);
            remaining -= qty;
            amount += qty;
            if (remaining === 0) break;
          }
          if (!ids.length) continue;
          const heldBefore = carried(chosen.typeID);
          await assertDock();
          beforeWrite();
          // The same pilot-bound native call as flow.flying.loadAmmoFrom in Defender.
          // An empty reply is also returned on refusal, so only readback proves the load.
          const refusal = await ask("dogmaIM", "LoadAmmo", [shipID, slot.id, ids, shipID], {
            confirm: true,
          }).then(
            () => null,
            (error) => String(error?.message ?? error),
          );
          observation = await observe();
          const after = observation.fitted.get(slot.flag);
          if (
            !after ||
            after.id !== slot.id ||
            inSlot(after) - inSlot(current) !== amount ||
            heldBefore - carried(chosen.typeID) !== amount
          )
            throw Error(
              refusal ?? `EveJS did not confirm loading ${chosen.name} into slot ${slot.flag}.`,
            );
        }
        const current = inSlot(observation.fitted.get(slot.flag)!);
        const target = Math.max(1, quantity);
        checks.push({
          flagID: slot.flag,
          typeID: chosen.typeID,
          name: chosen.name,
          target,
          current,
          state: state(current, target),
        });
        if (current < target)
          problems.push(
            `${chosen.name} in slot ${slot.flag} is below target (${current}/${target}).`,
          );
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  const status = actualTargets();
  const shortage = status.filter((t) => t.deficit > 0);
  if (shortage.length)
    problems.push(
      `Saved supplies below target: ${shortage.map((t) => `${t.name} ${t.current}/${t.target}`).join(", ")}. Check stock and hold capacity.`,
    );
  return {
    finalStatus: {
      ...(native.status as object),
      targets: status,
      supplies: status.every((t) => t.state === "FULL")
        ? "FULL"
        : status.every((t) => t.state === "MISSING")
          ? "MISSING"
          : "LOW",
      charges: checks,
    },
    reason: problems.length ? problems.join(" ") : null,
  };
}
