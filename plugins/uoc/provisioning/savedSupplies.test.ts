import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { applySavedSupplies } from "./savedSupplies.ts";

type Loaded = { typeID: number; quantity: number };
type Module = { flag: number; typeID: number; id: number; charge?: Loaded };
type Stack = Loaded & { itemID: number; flag: number };
type SavedItem = [typeID: number, flag: number, quantity: number];
const dict = (entries: unknown[] = []) => ({ type: "dict", entries });
const list = (items: unknown[] = []) => ({ type: "list", items });
const keyVal = (record: Record<string, unknown>) => ({
  type: "object",
  name: "util.KeyVal",
  args: dict(Object.entries(record)),
});
const packed = (fields: Record<string, unknown>) => ({ type: "packedrow", fields });
// Type IDs, sizes and volumes from the installed EveJS catalogue.
const moduleType = (capacity: number, group: number, size = 0, groupAttribute = 604) => ({
  categoryID: 7,
  attributes: [
    [38, capacity],
    [groupAttribute, group],
    [128, size],
  ],
});
const chargeType = (groupID: number, volume: number, size = 0) => ({
  categoryID: 8,
  groupID,
  attributes: [
    [161, volume],
    [128, size],
  ],
});
const data: Record<number, any> = {
  454: moduleType(1, 86, 1),
  484: moduleType(0.5, 83, 1),
  10629: moduleType(0.1875, 387),
  3566: moduleType(12, 87),
  1977: moduleType(1, 907, 1),
  17912: moduleType(10, 482, 1),
  33076: moduleType(0.08, 916, 0, 605),
  242: chargeType(86, 1, 1),
  250: chargeType(86, 1, 2),
  178: chargeType(83, 0.0025, 1),
  179: chargeType(83, 0.0025, 1),
  266: chargeType(387, 0.005),
  11283: chargeType(87, 6, 2),
  29001: chargeType(907, 1, 1),
  18066: chargeType(482, 6, 1),
  28668: chargeType(916, 0.01),
};
const characterID = 7,
  shipID = 55,
  locationID = 600,
  corporationID = 98,
  fittingID = 5,
  shipTypeID = 32874;
const moduleAt = (flag: number, typeID: number, charge?: Loaded): Module => ({
  flag,
  typeID,
  id: 1000 + flag,
  charge,
});

