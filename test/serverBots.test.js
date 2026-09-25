"use strict";

// The server-side bot routes' HANDOVER contract: POST /api/bots/start moves
// the hull in ONE request. When the CALLER's own web session is flying the
// requested character, the route releases that session BEFORE the bot host
// starts — so the instant the request answers, the bot exists and the
// login/select screens' bot-flying marks are right on their first read. Any
// other session's hull is never touched here (the host's own CHARACTER_IN_USE
// check still refuses those).
//
// The bot HOST itself is faked (its engine is covered by src/botHost.test.js
// and live drills); these tests pin the ROUTE's behavior around it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");

process.env.EVEJS_WEB_POC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-bots-"));

const webAuth = require("../src/webAuth");
const { createApp } = require("../src/server");

const FARMER = { username: "farmer", accountID: 4001, role: "0", banned: false };
const CHARACTERS = [
  { characterID: 7001, accountID: 4001, characterName: "Ore Farmer" },
  { characterID: 7002, accountID: 4001, characterName: "Second Pilot" },
];
const GRANT = { scriptRev: 1, riskClasses: [], maxRuntimeMinutes: 720 };

const activeServers = new Set();

function fakeStore() {
  return {
    async getAccount(username) {
      return String(username) === FARMER.username ? { ...FARMER } : null;
    },
    async listCharactersForAccount(accountID) {
      return Number(accountID) === FARMER.accountID ? CHARACTERS.map((row) => ({ ...row })) : [];
    },
    async getCharacterForAccount(accountID, characterID) {
      if (Number(accountID) !== FARMER.accountID) {
        return null;
      }
      const row = CHARACTERS.find((entry) => entry.characterID === Number(characterID));
      return row ? { ...row } : null;
    },
  };
}

function fakeGateway(log) {
  return {
    async selectCharacter(args) {
      const characterID = Number(args[0]);
      return {
        bridgeSessionID: `bridge-for-${characterID}`,
        session: { characterID, characterName: "x", stationID: 60000004, solarSystemID: 30000001, corporationID: 1000001 },
        notifications: [],
      };
    },
    async releaseBridgeSession(bridgeSessionID) {
      log.push(["release", bridgeSessionID]);
      return { released: true };
    },
    async callMethod(service, method) {
      return { service, method, result: {}, notifications: [] };
    },
    openSessionEventStream(options) {
      return { ...options, close() {} };
    },
  };
}

function fakeBotHost(log) {
  return {
    async start(input) {
      // The full input, not just the characterID — the companion tests below
      // need to see which branch of /api/bots/start actually built it.
      if (input.beforeStart) await input.beforeStart();
      log.push(["start", input]);
      return {
        ok: true,
        bot: { botID: "bot-1", characterID: input.characterID, status: "running", startedAt: "now" },
      };
    },
    async stop() {
      return { ok: false, code: "BOT_NOT_FOUND" };
    },
    list: () => [],
    claimedBy: () => null,
    authorizesClaim: () => false,
    activeCharacterIDs: () => [7001],
    activeBots: () => [
      { characterID: 7001, status: "running", phase: "Mining", why: null, note: null, vitals: null },
    ],
    sampleAllVitals: async () => {},
    resume: async () => {},
    stopAll: async () => {},
  };
}

