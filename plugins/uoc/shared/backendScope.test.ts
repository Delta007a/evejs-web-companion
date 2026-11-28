import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { worldForRequest, worldRoute, type UocBackendRequest } from "./backendScope.ts";
import { trainingWorldStorage } from "../restored/training/worldStorage.ts";

const Database = createRequire(import.meta.url)("better-sqlite3");
const worldFile = "world-id.json";
const request: UocBackendRequest = {
  method: "GET",
  path: "/world",
  params: {},
  query: {},
  account: { accountID: 1, username: "Test account" },
  body: null,
};

function fixture(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), "uoc-world-"));
  const before = process.env.EVEJS_PLUGIN_DATA_DIR;
  process.env.EVEJS_PLUGIN_DATA_DIR = directory;
  t.after(() => {
    if (before === undefined) delete process.env.EVEJS_PLUGIN_DATA_DIR;
    else process.env.EVEJS_PLUGIN_DATA_DIR = before;
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function put(directory: string, file: string, name: string, value: unknown) {
  const database = new Database(path.join(directory, file));
  try {
    database.exec("CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
    database.prepare("INSERT INTO documents VALUES (?, ?)").run(name, JSON.stringify(value));
  } finally {
    database.close();
  }
}

function oldWorldID(directory: string) {
  return "wc-install:" + createHash("sha256")
    .update(process.platform === "win32" ? directory.toLowerCase() : directory)
    .digest("hex");
}

test("an existing installation keeps its world and can read saved data after moving", (t) => {
  const root = fixture(t);
  const original = path.join(root, "original");
  const moved = path.join(root, "moved");
  mkdirSync(original);
  process.env.EVEJS_PLUGIN_DATA_DIR = original;
  const worldID = oldWorldID(original);
  const mccKey = "mining-definitions:" + JSON.stringify([worldID]);
  const saved = { version: 1, definitions: [{ name: "Saved mining operation" }] };
  put(original, "restored-mining-definitions.sqlite", mccKey, saved);
  put(original, "civilian-index.sqlite", "runs", { rows: [{ worldID: "e".repeat(64) }] });

  const browser = new Map<string, string>();
  const training = trainingWorldStorage({
    getItem: (key) => browser.get(key) ?? null,
    setItem: (key, value) => { browser.set(key, value); },
  }, () => worldForRequest(request));
  browser.set(`uoc-restored:pilot-training:world:${encodeURIComponent(worldID)}:settings`, "saved");

  assert.equal(worldForRequest(request), worldID);
  assert.deepEqual(JSON.parse(readFileSync(path.join(original, worldFile), "utf8")), { worldID });
  renameSync(original, moved);
  process.env.EVEJS_PLUGIN_DATA_DIR = moved;
  assert.notEqual(oldWorldID(moved), worldID);
  assert.equal(worldForRequest(request), worldID);
  assert.equal(training.getItem("settings"), "saved");

  const database = new Database(path.join(moved, "restored-mining-definitions.sqlite"), { readonly: true, fileMustExist: true });
  try {
    const document = "mining-definitions:" + JSON.stringify([worldForRequest(request)]);
    const row = database.prepare("SELECT value FROM documents WHERE name = ?").pluck().get(document);
    assert.deepEqual(JSON.parse(row), saved);
  } finally {
    database.close();
  }
});

test("a fresh installation persists a unique ID and keeps it on a fresh directory read", (t) => {
  const original = fixture(t);
  const other = path.join(original, "other");
  const copy = path.join(original, "copy");
  mkdirSync(other);
  mkdirSync(copy);
  const first = worldForRequest(request);
  assert.match(first ?? "", /^wc-install:[a-f0-9]{64}$/);
  const content = readFileSync(path.join(original, worldFile), "utf8");
  assert.deepEqual(JSON.parse(content), { worldID: first });

  process.env.EVEJS_PLUGIN_DATA_DIR = other;
  assert.notEqual(worldForRequest(request), first);
  writeFileSync(path.join(copy, worldFile), content);
  process.env.EVEJS_PLUGIN_DATA_DIR = copy;
  assert.equal(worldForRequest(request), first);
});

test("a previous scoped ID can be found from a history-only installation", (t) => {
  const directory = fixture(t);
  const worldID = "wc-install:" + "a".repeat(64);
  put(directory, "distribution.sqlite", "distribution-missions", {
    records: {},
    history: [{ row: { civilian: { worldID } } }],
  });
  assert.equal(worldForRequest(request), worldID);
});

test("an upgrade chooses the exact old ID when several installation scopes are saved", (t) => {
  const directory = fixture(t);
  const previous = oldWorldID(directory);
  put(directory, "distribution.sqlite", "routes:" + previous, {});
  put(directory, "civilian-index.sqlite", "profiles:wc-install:" + "c".repeat(64), []);
  assert.equal(worldForRequest(request), previous);
});

test("ambiguous old scopes fail without creating an identity file", async (t) => {
  const directory = fixture(t);
  put(directory, "distribution.sqlite", "routes:wc-install:" + "a".repeat(64), {});
  put(directory, "civilian-index.sqlite", "profiles:wc-install:" + "b".repeat(64), []);
  const response = await worldRoute(request);
  assert.equal(response.status, 503);
  assert.match((response.body as { message: string }).message, /previous installation world/);
  assert.equal(existsSync(path.join(directory, worldFile)), false);
});

test("host-scoped data alone does not authorize a new or unrelated fallback", (t) => {
  const directory = fixture(t);
  const hostWorld = "d".repeat(64);
  put(directory, "civilian-index.sqlite", "profiles:" + hostWorld, []);
  const file = path.join(directory, worldFile);
  assert.throws(() => worldForRequest(request), /previous installation world/);
  assert.equal(existsSync(file), false);

  writeFileSync(file, JSON.stringify({ worldID: "wc-install:" + "b".repeat(64) }));
  assert.throws(() => worldForRequest(request), /does not match the saved installation worlds/);
  assert.equal(worldForRequest({ ...request, worldID: hostWorld }), hostWorld);
});

test("a corrupt or mismatched identity is reported and left intact", async (t) => {
  const directory = fixture(t);
  const file = path.join(directory, worldFile);
  const worldID = oldWorldID(directory);
  put(directory, "training-onboarding.sqlite", "onboarding:1:2", { worldID });
  const malformed = "{";
  writeFileSync(file, malformed);
  assert.throws(() => worldForRequest(request), /world-id\.json is invalid/);
  assert.equal(readFileSync(file, "utf8"), malformed);

  const wrong = JSON.stringify({ worldID: "wc-install:" + "b".repeat(64) });
  writeFileSync(file, wrong);
  const response = await worldRoute(request);
  assert.equal(response.status, 503);
  assert.match((response.body as { message: string }).message, /does not match the saved installation worlds/);
  assert.equal(readFileSync(file, "utf8"), wrong);

  writeFileSync(file, JSON.stringify({ worldID }));
  assert.equal(worldForRequest(request), worldID);
});

test("an explicit host world, including a null world, does not use the installation file", (t) => {
  const directory = fixture(t);
  const hostWorld = "host-verified-world";
  assert.equal(worldForRequest({ ...request, worldID: hostWorld }), hostWorld);
  assert.equal(worldForRequest({ ...request, worldID: null }), null);
  const file = path.join(directory, worldFile);
  assert.equal(existsSync(file), false);
  writeFileSync(file, "damaged");
  assert.equal(worldForRequest({ ...request, worldID: hostWorld }), hostWorld);
  assert.equal(readFileSync(file, "utf8"), "damaged");
});
