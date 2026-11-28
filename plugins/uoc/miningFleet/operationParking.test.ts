import test from "node:test";
import assert from "node:assert/strict";
import { observeSettledInPlace } from "./operationParking.ts";
const transition = {
  phase: "ready",
  sessionStable: true,
  locationReady: true,
  sceneReady: true,
  egoReady: true,
  shipReady: true,
  boundContextReady: true,
};
function fixture() {
  let mode = "FOLLOW",
    clock = 1000,
    commands = 0,
    value: unknown = null,
    lose = false;
  const doc = {
      read: () => structuredClone(value),
      write: (v: unknown) => {
        value = structuredClone(v);
      },
    },
    run: any = {
      botID: "b",
      characterID: 1,
      baseUrl: "http://bff",
      fetch: async () =>
        Response.json({
          ok: true,
          flight: {
            shipID: 11,
            solarSystemID: 300,
            inSpace: true,
            docked: false,
            shipMode: mode,
            transition,
          },
        }),
    },
    session: any = {
      flow: {
        requestOptions: () => ({}),
        stopShip: async () => {
          commands++;
          if (lose) throw Error("unknown");
          mode = "STOP";
        },
      },
    };
  return {
    run,
    session,
    doc,
    now: () => clock,
    wait: async () => {
      clock += 1000;
    },
    stop: () => {
      mode = "STOP";
    },
    lose: () => {
      lose = true;
    },
    restore: () => { lose = false; },
    commands: () => commands,
  };
}
test("in-place Stop is durably fenced then resolved by exact native STOP", async () => {
  const f = fixture(),
    r = await observeSettledInPlace(
      f.run,
      f.session,
      11,
      () => {},
      f.doc,
      { operationID: "op", runID: "run" },
      f.now,
      f.wait,
    );
  assert.equal(r.inSpace, true);
  assert.equal(r.docked, false);
  assert.equal(f.commands(), 1);
  assert.equal((f.doc.read() as any).pending, null);
});
test("lost acknowledgement is never resent and a later native STOP reconciles", async () => {
  const f = fixture();
  f.lose();
  await assert.rejects(
    observeSettledInPlace(
      f.run,
      f.session,
      11,
      () => {},
      f.doc,
      { operationID: "op", runID: "run" },
      f.now,
      f.wait,
    ),
    /unresolved/,
  );
  assert.equal(f.commands(), 1);
  f.stop();
  await observeSettledInPlace(
    f.run,
    f.session,
    11,
    () => {},
    f.doc,
    { operationID: "op", runID: "run" },
    f.now,
    f.wait,
  );
  assert.equal(f.commands(), 1);
  assert.equal((f.doc.read() as any).history[0].acknowledged, false);
});

test("fresh FOLLOW after a lost Stop permits a new movement decision on the same ship", async () => {
  const f = fixture();
  const settle = () => observeSettledInPlace(f.run, f.session, 11, () => {}, f.doc,
    { operationID: "op", runID: "run" }, f.now, f.wait);
  f.lose();
  await assert.rejects(settle(), /unresolved/);
  f.restore();
  const proof = await settle();
  assert.equal(proof.inSpace, true);
  assert.equal(f.commands(), 2);
  assert.equal((f.doc.read() as any).pending, null);
});