function fleetFixture({
  modules,
  fit,
  aboard = [],
  warehouse = [],
  response = "ok",
  bank = [],
  otherCorp = false,
}: {
  modules: Module[];
  fit: SavedItem[];
  aboard?: Stack[];
  warehouse?: Stack[];
  response?: "ok" | "refuse" | "lost" | "lost-after";
  bank?: number[];
  otherCorp?: boolean;
}) {
  let itemID = 5000;
  const add = (stack: Stack) => {
    aboard.push(stack);
  };
  const writes: { method: string; args?: any[]; kwargs?: any }[] = [];
  const fitCorp = otherCorp ? 99 : corporationID;
  const definition = {
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify([
          shipTypeID,
          [...fit, ...modules.map((m) => [m.typeID, m.flag, 1])].sort(
            (a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!,
          ),
        ]),
      )
      .digest("hex"),
  };
  const input = {
    providerCharacterID: otherCorp ? 8 : characterID,
    corporationID: fitCorp,
    fittingID,
    source: { kind: "corp", corporationID, division: 1 },
  };
  const inventoryRow = (stack: Stack, ownerID = characterID, location = shipID) =>
    packed({
      ...stack,
      flagID: stack.flag,
      ownerID,
      locationID: location,
      categoryID: 8,
      stacksize: stack.quantity,
    });
  const review = () => {
    const contract = {
      definition,
      definitionFingerprint: "definition",
      supplyPolicyFingerprint: "policy",
      shipTypeID,
      structural: modules.map((m) => [m.flag, m.typeID, 1]),
      supplies: [...new Set(fit.map(([id]) => id))].map((typeID) => {
        const sameType = fit.filter(([id]) => id === typeID);
        const target = sameType.reduce((total, entry) => total + entry[2], 0);
        return {
          name: typeID === 242 ? "Standard S" : `Charge ${typeID}`,
          typeID,
          target,
          eligibleFlags: [5, 143],
          mode: sameType.some(([, flag]) => flag !== 5) ? "TOTAL_ABOARD" : "CARRIED_SPARES",
        };
      }),
    };
    const targets = contract.supplies.map((t) => {
      const current =
        aboard.reduce((sum, stack) => sum + (stack.typeID === t.typeID ? stack.quantity : 0), 0) +
        (t.mode === "TOTAL_ABOARD"
          ? modules.reduce(
              (sum, m) => sum + (m.charge?.typeID === t.typeID ? m.charge.quantity : 0),
              0,
            )
          : 0);
      return {
        ...t,
        current,
        deficit: Math.max(0, t.target - current),
        state: current >= t.target ? "FULL" : current === 0 ? "MISSING" : "LOW",
      };
    });
    return {
      contract,
      context: { characterID, shipID, locationID, corporationID },
      status: {
        equipment: "VERIFIED",
        supplies: targets.every((t) => t.deficit === 0)
          ? "FULL"
          : targets.every((t) => t.current === 0)
            ? "MISSING"
            : "LOW",
        targets,
      },
      source: {
        pin: {
          descriptor: input.source,
          dockedLocationID: locationID,
          flag: 115,
          ownerID: corporationID,
          locationID: 800,
          office: "corpOffice:800",
        },
        access: { query: true, take: true },
        rows: warehouse.map((r) => ({
          ...r,
          flagID: r.flag,
          ownerID: corporationID,
          locationID: 800,
          singleton: false,
        })),
      },
    };
  };
  const read = async (path: string, body?: any): Promise<any> => {
    const url = new URL(path, "http://test");
    switch (url.pathname) {
      case "/api/bridge/flight/status":
        return { flight: { docked: true, shipID, stationID: locationID } };
      case "/api/client-data/dogma-types":
        return {
          available: true,
          types: Object.fromEntries(
            url.searchParams
              .get("typeIDs")!
              .split(",")
              .map((id) => [id, data[Number(id)]]),
          ),
        };
      case "/api/bridge/provisioning/review":
        assert.deepEqual(body, input);
        return { ...review(), canApply: true, reviewID: "supply", reviewHash: "stock" };
      case "/api/bridge/provisioning/replenish":
        throw Error("Native Replenish would exceed the reviewed total in this fixture.");
      case "/api/bridge/ship/55/bays":
        return {
          shipID,
          bays: [
            { key: "cargo", present: true, items: [], capacity: { used: 5, capacity: 100 } },
            { key: "ammo", present: true, items: [], capacity: { used: 0, capacity: 100 } },
          ],
        };
      case "/api/bridge/bound-dogma": {
        const entries: unknown[] = [];
        for (const m of modules) {
          entries.push([
            m.id,
            keyVal({
              itemID: m.id,
              invItem: packed({
                itemID: m.id,
                flagID: m.flag,
                typeID: m.typeID,
                ownerID: characterID,
                locationID: shipID,
                categoryID: 7,
              }),
            }),
          ]);
          if (!m.charge) continue;
          const tuple = [shipID, m.flag, m.charge.typeID];
          entries.push([
            tuple,
            keyVal({ itemID: tuple, attributes: dict([[805, m.charge.quantity]]) }),
          ]);
          // The docked native reply can have both representations for one charge.
          entries.push([
            m.id + 1000,
            keyVal({
              itemID: m.id + 1000,
              invItem: inventoryRow({ ...m.charge, flag: m.flag, itemID: m.id + 1000 }),
            }),
          ]);
        }
        return {
          reads: {
            GetAllInfo: {
              result: keyVal({
                activeShipID: shipID,
                charInfo: [dict([[characterID, keyVal({ itemID: characterID })]]), null],
                shipInfo: dict(entries),
                shipState: [
                  dict(),
                  dict(),
                  dict(bank.length ? [[bank[0], list(bank.slice(1))]] : []),
                  dict(),
                ],
              }),
            },
          },
        };
      }
      case "/api/bridge/call":
        assert.equal(body.pilot, true);
        break;
      default:
        throw Error(`Unexpected read ${path}`);
    }
    const { method, args, kwargs } = body;
    switch (method) {
      case "GetFittings":
        assert.deepEqual(args, [corporationID]);
        return {
          result: dict([
            [
              fittingID,
              keyVal({
                fittingID,
                ownerID: fitCorp,
                shipTypeID,
                fitData: list([...fit, ...modules.map((m) => [m.typeID, m.flag, 1])]),
              }),
            ],
          ]),
        };
      case "InvalidateLocationCache":
        assert.deepEqual(args, [shipID]);
        return { result: null };
      case "List":
        assert.equal(body.of, shipID);
        return {
          result: list(aboard.filter((r) => r.flag === args[0]).map((r) => inventoryRow(r))),
        };
      case "Add": {
        assert.equal(body.of, shipID);
        assert.equal(body.confirm, true);
        writes.push({ method, args, kwargs });
        const rows = args[1] === shipID ? aboard : warehouse;
        const source = rows.find((r) => r.itemID === args[0])!;
        assert.ok(source && source.quantity >= kwargs.qty && kwargs.qty > 0);
        if (args[1] === shipID) assert.equal(kwargs.flag, source.flag);
        source.quantity -= kwargs.qty;
        if (!source.quantity) rows.splice(rows.indexOf(source), 1);
        const id = itemID++;
        add({ itemID: id, flag: kwargs.flag, typeID: source.typeID, quantity: kwargs.qty });
        return { result: { type: "long", value: String(id) } };
      }
      case "LoadAmmo": {
        assert.equal(body.confirm, true);
        assert.equal(args[0], shipID);
        assert.equal(args[3], shipID);
        writes.push({ method, args });
        if (response === "lost") throw Error("LoadAmmo response lost");
        if (response === "refuse") return { result: null };
        const m = modules.find((m) => m.id === args[1])!;
        const parts: Stack[] = args[2].map((id: number) => aboard.find((r) => r.itemID === id)!);
        assert.ok(
          m &&
            parts.length > 0 &&
            parts.every((r) => r && r.flag === parts[0]!.flag && r.typeID === parts[0]!.typeID),
        );
        const typeID = parts[0]!.typeID;
        let current = m.charge?.typeID === typeID ? m.charge.quantity : 0;
        if (m.charge && m.charge.typeID !== typeID)
          add({ ...m.charge, itemID: itemID++, flag: parts[0]!.flag });
        const max = Math.floor(
          data[m.typeID].attributes[0][1] / data[typeID].attributes[0][1] + 1e-7,
        );
        for (const part of parts) {
          const qty = Math.min(max - current, part.quantity);
          part.quantity -= qty;
          current += qty;
          if (!part.quantity) aboard.splice(aboard.indexOf(part), 1);
        }
        m.charge = { typeID, quantity: current };
        if (response === "lost-after") throw Error("LoadAmmo response lost after the transfer");
        return { result: null };
      }
      default:
        throw Error(`Unexpected native method ${method}`);
    }
  };
  const run = {
    baseUrl: "http://test",
    fetch: async (url: any) => Response.json({ ok: true, ...(await read(String(url))) }),
  };
  return {
    modules,
    aboard,
    warehouse,
    writes,
    apply: () =>
      applySavedSupplies(
        run,
        read,
        input,
        review(),
        async () => review(),
        () => {},
      ),
  };
}

