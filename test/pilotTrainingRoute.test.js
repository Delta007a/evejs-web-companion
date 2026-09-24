"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../src/server");

const ACCOUNT = { username: "BMiner4", accountID: 4, role: "0", banned: false };
const CHARACTER_ID = 90000001;
const requests = [];
const CORP = 98000001;
const fit = { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [
  ["fittingID", 7], ["ownerID", CORP], ["shipTypeID", 32880], ["name", "Start Venture"],
  ["savedDate", { type: "long", value: "134285151537020000" }],
  ["fitData", { type: "list", items: [{ type: "tuple", items: [483, 27, 2] }] }],
] } };
const corpLibrary = { type: "object", name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [{}, { type: "substream", value: { type: "dict", entries: [[7, fit]] } }] };

function app() {
  const equipment = new Set([32880, 89240, 17480, 22542, 578, 444, 439, 483,
    2464, 10246, 2046, 31370, 31752, 3829, 17482, 31790, 31754, 15508]);
  return createApp({
    webAuth: {
      verifySessionToken: (token) => token === "test-token"
        ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: "test-session" }
        : null,
    },
    eveStore: {
      async getAccount(name) { return name === ACCOUNT.username ? ACCOUNT : null; },
      async getCharacterForAccount(accountID, id) {
        return accountID === ACCOUNT.accountID && id === CHARACTER_ID
          ? { characterID: id, characterName: "Test Miner", corporationID: CORP } : null;
      },
      async listCharactersForAccount() { return [{ characterID: CHARACTER_ID, characterName: "Test Miner" }]; },
    },
    eveGatewayClient: {
      async getSkills(accountID, id) {
        requests.push(["getSkills", accountID, id]);
        return { characterName: "Test Miner", serverNowMs: 1_800_000_000_000,
          skills: [], queue: { active: false, entries: [] } };
      },
      async callMethod(service, method, args, kwargs, session, bridgeSessionID) {
        requests.push(["callMethod", service, method, args, session.corpid, bridgeSessionID]);
        return { result: corpLibrary };
      },
      async saveSkillQueue() { throw new Error("A qualification read must not save a queue."); },
    },
    staticData: {
      getType: (id) => equipment.has(id) || id > 0 ? { typeID: id } : null,
      getSkillType: (id) => ({ typeID: id, name: `Skill ${id}` }),
      getTypeDogma: (id) => ({ attributes: [32880, 89240, 17480].includes(id) ? { 182: 3386, 277: 3 } : {} }),
    },
    errorLogger() {},
  });
}

test("training routes read only account-owned pilots without selecting a gameplay session", async (t) => {
  const server = app().listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: "Bearer test-token" };
  const roster = await fetch(`${base}/api/pilot-training/characters`, { headers });
  assert.equal(roster.status, 200);
  assert.deepEqual((await roster.json()).characters, [{ characterID: CHARACTER_ID, name: "Test Miner" }]);
  const own = await fetch(`${base}/api/pilot-training/miner?characterID=${CHARACTER_ID}`, { headers });
  assert.equal(own.status, 200);
  const payload = await own.json();
  assert.equal(payload.report.role, "MINER");
  assert.equal(payload.report.stages[0].skillQualification, "UNKNOWN");
  assert.equal(payload.report.stages[0].fitting.status, "UNCONFIGURED");
  assert.equal(payload.fittings[0].name, "Start Venture");
  assert.equal(payload.corporationID, CORP);
  assert.deepEqual(requests[0], ["callMethod", "corpFittingMgr", "GetFittings", [], CORP, undefined]);
  assert.deepEqual(requests[1], ["getSkills", ACCOUNT.accountID, CHARACTER_ID]);
  const selections = { VENTURE: { scope: "CORPORATION", ownerID: CORP, fittingID: 7,
    acceptedSavedDate: payload.fittings[0].savedDate, acceptedFingerprint: payload.fittings[0].fingerprint } };
  const qualified = await fetch(`${base}/api/pilot-training/miner?characterID=${CHARACTER_ID}&selections=${encodeURIComponent(JSON.stringify(selections))}`, { headers });
  const accepted = await qualified.json();
  assert.equal(accepted.report.stages[0].fitting.status, "READY");
  assert.equal(accepted.report.stages[0].skillQualification, "NOT_READY");
  assert.equal(accepted.report.stages[0].hard.find((row) => row.typeID === 3386).level, 3);
  const other = await fetch(`${base}/api/pilot-training/miner?characterID=90000009`, { headers });
  assert.equal(other.status, 404);
  assert.equal(requests.length, 4);
  const unauthenticated = await fetch(`${base}/api/pilot-training/miner?characterID=${CHARACTER_ID}`);
  assert.equal(unauthenticated.status, 401);
});
