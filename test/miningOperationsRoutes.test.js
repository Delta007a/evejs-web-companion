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
const crew = [character, { characterID: 7002, accountID: 4001, characterName: "Miner Two" }, { characterID: 7003, accountID: 4001, characterName: "Cargo One" }];
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
const pinnedScript = {
  scriptID: "pinned-belt-script", name: "Fixed Belt I", rev: 1,
  doc: { program: [
    { kind: "macro", macro: "mine-at-belt", args: { belt: { kind: "belt", belt: { mode: "chosen", name: "Belt I" } } } },
    { kind: "macro", macro: "deliver-ore", args: {} },
  ] },
};
const crewMinerScript = { scriptID: "crew-miner", name: "Operation jetcan miner", rev: 1, doc: {
  program: [
    { kind: "macro", macro: "mine-at-belt", args: { belt: { kind: "belt", belt: { mode: "nearest" } } } },
    { kind: "macro", macro: "jettison-ore", args: {} },
  ],
} };
const crewHaulerScript = { scriptID: "crew-hauler", name: "Operation hauler", rev: 1, doc: {
  program: [
    { kind: "macro", macro: "travel-to-belt", args: { belt: { kind: "belt", belt: { mode: "nearest" } } } },
    { kind: "macro", macro: "loot-containers", args: {} },
    { kind: "macro", macro: "deliver-ore", args: {} },
  ],
} };