test("Dragoon charges three beam lasers from the saved stack and does not replenish them a second time", async () => {
  const f = fleetFixture({
    modules: [27, 28, 29].map((flag) => moduleAt(flag, 454)),
    fit: [[242, 5, 3]],
    aboard: [{ itemID: 700, flag: 5, typeID: 242, quantity: 3 }],
  });
  const first = await f.apply();
  assert.equal(first.reason, null);
  assert.deepEqual(
    first.finalStatus.charges.map((c) => c.current),
    [1, 1, 1],
  );
  assert.deepEqual(f.aboard, []);
  assert.equal(first.finalStatus.targets[0]?.current, 3);
  assert.equal(f.writes.filter((w) => w.method === "LoadAmmo").length, 3);
  assert.equal(f.writes.filter((w) => w.method === "Add").length, 2);
  const writes = f.writes.length;
  const again = await f.apply();
  assert.equal(again.reason, null);
  assert.equal(again.finalStatus.targets[0]?.current, 3);
  assert.equal(f.writes.length, writes);
});

test("native group, size and capacity load guns, launchers, boosters, scripts, miners and ancillary repairers", async () => {
  const modules = [
    moduleAt(27, 484),
    moduleAt(28, 10629),
    moduleAt(19, 3566),
    moduleAt(20, 1977),
    moduleAt(29, 17912),
    moduleAt(11, 33076),
    moduleAt(30, 454),
  ];
  const f = fleetFixture({
    modules,
    fit: [
      [178, 5, 205],
      [266, 5, 40],
      [11283, 5, 4],
      [29001, 5, 2],
      [18066, 5, 3],
      [28668, 5, 20],
      [250, 5, 2],
    ],
    aboard: [
      { itemID: 700, flag: 143, typeID: 178, quantity: 205 },
      { itemID: 701, flag: 5, typeID: 266, quantity: 40 },
      { itemID: 702, flag: 5, typeID: 11283, quantity: 4 },
      { itemID: 703, flag: 143, typeID: 29001, quantity: 2 },
      { itemID: 704, flag: 5, typeID: 18066, quantity: 3 },
      { itemID: 705, flag: 5, typeID: 28668, quantity: 20 },
      { itemID: 706, flag: 5, typeID: 250, quantity: 2 },
      { itemID: 707, flag: 5, typeID: 242, quantity: 1 },
    ],
  });
  const result = await f.apply();
  assert.equal(result.reason, null);
  assert.deepEqual(
    modules.map((m) => m.charge?.quantity),
    [200, 37, 2, 1, 1, 8, undefined],
  );
  assert.deepEqual(
    f.aboard.map((r) => [r.typeID, r.quantity, r.flag]),
    [
      [178, 5, 143],
      [266, 3, 5],
      [11283, 2, 5],
      [29001, 1, 143],
      [18066, 2, 5],
      [28668, 12, 5],
      [250, 2, 5],
      [242, 1, 5],
    ],
  );
});

