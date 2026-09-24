"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-mining-operation-routes-"));
process.env.EVEJS_WEB_POC_DATA_DIR = dataDir;

const webAuth = require("../src/webAuth");
const { createApp } = require("../src/server");
const { createBeltMemory } = require("../src/beltMemory");
const { createMiningOperationStore } = require("../src/miningOperationStore");
const { createMiningTargetBoard } = require("../src/miningTargetBoard");
const { createMiningOperations } = require("../src/miningOperations");

const account = { username: "miner-account", accountID: 4001, role: "0", banned: false };
const character = { characterID: 7001, accountID: 4001, characterName: "Miner One" };
const script = {
  scriptID: "mining-script",
  name: "Operation miner",
  rev: 1,
  doc: {
    format: "evejs-bot-script",
    program: [
      { id: "mine", kind: "macro", macro: "mine-at-belt", args: { belt: { kind: "belt", belt: { mode: "nearest" } } } },
      { id: "deliver", kind: "macro", macro: "deliver-ore", args: {} },
    ],
  },
};

function fakeHost() {
  const rows = [];
  const stops = [];
  return {
    rows,
    stops,
    async start(input) {
      if (rows.some((row) => row.characterID === input.characterID && row.endedAt === null)) {
        return { ok: false, code: "CHARACTER_IN_USE", message: "Pilot already controlled." };
      }
      if (input.beforeStart) await input.beforeStart();
      const bot = {
        botID: `bot-${input.characterID}`,
        accountID: input.account.accountID,
        characterID: input.characterID,
        characterName: character.characterName,
        operationID: input.operationID,
        operationRole: input.operationRole,
        status: "running",
        phase: "Starting",
        why: null,
        startedAt: "2026-09-24T00:00:00.000Z",
        endedAt: null,
      };
      rows.push(bot);
      return { ok: true, bot };
    },
    async stop(botID) {
      stops.push(botID);
      const row = rows.find((candidate) => candidate.botID === botID && candidate.endedAt === null);
      if (!row) return { ok: false, code: "BOT_NOT_FOUND" };
      row.endedAt = "2026-09-24T01:00:00.000Z";
      row.status = "stopped";
      return { ok: true, bot: row };
    },
    listAll: () => rows.map((row) => ({ ...row })),
    list: () => rows.map((row) => ({ ...row })),
    claimedBy: () => null,
    authorizesClaim: () => false,
    operationForClaim: () => null,
    activeCharacterIDs: () => [],
    activeBots: () => [],
    sampleAllVitals: async () => {},
    resume: async () => {},
    stopAll: async () => {},
  };
}

async function request(baseUrl, route, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("Mining Operations routes persist definitions, launch through botHost, project status, and stop gracefully", async (t) => {
  const operationStore = createMiningOperationStore({ dataDir });
  const board = createMiningTargetBoard();
  const operations = createMiningOperations({ store: operationStore, targetBoard: board, beltMemory: createBeltMemory() });
  const host = fakeHost();
  const app = createApp({
    eveStore: {
      getAccount: async (username) => username === account.username ? { ...account } : null,
      getCharacterForAccount: async (accountID, characterID) =>
        Number(accountID) === account.accountID && Number(characterID) === character.characterID ? { ...character } : null,
      listCharactersForAccount: async () => [{ ...character }],
    },
    eveGatewayClient: {},
    webAuth,
    botHost: host,
    botScriptStore: {
      get: (scriptID) => scriptID === script.scriptID ? script : null,
      list: () => [script],
    },
    miningOperationStore: operationStore,
    miningTargetBoard: board,
    miningOperations: operations,
    errorLogger(error) { throw error; },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await request(baseUrl, "/api/login", {
    method: "POST",
    body: { username: account.username, password: "local" },
  });
  const token = login.payload.sessionToken;

  const saved = await request(baseUrl, "/api/mining-operations", {
    method: "POST",
    token,
    body: {
      name: "Route operation",
      area: { anchorSystemID: 30000142, anchorSystemName: "Jita", reach: "CURRENT_SYSTEM", targetClasses: ["BELT"] },
      targetPolicy: "ANY_ELIGIBLE",
      unloadPolicy: "SELF_UNLOAD",
      members: [{ ...character, accountName: account.username, role: "MINER", automationID: script.scriptID }],
    },
  });
  assert.equal(saved.response.status, 200);
  const operationID = saved.payload.definition.operationID;

  const started = await request(baseUrl, `/api/mining-operations/${operationID}/start`, {
    method: "POST",
    token,
    body: { grants: { [character.characterID]: { scriptRev: 1, riskClasses: [], maxRuntimeMinutes: 60 } } },
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.payload.operations[0].runtime.state, "TRAVELING");
  assert.equal(host.rows[0].operationID, operationID);
  assert.equal(host.rows[0].operationRole, "MINER");

  const viewed = await request(baseUrl, "/api/mining-operations", { token });
  assert.equal(viewed.response.status, 200);
  assert.equal(viewed.payload.operations[0].runtime.members[0].runtimeState, "running");

  const stopped = await request(baseUrl, `/api/mining-operations/${operationID}/stop`, {
    method: "POST",
    token,
    body: {},
  });
  assert.equal(stopped.response.status, 200);
  assert.equal(stopped.payload.operations[0].runtime.state, "STOPPED");
  assert.deepEqual(host.stops, [`bot-${character.characterID}`]);
});
