import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { decodeSpaceSnapshot } from "../bridge/space.ts";
import { createScriptRunner, type ScriptRunnerDeps } from "./scriptRunner.ts";
import { SCRIPT_MACROS } from "./scriptMacros.ts";
import type { ScriptObservation } from "./scriptConditions.ts";
import type { ScriptAction } from "./scriptDecide.ts";
import type { BotScript } from "../bots/botScript.ts";

const { createLootMemory, CONTAINER_LEASE_MS } = createRequire(import.meta.url)("../../../src/lootMemory.js");
const SYSTEM = 30000144;
const A = 80001;
const B = 80002;
const doc: BotScript = {
  format: "evejs-bot-script", version: 1, name: "hauler", notes: "",
  home: { entity: "station", id: 60001, name: "Home", systemName: null },
  interrupts: [], program: [{ id: "loot", kind: "macro", macro: "loot-containers", args: {} }],
};

function observation(ids = [A], distance = 10_000): ScriptObservation {
  return {
    inSpace: true, docked: false, inWarp: false,
    shieldRatio: 1, armorRatio: 1, hullRatio: 1, health: 1,
    oreHoldFraction: 0, holdEmpty: true, hostileOnGrid: false, dronesOut: false,
    snapshot: decodeSpaceSnapshot({
      inSpace: true, solarSystemID: SYSTEM, shipID: 1,
      ship: { itemID: 1, mode: "GOTO", position: { x: 0, y: 0, z: 0 } },
      entities: ids.map((itemID, index) => ({
        itemID, kind: "container", name: "Cargo Container", typeID: 23,
        position: { x: distance + index * 500, y: 0, z: 0 },
      })),
    }),
  };
}

function setup() {
  let clock = 0;
  const authority = createLootMemory({ now: () => clock });
  function hauler(session: string, initial = observation(), overrides: Partial<ScriptRunnerDeps> = {}) {
    let obs = initial;
    const issued: ScriptAction[] = [];
    const acquired: number[] = [];
    const runner = createScriptRunner({
      observe: async () => obs,
      issue: async (action) => { issued.push(action); },
      sleep: async () => {}, onProgress: () => {}, isSessionLost: () => false,
      refusalReason: (error) => String(error), registry: SCRIPT_MACROS,
      travelHome: () => { throw new Error("Unexpected home travel"); },
      containerClaims: {
        acquire: async (owner, system, item, renew) => {
          const result = authority.claimContainer(session, owner, system, item, renew);
          if (result) acquired.push(item);
          return result;
        },
        release: async (owner) => { authority.releaseClaims(session, owner); },
      },
      ...overrides,
    });
    runner.start(doc);
    return { runner, issued, acquired, setObs: (next: ScriptObservation) => { obs = next; } };
  }
  return { authority, hauler, advance: (ms: number) => { clock += ms; } };
}

async function ticks(runner: ReturnType<typeof createScriptRunner>, count = 12) {
  for (let i = 0; i < count; i++) await runner.tick();
}

test("two concurrent haulers, one can: exactly one approach and no refusal for contention", async () => {
  const s = setup();
  const one = s.hauler("one"), two = s.hauler("two");
  await Promise.all([one.runner.tick(), two.runner.tick()]);
  assert.deepEqual(one.issued, [{ kind: "approach", targetID: A }]);
  assert.deepEqual(two.issued, []);
  assert.deepEqual(two.runner.snapshot().refusals, []);
  assert.match(two.runner.snapshot().why!, /Other haulers/);
});

test("two concurrent haulers, two cans: nearest free candidates split the work", async () => {
  const s = setup();
  const one = s.hauler("one", observation([A, B])), two = s.hauler("two", observation([A, B]));
  await Promise.all([one.runner.tick(), two.runner.tick()]);
  assert.deepEqual(one.issued, [{ kind: "approach", targetID: A }]);
  assert.deepEqual(two.issued, [{ kind: "approach", targetID: B }]);
});

test("own lease renews through settle and approach waits for longer than its TTL", async () => {
  const s = setup();
  const one = s.hauler("one");
  await one.runner.tick();
  for (let i = 0; i < 8; i++) {
    s.advance(CONTAINER_LEASE_MS / 2);
    await one.runner.tick();
    assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), false);
  }
  assert.ok(one.acquired.length > 4);
});

test("successful loot releases the target", async () => {
  const s = setup();
  const one = s.hauler("one", observation([A], 100));
  await one.runner.tick();
  assert.deepEqual(one.issued, [{ kind: "lootContainer", containerID: A }]);
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
});

test("disappearance releases the claim on the next observation", async () => {
  const s = setup();
  const one = s.hauler("one");
  await one.runner.tick();
  one.setObs(observation([]));
  await ticks(one.runner);
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
});

test("expiry frees an abandoned target; a stale heartbeat cannot steal it back", async () => {
  const s = setup();
  const one = s.hauler("one");
  await one.runner.tick();
  s.advance(CONTAINER_LEASE_MS);
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
  await ticks(one.runner);
  assert.equal(one.issued.length, 1);
  assert.deepEqual(one.runner.snapshot().refusals, []);
});

