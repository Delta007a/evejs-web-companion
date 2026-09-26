"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const originalDataDir = process.env.EVEJS_WEB_POC_DATA_DIR;
const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-auth-"));
process.env.EVEJS_WEB_POC_DATA_DIR = temporaryDataDir;

const webAuth = require("../src/webAuth");

test.after(() => {
  if (originalDataDir === undefined) {
    delete process.env.EVEJS_WEB_POC_DATA_DIR;
  } else {
    process.env.EVEJS_WEB_POC_DATA_DIR = originalDataDir;
  }
  fs.rmSync(temporaryDataDir, { recursive: true, force: true });
});

test("signed web sessions contain independent cryptorandom session IDs", () => {
  const account = { username: "pilot", accountID: 42 };
  const firstToken = webAuth.createSessionToken(account);
  const secondToken = webAuth.createSessionToken(account);
  const first = webAuth.verifySessionToken(firstToken);
  const second = webAuth.verifySessionToken(secondToken);

  assert.equal(first.username, "pilot");
  assert.equal(first.accountID, 42);
  assert.match(first.sessionID, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second.sessionID, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.sessionID, second.sessionID);
});

test("the server rejects a session ID changed without a valid signature", () => {
  const token = webAuth.createSessionToken({ username: "pilot", accountID: 42 });
  const [encodedPayload, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  payload.sessionID = "attacker-controlled-session-id-000000000000";
  const changedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");

  assert.equal(webAuth.verifySessionToken(`${changedPayload}.${signature}`), null);
});

test("internal bot grant renewal preserves session identity and rejects expired/forged/over-limit credentials", t => {
  const now = Date.now(); t.mock.method(Date, "now", () => now);
  const token = webAuth.createBotSessionToken({ username: "pilot", accountID: 42 }, now + 60 * 60_000);
  const before = webAuth.verifySessionToken(token);
  const renewed = webAuth.extendBotSessionToken(token, now + 5 * 60 * 60_000);
  assert.deepEqual(webAuth.verifySessionToken(renewed), { ...before, exp: now + (5 * 60 + 5) * 60_000 });
  assert.throws(() => webAuth.extendBotSessionToken(`${token}x`, now + 5 * 60 * 60_000));
  assert.throws(() => webAuth.extendBotSessionToken(token, now + 25 * 60 * 60_000));
  Date.now.mock.mockImplementation(() => now + 66 * 60_000);
  assert.equal(webAuth.verifySessionToken(token), null);
  assert.ok(webAuth.verifySessionToken(renewed));
  assert.throws(() => webAuth.extendBotSessionToken(token, now + 8 * 60 * 60_000));
});


test("bot credential covers 24 hours plus cleanup without extending browser TTL", (t) => {
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const account = { username: "pilot", accountID: 42 };
  const browser = webAuth.createSessionToken(account);
  const bot = webAuth.createBotSessionToken(account, now + 24 * 60 * 60 * 1000);
  assert.equal(webAuth.verifySessionToken(browser).exp, now + 12 * 60 * 60 * 1000);
  assert.equal(webAuth.verifySessionToken(bot).exp, now + (24 * 60 + 5) * 60 * 1000);
  Date.now.mock.mockImplementation(() => now + 24 * 60 * 60 * 1000);
  assert.equal(webAuth.verifySessionToken(browser), null);
  assert.ok(webAuth.verifySessionToken(bot));
  Date.now.mock.mockImplementation(() => now + (24 * 60 + 6) * 60 * 1000);
  assert.equal(webAuth.verifySessionToken(bot), null);
  assert.ok(webAuth.verifySessionToken(bot, { allowExpired: true }));
  assert.equal(webAuth.verifySessionToken(`${bot}tampered`, { allowExpired: true }), null);
});
