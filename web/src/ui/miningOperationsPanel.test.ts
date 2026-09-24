import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const MiningOperations = (await import("./MiningOperations.svelte")).default;

function fakeFlow(): unknown {
  return { requestOptions: () => ({}) };
}

test("Mining Command Center renders as a global first-mount surface", () => {
  const output = render(MiningOperations as never, {
    props: { store: createClientStore(), flow: fakeFlow(), sessions: [] },
  } as never);
  const text = output.body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /Mining Operations/);
  assert.match(text, /one jointly moving industrial fleet/i);
  assert.match(text, /Global target board/i);
});

test("unsupported target and defender execution are explicit, not false capabilities", () => {
  const source = readFileSync(new URL("./MiningOperations.svelte", import.meta.url), "utf8");
  assert.match(source, /Ice — not supported yet/);
  assert.match(source, /Gas — not supported yet/);
  assert.match(source, /Defender — execution not supported/);
  assert.match(source, /dynamic discovery deferred/);
});

test("opening and viewing Command Center adds zero readSpaceSnapshot polling", () => {
  const panel = readFileSync(new URL("./MiningOperations.svelte", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api.ts", import.meta.url), "utf8");
  const managementSlice = api.slice(
    api.indexOf("export interface MiningOperationMemberDefinition"),
    api.indexOf("/** Atomic acquisition", api.indexOf("export interface MiningOperationMemberDefinition")),
  );
  assert.doesNotMatch(panel, /readSpaceSnapshot|getSpaceSnapshot|loadSpaceSnapshot/);
  assert.doesNotMatch(managementSlice, /readSpaceSnapshot|getSpaceSnapshot|loadSpaceSnapshot/);
  assert.match(panel, /loadMiningOperations/);
});

test("the dashboard explains a split main body and logistics tail", () => {
  const source = readFileSync(new URL("./MiningOperations.svelte", import.meta.url), "utf8");
  assert.match(source, /Logistics tail/);
  assert.match(source, /main body may relocate/);
  assert.match(source, /DRAINING/);
});