async function startTestServer(log, suppliedBotHost = null, lifecycle = null) {
  const app = createApp({
    eveStore: fakeStore(),
    eveGatewayClient: { ...fakeGateway(log), ...lifecycle?.gateway },
    webAuth,
    botHost: lifecycle ? undefined : suppliedBotHost || fakeBotHost(log),
    botHostLoadStack: lifecycle ? () => lifecycleStack(log, lifecycle) : undefined,
    // The script library is platform-wide, so get() looks up by scriptID alone
    // and every account sees the same record; `authorAccountID` is display-only
    // and grants nothing. AUTHORITY over the hull is still per-account, and the
    // route proves it through getCharacterForAccount above, not through here.
    botScriptStore: {
      get: (scriptID) =>
        scriptID === "s1"
          ? {
              scriptID: "s1",
              authorAccountID: FARMER.accountID,
              authorName: FARMER.username,
              name: "Miner",
              rev: 1,
              doc: { format: "evejs-bot-script" },
            }
          : null,
      list: () => [],
    },
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  if (lifecycle) lifecycle.baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, app };
}

test.after(() => {
  for (const server of activeServers) {
    server.close();
  }
});

async function request(baseUrl, routePath, { method = "GET", token, body, headers: suppliedHeaders = {} } = {}) {
  const headers = { "content-type": "application/json", ...suppliedHeaders };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function signInAndSelect(baseUrl, characterID) {
  const login = await request(baseUrl, "/api/login", {
    method: "POST",
    body: { username: FARMER.username, password: "x" },
  });
  const token = login.payload.sessionToken;
  const selected = await request(baseUrl, "/api/bridge/select", { method: "POST", token, body: { characterID } });
  await request(baseUrl, "/api/bridge/drone-recovery/ready", {
    method: "POST",
    token,
    body: { checkID: selected.payload.droneRecoveryCheckID },
  });
  return token;
}

test("run-on-server releases the CALLER's held hull before the bot starts", async () => {
  const log = [];
  const { baseUrl, app } = await startTestServer(log);
  const token = await signInAndSelect(baseUrl, 7001);
  assert.equal(app.locals.bridgeSessions.size, 1);

  const { response, payload } = await request(baseUrl, "/api/bots/start", {
    method: "POST",
    token,
    body: { characterID: 7001, scriptID: "s1", grant: GRANT },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.bot.characterID, 7001);
  // The caller's session is gone, and it was gone BEFORE the host started.
  assert.equal(app.locals.bridgeSessions.size, 0);
  assert.deepEqual(
    log.filter((row) => row[0] !== "start" || true).map((row) => row[0]),
    ["release", "start"],
  );
});

test("a caller flying a DIFFERENT character keeps their hull", async () => {
  const log = [];
  const { baseUrl, app } = await startTestServer(log);
  const token = await signInAndSelect(baseUrl, 7001);

  const { response } = await request(baseUrl, "/api/bots/start", {
    method: "POST",
    token,
    body: { characterID: 7002, scriptID: "s1", grant: GRANT },
  });
  assert.equal(response.status, 200);
  // No release happened; the caller still flies 7001.
  assert.equal(app.locals.bridgeSessions.size, 1);
  assert.deepEqual(log.map((row) => row[0]), ["start"]);
});

test("/api/bots/active answers WITHOUT auth: ids + game-state rows, nothing controllable", async () => {
  const { baseUrl } = await startTestServer([]);
  const { response, payload } = await request(baseUrl, "/api/bots/active");
  assert.equal(response.status, 200);
  assert.deepEqual(payload.characterIDs, [7001]);
  assert.equal(payload.bots.length, 1);
  assert.equal(payload.bots[0].characterID, 7001);
  assert.equal(payload.bots[0].phase, "Mining");
  // No handle a caller could act on, and no account/script identity.
  assert.equal("botID" in payload.bots[0], false);
  assert.equal("scriptID" in payload.bots[0], false);
  assert.equal("accountID" in payload.bots[0], false);
});

test("a public bot ID cannot bypass the claimed-character select guard", async () => {
  const log = [];
  const host = {
    ...fakeBotHost(log),
    claimedBy: (characterID) => (Number(characterID) === 7001 ? "public-bot-id" : null),
    authorizesClaim: (characterID, secret) => Number(characterID) === 7001 && secret === "private-capability",
  };
  const { baseUrl } = await startTestServer(log, host);
  const login = await request(baseUrl, "/api/login", {
    method: "POST",
    body: { username: FARMER.username, password: "x" },
  });
  const token = login.payload.sessionToken;

  const refused = await request(baseUrl, "/api/bridge/select", {
    method: "POST",
    token,
    headers: { "x-evejs-bot-claim": "public-bot-id" },
    body: { characterID: 7001 },
  });
  assert.equal(refused.response.status, 409);
  assert.equal(refused.payload.error, "CHARACTER_IN_USE_BY_BOT");

  const authorized = await request(baseUrl, "/api/bridge/select", {
    method: "POST",
    token,
    headers: { "x-evejs-bot-claim": "private-capability" },
    body: { characterID: 7001 },
  });
  assert.equal(authorized.response.status, 200);
});

test("an operation bot select stays behind the lost-drone gate until recovery acknowledges", async () => {
  const log = [];
  const host = {
    ...fakeBotHost(log),
    claimedBy: (characterID) => Number(characterID) === 7001 ? "operation-bot" : null,
    authorizesClaim: (characterID, secret) => Number(characterID) === 7001 && secret === "private-operation-capability",
    operationForClaim: (characterID, secret) => Number(characterID) === 7001 && secret === "private-operation-capability"
      ? { operationID: "op-1", operationRole: "MINER" } : null,
  };
  const { baseUrl, app } = await startTestServer(log, host);
  const signed = await request(baseUrl, "/api/login", { method: "POST", body: { username: FARMER.username, password: "x" } });
  const token = signed.payload.sessionToken;
  const selected = await request(baseUrl, "/api/bridge/select", {
    method: "POST", token, headers: { "x-evejs-bot-claim": "private-operation-capability" }, body: { characterID: 7001 },
  });
  assert.equal(selected.response.status, 200);
  const sessionID = webAuth.verifySessionToken(token).sessionID;
  assert.equal(app.locals.bridgeSessions.get(sessionID).droneRecoveryReady, false);
  const ready = await request(baseUrl, "/api/bridge/drone-recovery/ready", {
    method: "POST", token, body: { checkID: selected.payload.droneRecoveryCheckID },
  });
  assert.equal(ready.response.status, 200);
  assert.equal(app.locals.bridgeSessions.get(sessionID).droneRecoveryReady, true);
});

// ── kind: "companion" — the SAME route, branched by the body ────────────────
// docs/fleet-companion-handoff.md, "3. Extend botHost": no second route, so
// these pin that /api/bots/start's companion branch reaches botHost.start
// with the request instead of a script lookup, while the ownership check and
// the same-session hull handover stay identical either way.

const COMPANION_REQUEST = { role: "dps", useDrones: false };
const COMPANION_GRANT = { scriptRev: 1, riskClasses: ["fleet", "social"], maxRuntimeMinutes: 720 };

test("kind: \"companion\" reaches botHost.start with the request, never a script lookup", async () => {
  const log = [];
  // A botScriptStore whose get() throws proves the companion branch never
  // touches the script library at all.
  const scriptLookups = [];
  const app = createApp({
    eveStore: fakeStore(),
    eveGatewayClient: fakeGateway(log),
    webAuth,
    botHost: fakeBotHost(log),
    botScriptStore: {
      get: (scriptID) => {
        scriptLookups.push(scriptID);
        return null;
      },
      list: () => [],
    },
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const token = await signInAndSelect(baseUrl, 7001);
  const { response, payload } = await request(baseUrl, "/api/bots/start", {
    method: "POST",
    token,
    body: { characterID: 7001, kind: "companion", request: COMPANION_REQUEST, grant: COMPANION_GRANT },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.bot.characterID, 7001);
  assert.equal(scriptLookups.length, 0, "the companion branch must never look up a saved script");

  const startCall = log.find((row) => row[0] === "start");
  assert.ok(startCall, "botHost.start must have been called");
  assert.equal(startCall[1].kind, "companion");
  assert.deepEqual(startCall[1].request, COMPANION_REQUEST);
  assert.deepEqual(startCall[1].grant, COMPANION_GRANT);
  // The same handover this route already proves for a script: the caller's
  // own held hull is released before the bot starts.
  assert.equal(app.locals.bridgeSessions.size, 0);
});

test("kind absent defaults to \"script\" — an old caller's request body still starts a script", async () => {
  const log = [];
  const { baseUrl } = await startTestServer(log);
  const token = await signInAndSelect(baseUrl, 7001);
  const { response, payload } = await request(baseUrl, "/api/bots/start", {
    method: "POST",
    token,
    body: { characterID: 7001, scriptID: "s1", grant: GRANT },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.bot.characterID, 7001);
  const startCall = log.find((row) => row[0] === "start");
  assert.equal(startCall[1].kind, "script");
  assert.equal(startCall[1].scriptID, "s1");
});

// No EveJS or real client engine: exercise route + actual host + signed auth,
// replacing the gateway and the gameplay-driving flow only.
function lifecycleStack(log, options) {
  let online = null;
  let running = false;
  return {
    decodeScriptValue: (doc) => ({ ok: true, doc }),
    analyzeBotRunPolicy: () => ({ riskClasses: [], restartSafe: true, containsSubBots: false }),
    validateBotLaunchGrant: (grant) => grant
      ? { ok: true, grant }
      : { ok: false, code: "BOT_GRANT_REQUIRED", message: "Approval required." },
    createClientStore: () => ({
      station: { get: () => ({ online }) },
      customBot: { get: () => ({ status: running ? "running" : "idle" }) },
      subscribe: () => () => {},
    }),
    createAppFlow: (_store, flowOptions) => ({
      async selectCharacter(characterID) {
        log.push(["bot-select", characterID, flowOptions.initialSessionToken]);
        if (options.failStart) throw new Error("Simulated startup refusal");
        if (options.loopback) {
          const response = await flowOptions.fetch(`${options.baseUrl}/api/bridge/select`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${flowOptions.initialSessionToken}` },
            body: JSON.stringify({ characterID }),
          });
          assert.equal(response.status, 200, JSON.stringify(await response.json()));
        }
        online = { characterID, characterName: "Test Pilot" };
      },
      async startCustomBot() { running = true; },
      stopCustomBot() { running = false; },
      async logout() {
        if (options.loopback) {
          await flowOptions.fetch(`${options.baseUrl}/api/logout`, {
            method: "POST", headers: { authorization: `Bearer ${flowOptions.initialSessionToken}` },
          });
        }
      },
    }),
  };
}

function addOtherHolder(app, token) {
  const sessionID = webAuth.verifySessionToken(token).sessionID;
  const held = app.locals.bridgeSessions.get(sessionID);
  const other = { ...held, bridgeSessionID: "other-holder", streamSubscribers: new Set(), chat: null };
  app.locals.bridgeSessions.set("other-session", other);
  return { sessionID, held, other };
}

for (const state of ["missing", "live", "transport"]) {
  test(`actual host handoff reconciles ${state} competing ownership safely`, async (t) => {
    const log = [];
    const { app, baseUrl } = await startTestServer(log, null, {
      gateway: {
        async readFlightStatus(handle) {
          assert.equal(handle, "other-holder");
          if (state !== "live") throw Object.assign(new Error(state), {
            code: state === "missing" ? "SESSION_NOT_FOUND" : "EVE_GATEWAY_TIMEOUT",
          });
          return { flight: { characterID: 7001 } };
        },
      },
    });
    t.after(() => app.locals.botHost.stopAll());
    const token = await signInAndSelect(baseUrl, 7001);
    const { sessionID, held, other } = addOtherHolder(app, token);
    const result = await request(baseUrl, "/api/bots/start", {
      method: "POST", token, body: { characterID: 7001, scriptID: "s1", grant: GRANT },
    });
    if (state === "missing") {
      assert.equal(result.response.status, 200);
      assert.equal(app.locals.bridgeSessions.has("other-session"), false);
      assert.equal(app.locals.bridgeSessions.has(sessionID), false);
      assert.ok(app.locals.botHost.claimedBy(7001));
      assert.deepEqual(log.map(([name]) => name), ["release", "bot-select"]);
    } else {
      assert.equal(result.response.ok, false);
      if (state === "live") assert.equal(result.payload.error, "CHARACTER_IN_USE");
      assert.equal(app.locals.bridgeSessions.get("other-session"), other);
      assert.equal(app.locals.bridgeSessions.get(sessionID), held);
      assert.deepEqual(log, []);
      assert.equal(app.locals.botHost.claimedBy(7001), null);
    }
  });
}

test("actual host preflight failure retains caller; post-release failure restores caller", async (t) => {
  for (const failStart of [false, true]) {
    const log = [];
    const { app, baseUrl } = await startTestServer(log, null, { failStart });
    t.after(() => app.locals.botHost.stopAll());
    const token = await signInAndSelect(baseUrl, 7001);
    const sessionID = webAuth.verifySessionToken(token).sessionID;
    const before = app.locals.bridgeSessions.get(sessionID);
    const result = await request(baseUrl, "/api/bots/start", {
      method: "POST", token, body: { characterID: 7001, scriptID: "s1", grant: failStart ? GRANT : null },
    });
    assert.equal(result.response.ok, false);
    assert.equal(result.payload.error, failStart ? "BOT_START_FAILED" : "BOT_GRANT_REQUIRED");
    const after = app.locals.bridgeSessions.get(sessionID);
    assert.equal(after.characterID, 7001);
    if (!failStart) {
      assert.equal(after, before);
      assert.deepEqual(log, []);
    } else {
      assert.notEqual(after, before);
      assert.deepEqual(log.map(([name]) => name), ["release", "bot-select"]);
    }
    assert.equal(app.locals.botHost.claimedBy(7001), null);
  }
});

test("a transfer reservation blocks browser select while holder verification awaits", async (t) => {
  let enter;
  let finish;
  const entered = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { finish = resolve; });
  const { app, baseUrl } = await startTestServer([], null, {
    gateway: { async readFlightStatus() { enter(); await gate; return { flight: {} }; } },
  });
  t.after(() => app.locals.botHost.stopAll());
  const token = await signInAndSelect(baseUrl, 7001);
  addOtherHolder(app, token);
  const pending = request(baseUrl, "/api/bots/start", {
    method: "POST", token, body: { characterID: 7001, scriptID: "s1", grant: GRANT },
  });
  await entered;
  try {
    const selection = await request(baseUrl, "/api/bridge/select", { method: "POST", token, body: { characterID: 7001 } });
    assert.equal(selection.response.status, 409);
  } finally { finish(); }
  assert.equal((await pending).payload.error, "CHARACTER_IN_USE");
});


for (const route of ["/api/bots", "/api/logout"]) {
  test(`expired signed auth releases its own ownership through ${route}; forged auth cannot`, async (t) => {
    const log = [];
    const { app, baseUrl } = await startTestServer(log);
    const token = await signInAndSelect(baseUrl, 7001);
    const payload = webAuth.verifySessionToken(token);
    await request(baseUrl, route, {
      method: route === "/api/logout" ? "POST" : "GET", token: `${token}forged`,
    });
    assert.equal(app.locals.bridgeSessions.has(payload.sessionID), true);
    assert.deepEqual(log, []);
    t.mock.method(Date, "now", () => payload.exp + 1);
    const expired = await request(baseUrl, route, {
      method: route === "/api/logout" ? "POST" : "GET", token,
    });
    assert.equal(expired.response.status, route === "/api/logout" ? 200 : 401);
    assert.equal(app.locals.bridgeSessions.has(payload.sessionID), false);
    assert.deepEqual(log, [["release", "bridge-for-7001"]]);
  });
}


test("real host hands off through private-claim loopback with a 24-hour credential", async (t) => {
  const log = [];
  const { app, baseUrl } = await startTestServer(log, null, { loopback: true });
  t.after(() => app.locals.botHost.stopAll());
  const token = await signInAndSelect(baseUrl, 7001);
  const browser = webAuth.verifySessionToken(token);
  const result = await request(baseUrl, "/api/bots/start", {
    method: "POST", token, body: { characterID: 7001, scriptID: "s1", grant: { ...GRANT, maxRuntimeMinutes: 1440 } },
  });
  assert.equal(result.response.status, 200);
  const botToken = log.find(([name]) => name === "bot-select")[2];
  const bot = webAuth.verifySessionToken(botToken);
  assert.notEqual(bot.sessionID, browser.sessionID);
  assert.equal(bot.exp, Date.parse(result.payload.bot.expiresAt) + 5 * 60 * 1000);
  assert.ok(bot.exp - bot.iat > 24 * 60 * 60 * 1000);
  assert.equal(app.locals.bridgeSessions.has(browser.sessionID), false);
  assert.equal(app.locals.bridgeSessions.get(bot.sessionID).characterID, 7001);
  // The browser's post-success UI sync cannot log the bot out.
  await request(baseUrl, "/api/bridge/release", { method: "POST", token });
  assert.equal(app.locals.bridgeSessions.has(bot.sessionID), true);
  assert.ok(app.locals.botHost.claimedBy(7001));
});

test("ambiguous gateway release failure preserves caller and never selects a bot", async (t) => {
  const log = [];
  const { app, baseUrl } = await startTestServer(log, null, {
    gateway: { async releaseBridgeSession() { throw Object.assign(new Error("timeout"), { code: "EVE_GATEWAY_TIMEOUT" }); } },
  });
  t.after(() => app.locals.botHost.stopAll());
  const token = await signInAndSelect(baseUrl, 7001);
  const sessionID = webAuth.verifySessionToken(token).sessionID;
  const held = app.locals.bridgeSessions.get(sessionID);
  const result = await request(baseUrl, "/api/bots/start", {
    method: "POST", token, body: { characterID: 7001, scriptID: "s1", grant: GRANT },
  });
  assert.equal(result.payload.error, "BOT_START_FAILED");
  assert.equal(app.locals.bridgeSessions.get(sessionID), held);
  assert.equal(app.locals.botHost.claimedBy(7001), null);
  assert.deepEqual(log, []);
});


test("an already pending browser select blocks server transfer until it settles", async (t) => {
  let gateSelect = false;
  let enter;
  let finish;
  const entered = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { finish = resolve; });
  const log = [];
  const gateway = fakeGateway(log);
  const { app, baseUrl } = await startTestServer(log, null, {
    gateway: { async selectCharacter(...args) {
      if (gateSelect) { enter(); await gate; }
      return gateway.selectCharacter(...args);
    } },
  });
  t.after(() => app.locals.botHost.stopAll());
  const token = await signInAndSelect(baseUrl, 7001);
  gateSelect = true;
  const selecting = request(baseUrl, "/api/bridge/select", { method: "POST", token, body: { characterID: 7001 } });
  await entered;
  try {
    const result = await request(baseUrl, "/api/bots/start", {
      method: "POST", token, body: { characterID: 7001, scriptID: "s1", grant: GRANT },
    });
    assert.equal(result.response.status, 409);
    assert.equal(app.locals.botHost.claimedBy(7001), null);
    assert.equal(log.some(([name]) => name === "bot-select"), false);
  } finally { finish(); }
  assert.equal((await selecting).response.status, 200);
});
