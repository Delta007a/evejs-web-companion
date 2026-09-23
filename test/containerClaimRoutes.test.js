"use strict";

// Exercise Express handlers directly: no listening server, socket, game data
// or live API. Authentication and held-session checks still run unchanged.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/server");
const { CONTAINER_LEASE_MS } = require("../src/lootMemory");
const SYSTEM = 30000144;
const claimPath = "/api/bots/loot-memory/claim";
const releasePath = "/api/bots/loot-memory/release";

function fixture() {
  const app = createApp({
    webAuth: {
      verifySessionToken: (token) => ["one", "two"].includes(token)
        ? { sessionID: token, accountID: 7, username: "pilot" } : null,
    },
    eveStore: { getAccount: async () => ({ accountID: 7, username: "pilot", role: "0", banned: false }) },
    eveGatewayClient: { releaseBridgeSession: async () => {} },
    staticData: {}, errorLogger: (error) => { throw error; },
  });
  for (const session of ["one", "two"]) app.locals.bridgeSessions.set(session, {
    accountID: 7, characterID: session === "one" ? 1 : 2,
    solarSystemID: SYSTEM, bridgeSessionID: session, stream: null, streamSubscribers: new Set(),
  });
  async function request(path, session, body) {
    const route = app.router.stack.find((entry) => entry.route?.path === path).route;
    const req = { headers: { authorization: `Bearer ${session}` }, body, query: {} };
    const res = {
      code: 200, payload: undefined,
      status(code) { this.code = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    for (const layer of route.stack) {
      let continued = false;
      await layer.handle(req, res, (error) => { if (error) throw error; continued = true; });
      if (!continued) break;
    }
    return res;
  }
  return { app, request };
}
const claim = { runID: "run", system: SYSTEM, itemID: 80001 };

test("authenticated sessions race through one authority; body cannot impersonate an owner", async () => {
  const { request } = fixture();
  const results = await Promise.all([
    request(claimPath, "one", claim),
    request(claimPath, "two", { ...claim, sessionID: "one" }),
  ]);
  assert.deepEqual(results.map((r) => r.payload.acquired), [true, false]);
  assert.equal(results[0].payload.leaseMs, CONTAINER_LEASE_MS);
  assert.equal((await request(claimPath, "one", { ...claim, renewOnly: true })).payload.acquired, true);
  await request(releasePath, "two", { runID: "run" });
  assert.equal((await request(claimPath, "two", claim)).payload.acquired, false);
  await request(releasePath, "one", { runID: "run" });
  assert.equal((await request(claimPath, "two", claim)).payload.acquired, true);
});

test("claim routes reject missing auth, missing held session, wrong system and bad identity", async () => {
  const { app, request } = fixture();
  assert.equal((await request(claimPath, "invalid", claim)).code, 401);
  assert.equal((await request(claimPath, "one", { ...claim, system: 99 })).code, 409);
  assert.equal((await request(claimPath, "one", { ...claim, itemID: "80001" })).code, 400);
  assert.equal((await request(releasePath, "one", {})).code, 400);
  app.locals.bridgeSessions.delete("one");
  assert.equal((await request(claimPath, "one", claim)).code, 409);
});

test("session release deterministically clears every run claim", async () => {
  const { request } = fixture();
  await request(claimPath, "one", claim);
  await request(claimPath, "one", { ...claim, runID: "other", itemID: 80002 });
  assert.equal((await request("/api/bridge/release", "one", {})).code, 200);
  assert.equal((await request(claimPath, "two", claim)).payload.acquired, true);
  assert.equal((await request(claimPath, "two", { ...claim, itemID: 80002 })).payload.acquired, true);
});