test("explicit slot charge takes priority and only its saved quantity is loaded from a larger stack", async () => {
  const old = { typeID: 179, quantity: 10 };
  const modules = [moduleAt(27, 484, old)];
  const f = fleetFixture({
    modules,
    fit: [
      [178, 27, 5],
      [178, 5, 3],
      [179, 5, 10],
    ],
    aboard: [{ itemID: 700, flag: 5, typeID: 178, quantity: 8 }],
  });
  const result = await f.apply();
  assert.equal(result.reason, null);
  assert.deepEqual(modules[0]?.charge, { typeID: 178, quantity: 5 });
  assert.deepEqual(
    f.aboard.map((r) => [r.typeID, r.quantity]),
    [
      [178, 3],
      [179, 10],
    ],
  );
  assert.equal(f.writes[0]?.kwargs.qty, 5);
});

test("partial stock on a ready ship tops up only the deficit after counting loaded charges", async () => {
  const f = fleetFixture({
    modules: [
      moduleAt(27, 454, { typeID: 242, quantity: 1 }),
      moduleAt(28, 454),
      moduleAt(29, 454),
    ],
    fit: [[242, 5, 3]],
    warehouse: [{ itemID: 801, flag: 115, typeID: 242, quantity: 7 }],
  });
  const result = await f.apply();
  assert.equal(result.reason, null);
  assert.deepEqual(
    result.finalStatus.charges.map((c) => c.current),
    [1, 1, 1],
  );
  const withdraw = f.writes.filter((w) => w.method === "Add" && w.args?.[1] === 800);
  assert.equal(withdraw.length, 1);
  assert.deepEqual(withdraw[0]?.kwargs, { qty: 2, flag: 143 });
  assert.equal(f.warehouse[0]?.quantity, 5);
  assert.equal(f.aboard.length, 0);
});