function fakeHost(heldSessions = new Map()) {
  const rows = [];
  const stops = [];
  const inputs = [];
  return {
    rows,
    stops,
    inputs,
    async start(input) {
      inputs.push(input);
      if ([...heldSessions].some(([sessionID, held]) => Number(held.characterID) === input.characterID && sessionID !== input.callerSessionID)) {
        return { ok: false, code: "CHARACTER_IN_USE", message: "Another browser session controls this pilot." };
      }
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
  const operationStore = createMiningOperationStore({ dataDir, resolveSystem: (id) => ({ 30000142: { solarSystemID: 30000142, solarSystemName: "Jita" }, 30004504: { solarSystemID: 30004504, solarSystemName: "4C-B7X" } })[Number(id)] || null });
  const board = createMiningTargetBoard();
  const operations = createMiningOperations({ store: operationStore, targetBoard: board, beltMemory: createBeltMemory() });
  const heldSessions = new Map();
  const host = fakeHost(heldSessions);
  const app = createApp({
    eveStore: {
      getAccount: async (username) => username === account.username ? { ...account } : null,
      getCharacterForAccount: async (accountID, characterID) =>
        Number(accountID) === account.accountID ? crew.find((row) => row.characterID === Number(characterID)) || null : null,
      listCharactersForAccount: async () => crew.map((row) => ({ ...row })),
    },
    eveGatewayClient: {},
    webAuth,
    botHost: host,
    bridgeSessionStore: heldSessions,
    botScriptStore: {
      get: (scriptID) => [script, pinnedScript, crewMinerScript, crewHaulerScript].find((row) => row.scriptID === scriptID) || null,
      list: () => [script, pinnedScript, crewMinerScript, crewHaulerScript],
    },
    staticData: {
      getStation: () => null,
      getSolarSystem: (id) => ({ 30000142: { solarSystemID: 30000142, solarSystemName: "Jita" }, 30004504: { solarSystemID: 30004504, solarSystemName: "4C-B7X" } })[Number(id)] || null,
      getSolarSystemName: (id) => ({ 30000142: "Jita", 30004504: "4C-B7X" })[Number(id)] || `System ${id}`,
      findMapLocations: ({ q }) => {
        const matches = [{ id: 30000142, name: "Jita", kind: "system", solarSystemID: 30000142, solarSystemName: "Jita" }, { id: 30004504, name: "4C-B7X", kind: "system", solarSystemID: 30004504, solarSystemName: "4C-B7X" }]
          .filter((row) => row.name.toLowerCase().includes(String(q).toLowerCase()));
        return { q, kind: "system", total: matches.length, capped: false, limit: 50, matches };
      },
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
  const directPage = await fetch(`${baseUrl}/mining-command-center`);
  assert.equal(directPage.status, 200);
  assert.match(directPage.headers.get("content-type"), /text\/html/);
  const login = await request(baseUrl, "/api/login", {
    method: "POST",
    body: { username: account.username, password: "local" },
  });
  const token = login.payload.sessionToken;

  const search = await request(baseUrl, "/api/map/find?kind=system&q=4C-B", { token });
  assert.deepEqual(search.payload.matches.map((row) => [row.name, row.id]), [["4C-B7X", 30004504]]);
  const resolved = await request(baseUrl, "/api/map/resolve/30004504", { token });
  assert.equal(resolved.payload.systemName, "4C-B7X");
  const unresolved = await request(baseUrl, "/api/map/resolve/99999999", { token });
  assert.equal(unresolved.payload.kind, "unknown");
  const pilots = await request(baseUrl, `/api/mining-operations/accounts/${account.username}/pilots`, { token });
  assert.equal(pilots.payload.pilots[0].characterID, character.characterID);
  const routineList = await request(baseUrl, "/api/mining-operations/routines?classes=BELT&unloadPolicy=SELF_UNLOAD", { token });
  assert.equal(routineList.payload.routines.find((row) => row.scriptID === script.scriptID).roles.MINER.compatible, true);
  assert.equal(routineList.payload.routines.find((row) => row.scriptID === pinnedScript.scriptID).roles.MINER.compatible, false);

  const operationInput = {
    name: "Route operation",
    area: { anchorSystemID: 30000142, anchorSystemName: "Jita", reach: "CURRENT_SYSTEM", targetClasses: ["BELT"] },
    targetPolicy: "ANY_ELIGIBLE",
    unloadPolicy: "SELF_UNLOAD",
    members: [{ ...character, accountName: account.username, role: "MINER", automationID: script.scriptID }],
  };
  for (const area of [
    { ...operationInput.area, anchorSystemID: 99999999 },
    { ...operationInput.area, anchorSystemName: "Not a system" },
    { ...operationInput.area, anchorSystemID: 30004504 },
  ]) {
    const invalid = await request(baseUrl, "/api/mining-operations", { method: "POST", token, body: { ...operationInput, area } });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.payload.error, "MINING_OPERATION_INVALID");
  }
  const canonical = await request(baseUrl, "/api/mining-operations", { method: "POST", token, body: { ...operationInput, name: "Canonical", area: { ...operationInput.area, anchorSystemID: 30004504, anchorSystemName: null } } });
  assert.equal(canonical.payload.definition.area.anchorSystemName, "4C-B7X");

  const incompatible = await request(baseUrl, "/api/mining-operations", { method: "POST", token, body: { ...operationInput, name: "Pinned", members: [{ ...operationInput.members[0], automationID: pinnedScript.scriptID }] } });
  const refused = await request(baseUrl, `/api/mining-operations/${incompatible.payload.definition.operationID}/start`, { method: "POST", token, body: { grants: {} } });
  assert.equal(refused.response.status, 409);
  assert.equal(refused.payload.error, "INCOMPATIBLE_OPERATION_ROUTINE");
  assert.match(refused.payload.message, /pinned belt/);
  assert.equal(host.inputs.length, 0);

  const saved = await request(baseUrl, "/api/mining-operations", {
    method: "POST",
    token,
    body: operationInput,
  });
  assert.equal(saved.response.status, 200);
  const operationID = saved.payload.definition.operationID;

  const started = await request(baseUrl, `/api/mining-operations/${operationID}/start`, {
    method: "POST",
    token,
    body: { grants: { [character.characterID]: { scriptRev: 1, riskClasses: [], maxRuntimeMinutes: 60 } } },
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.payload.operations.find((row) => row.definition.operationID === operationID).runtime.state, "TRAVELING");
  assert.equal(host.rows[0].operationID, operationID);
  assert.equal(host.rows[0].operationRole, "MINER");
  assert.equal(host.inputs[0].callerSessionID, null);

  const viewed = await request(baseUrl, "/api/mining-operations", { token });
  assert.equal(viewed.response.status, 200);
  assert.equal(viewed.payload.operations.find((row) => row.definition.operationID === operationID).runtime.members[0].runtimeState, "running");

  const stopped = await request(baseUrl, `/api/mining-operations/${operationID}/stop`, {
    method: "POST",
    token,
    body: {},
  });
  assert.equal(stopped.response.status, 200);
  assert.equal(stopped.payload.operations.find((row) => row.definition.operationID === operationID).runtime.state, "STOPPED");
  assert.deepEqual(host.stops, [`bot-${character.characterID}`]);

  const withDefender = await request(baseUrl, "/api/mining-operations", { method: "POST", token, body: {
    ...operationInput,
    name: "Modeled guard",
    members: [...operationInput.members, { characterID: 7002, characterName: "Guard", accountName: account.username, role: "DEFENDER", automationID: "" }],
  } });
  assert.equal(withDefender.response.status, 200);
  const defenderStart = await request(baseUrl, `/api/mining-operations/${withDefender.payload.definition.operationID}/start`, {
    method: "POST", token,
    body: { grants: { [character.characterID]: { scriptRev: 1, riskClasses: [], maxRuntimeMinutes: 60 } } },
  });
  assert.equal(defenderStart.response.status, 200);
  assert.equal(defenderStart.payload.operations.find((row) => row.definition.operationID === withDefender.payload.definition.operationID).runtime.state, "DEGRADED");
  assert.equal(defenderStart.payload.results.find((row) => row.characterID === 7002).error, "MEMBER_NOT_EXECUTABLE");
  await request(baseUrl, `/api/mining-operations/${withDefender.payload.definition.operationID}/stop`, { method: "POST", token, body: {} });

  const crewOperation = await request(baseUrl, "/api/mining-operations", { method: "POST", token, body: {
    ...operationInput,
    name: "Jetcan crew",
    unloadPolicy: "HAULER_SERVICE",
    members: crew.map((row, index) => ({ ...row, accountName: account.username, role: index === 2 ? "HAULER" : "MINER", automationID: index === 2 ? crewHaulerScript.scriptID : crewMinerScript.scriptID })),
  } });
  assert.equal(crewOperation.response.status, 200);
  heldSessions.set("other-browser", { characterID: 7003, accountID: account.accountID, bridgeSessionID: "held-cargo", droneRecoveryReady: true });
  const heldStart = await request(baseUrl, `/api/mining-operations/${crewOperation.payload.definition.operationID}/start`, { method: "POST", token, body: {
    grants: Object.fromEntries(crew.map((row) => [row.characterID, { scriptRev: 1, riskClasses: [], maxRuntimeMinutes: 60 }])),
  } });
  assert.equal(heldStart.payload.operations.find((row) => row.definition.operationID === crewOperation.payload.definition.operationID).runtime.state, "DEGRADED");
  assert.equal(heldStart.payload.results.find((row) => row.characterID === 7003).error, "CHARACTER_IN_USE");
  assert.equal(host.inputs.find((input) => input.characterID === 7003).callerSessionID, null);
  assert.equal(heldSessions.has("other-browser"), true);
  await request(baseUrl, `/api/mining-operations/${crewOperation.payload.definition.operationID}/stop`, { method: "POST", token, body: {} });
  heldSessions.delete("other-browser");
  const crewStart = await request(baseUrl, `/api/mining-operations/${crewOperation.payload.definition.operationID}/start`, { method: "POST", token, body: {
    grants: Object.fromEntries(crew.map((row) => [row.characterID, { scriptRev: 1, riskClasses: [], maxRuntimeMinutes: 60 }])),
  } });
  assert.equal(crewStart.response.status, 200);
  assert.equal(crewStart.payload.results.filter((row) => row.ok).length, 3);
  assert.ok(host.inputs.slice(-3).every((input) => input.callerSessionID === null));
});
