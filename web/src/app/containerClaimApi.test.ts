import test from "node:test";
import assert from "node:assert/strict";
import { claimContainer } from "./api.ts";

function reply(payload: unknown, beforeReply = () => {}) {
  return (async (_input: unknown, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private-session");
    assert.deepEqual(JSON.parse(String(init?.body)), { runID: "run", system: 1, itemID: 2, renewOnly: false });
    beforeReply();
    return { ok: true, status: 200, json: async () => payload } as Response;
  }) as typeof fetch;
}

test("claim API preserves explicit success and contention with session authentication", async () => {
  for (const acquired of [true, false]) {
    assert.equal(await claimContainer("run", 1, 2, false, {
      token: "private-session", fetch: reply({ ok: true, acquired, leaseMs: 300_000 }),
    }), acquired);
  }
});

test("old or ambiguous acknowledgements are never ownership", async () => {
  for (const payload of [{ ok: true }, { ok: true, acquired: "true" }, { ok: true, acquired: true }]) {
    await assert.rejects(claimContainer("run", 1, 2, false, { token: "private-session", fetch: reply(payload) }), /unavailable|expired/);
  }
});

test("a response delayed by browser suspension cannot authorize a stale action", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  await assert.rejects(claimContainer("run", 1, 2, false, {
    token: "private-session",
    fetch: reply({ ok: true, acquired: true, leaseMs: 300_000 }, () => { now = 300_001; }),
  }), /expired/);
});
