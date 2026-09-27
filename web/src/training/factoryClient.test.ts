import test from "node:test";
import assert from "node:assert/strict";
import { readFactoryAccount, readFactoryPilot } from "./factoryClient.ts";
import { setSessionToken, getSessionToken, setSessionTokenStorage } from "../app/sessionToken.ts";

test("roster and qualification use isolated account tokens and only control-plane routes", async () => {
  setSessionTokenStorage(null);
  setSessionToken("cockpit-token");
  const calls: { path: string; method: string; authorization: string | null }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://test");
    const authorization = new Headers(init?.headers).get("authorization");
    calls.push({ path: url.pathname, method: init?.method ?? "GET", authorization });
    if (url.pathname === "/api/goblin-factory/login") {
      const { username } = JSON.parse(String(init?.body));
      return Response.json({ ok: true, sessionToken: `${username}-token`, account: { username } });
    }
    if (url.pathname === "/api/pilot-training/characters") {
      const account = authorization === "Bearer A-token" ? "A" : "B";
      return Response.json({ ok: true, account, characters: [{ characterID: account === "A" ? 1 : 2, name: "Pilot" }] });
    }
    assert.equal(url.pathname, "/api/pilot-training/miner", "no selected session, snapshot or gameplay endpoint");
    assert.equal(init?.method, "GET");
    assert.deepEqual(JSON.parse(url.searchParams.get("selections")!), {});
    return Response.json({ ok: true, corporationID: 98000001, fittings: [],
      report: { role: "MINER", pilot: { characterID: Number(url.searchParams.get("characterID")) }, stages: [], previews: {} } });
  };
  try {
    const a = await readFactoryAccount("A", { fetch: transport });
    const b = await readFactoryAccount("B", { fetch: transport });
    await readFactoryPilot(1, {}, a.requestOptions);
    await readFactoryPilot(2, {}, b.requestOptions);
    assert.deepEqual(calls.map((call) => call.authorization), [null, "Bearer A-token", null, "Bearer B-token", "Bearer A-token", "Bearer B-token"]);
    assert.equal(getSessionToken(), "cockpit-token");
    assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "POST", "GET", "GET", "GET"]);
  } finally { setSessionToken(null); }
});

test("mismatched account identity and failed qualification reads reject instead of returning stale data", async () => {
  const transport: typeof fetch = async (input) => String(input).endsWith("/login")
    ? Response.json({ ok: true, sessionToken: "A-token", account: { username: "A" } })
    : Response.json({ ok: true, account: "B", characters: [] });
  await assert.rejects(readFactoryAccount("A", { fetch: transport }), /identity changed/);
  await assert.rejects(readFactoryPilot(1, {}, { token: "A-token", fetch: async () =>
    Response.json({ ok: false, error: "CORPORATION_FITTINGS_UNAVAILABLE" }, { status: 503 }) }));
});