test("an existing extra stack is not used after the saved quantity is already loaded", async () => {
  const f = fleetFixture({
    modules: [moduleAt(27, 454, { typeID: 242, quantity: 1 }), moduleAt(28, 454)],
    fit: [[242, 5, 1]],
    aboard: [{ itemID: 700, flag: 5, typeID: 242, quantity: 12 }],
  });
  const result = await f.apply();
  assert.match(result.reason ?? "", /slot 28 is below target/);
  assert.deepEqual(f.writes, []);
  assert.equal(f.aboard[0]?.quantity, 12);
});

for (const response of ["refuse", "lost", "lost-after"] as const)
  test(`LoadAmmo ${response} is decided by readback without resending`, async () => {
    const f = fleetFixture({
      response,
      modules: [moduleAt(27, 454)],
      fit: [[242, 5, 1]],
      aboard: [{ itemID: 700, flag: 5, typeID: 242, quantity: 1 }],
    });
    const result = await f.apply();
    assert.equal(f.writes.length, 1);
    if (response === "lost-after") {
      assert.equal(result.reason, null);
      assert.equal(result.finalStatus.charges[0]?.current, 1);
    } else {
      assert.match(
        result.reason ?? "",
        response === "lost" ? /response lost/ : /did not confirm loading Standard S/,
      );
      assert.equal(f.aboard[0]?.quantity, 1);
    }
  });

test("top-up can consume two holds using separate, verified native loads", async () => {
  const f = fleetFixture({
    modules: [moduleAt(27, 484, { typeID: 178, quantity: 1 })],
    fit: [[178, 5, 5]],
    aboard: [
      { itemID: 700, flag: 143, typeID: 178, quantity: 1 },
      { itemID: 701, flag: 5, typeID: 178, quantity: 3 },
    ],
  });
  const result = await f.apply();
  assert.equal(result.reason, null);
  assert.equal(result.finalStatus.charges[0]?.current, 5);
  assert.deepEqual(
    f.writes.map((w) => w.args?.[2]),
    [[700], [701]],
  );
});

test("a linked bank is preserved and an unavailable corporation slot definition is reported", async () => {
  const one = moduleAt(27, 454),
    two = moduleAt(28, 454);
  const bank = fleetFixture({
    modules: [one, two],
    fit: [[242, 5, 2]],
    bank: [one.id, two.id],
    aboard: [{ itemID: 700, flag: 5, typeID: 242, quantity: 2 }],
  });
  assert.match((await bank.apply()).reason ?? "", /linked to a weapon bank/);
  assert.deepEqual(bank.writes, []);
  const foreign = fleetFixture({
    modules: [moduleAt(27, 454)],
    fit: [[242, 27, 1]],
    otherCorp: true,
    aboard: [{ itemID: 701, flag: 5, typeID: 242, quantity: 1 }],
  });
  assert.match((await foreign.apply()).reason ?? "", /held pilot's corporation/);
  assert.deepEqual(foreign.writes, []);
});