for (const lifecycle of ["stop", "pause", "finish"] as const) {
  test(`${lifecycle} releases active claims`, async () => {
    const s = setup();
    const one = s.hauler("one");
    await one.runner.tick();
    if (lifecycle === "finish") {
      one.setObs({ ...observation(), holds: [{ key: "cargo", label: "Cargo", capacity: { capacity: 1, used: 1 }, items: [], present: true, error: null }] });
      await ticks(one.runner);
      assert.equal(one.runner.getStatus(), "stopped");
    } else one.runner[lifecycle]();
    assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
  });
}

for (const refusal of ["TargetTooFar", "temporary transfer refusal"]) {
  test(`${refusal} retains ownership during backoff and continued servicing`, async () => {
    const s = setup();
    const one = s.hauler("one", observation([A], 100), {
      issue: async () => { throw new Error(refusal); },
    });
    await one.runner.tick();
    for (let i = 0; i < 6; i++) {
      s.advance(10_000);
      await one.runner.tick();
      assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), false);
    }
    assert.ok(one.runner.snapshot().refusals.length > 0);
  });
}

test("unavailable authority fails closed and recovers without poisoning the ledger", async () => {
  const s = setup();
  let available = false;
  const one = s.hauler("one", observation(), { containerClaims: {
    acquire: async () => { if (!available) throw new Error("offline"); return true; },
    release: async () => {},
  } });
  await one.runner.tick();
  assert.deepEqual(one.issued, []);
  assert.deepEqual(one.runner.snapshot().refusals, []);
  available = true;
  await one.runner.tick();
  assert.equal(one.issued.length, 1);
});

test("a stop during acquisition releases even a late grant and issues nothing", async () => {
  const s = setup();
  let complete!: () => void;
  const waiting = new Promise<void>((resolve) => { complete = resolve; });
  const one = s.hauler("one", observation(), { containerClaims: {
    acquire: async (owner, system, item) => {
      await waiting;
      return s.authority.claimContainer("one", owner, system, item);
    },
    release: async (owner) => { s.authority.releaseClaims("one", owner); },
  } });
  const pending = one.runner.tick();
  await Promise.resolve();
  one.runner.stop();
  complete();
  await pending;
  assert.deepEqual(one.issued, []);
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
});

test("a stop during loot retains the claim until the outstanding action finishes", async () => {
  const s = setup();
  let complete!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => { complete = resolve; });
  const issuing = new Promise<void>((resolve) => { started = resolve; });
  const one = s.hauler("one", observation([A], 100), {
    issue: async () => { started(); await waiting; },
  });
  const pending = one.runner.tick();
  await issuing;
  one.runner.stop();
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), false);
  complete();
  await pending;
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
});

test("an until transition releases the old target before leaving the loot step", async () => {
  const s = setup();
  const one = s.hauler("one");
  one.runner.start({ ...doc, program: [{ id: "loot", kind: "macro", macro: "loot-containers", args: {}, until: { kind: "ore-hold-at-least", fraction: 0.9 } }] });
  await one.runner.tick();
  one.setObs({ ...observation(), oreHoldFraction: 1 });
  await ticks(one.runner);
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
});

test("an ambiguous acquisition is also released on stop", async () => {
  const s = setup();
  const one = s.hauler("one", observation(), { containerClaims: {
    acquire: async (owner, system, item) => {
      s.authority.claimContainer("one", owner, system, item);
      throw new Error("response lost");
    },
    release: async (owner) => { s.authority.releaseClaims("one", owner); },
  } });
  await one.runner.tick();
  assert.deepEqual(one.issued, []);
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), false);
  one.runner.stop();
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
});

test("a long loot action rechecks ownership between transfers and stops on lease loss", async () => {
  const s = setup();
  let transfers = 0;
  const one = s.hauler("one", observation([A], 100), {
    issue: async (_action, beforeTransfer) => {
      assert.ok(beforeTransfer);
      await beforeTransfer();
      transfers += 1;
      s.advance(CONTAINER_LEASE_MS);
      assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
      await beforeTransfer();
      transfers += 1;
    },
  });
  await one.runner.tick();
  assert.equal(transfers, 1);
  assert.deepEqual(one.runner.snapshot().refusals, []);
  assert.match(one.runner.snapshot().why!, /coordination/);
});

test("changing to the nearest eligible target relinquishes the previous one", async () => {
  const s = setup();
  const one = s.hauler("one", observation([A, B]));
  await one.runner.tick();
  one.setObs(observation([B, A]));
  await ticks(one.runner);
  assert.ok(one.issued.some((a) => a.kind === "approach" && a.targetID === B));
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, B), false);
});

test("session loss during renewal terminates and releases the run", async () => {
  const s = setup();
  let lost = false;
  const one = s.hauler("one", observation(), {
    isSessionLost: (error) => error instanceof Error && error.message === "session lost",
    containerClaims: {
      acquire: async (owner, system, item, renew) => {
        if (lost) throw new Error("session lost");
        return s.authority.claimContainer("one", owner, system, item, renew);
      },
      release: async (owner) => { s.authority.releaseClaims("one", owner); },
    },
  });
  await one.runner.tick();
  lost = true;
  await one.runner.tick();
  assert.equal(one.runner.getStatus(), "error");
  assert.equal(s.authority.claimContainer("two", "run", SYSTEM, A), true);
});

test("a runner without a claim authority cannot service containers", async () => {
  const s = setup();
  const one = s.hauler("one", observation(), { containerClaims: undefined });
  await one.runner.tick();
  assert.deepEqual(one.issued, []);
  assert.match(one.runner.snapshot().why!, /coordination/);
});
