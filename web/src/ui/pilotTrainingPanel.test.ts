import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const PilotTraining = (await import("./PilotTraining.svelte")).default;

test("Pilot Training mounts as a read-only Miner view without a premature empty roster", () => {
  const store = createClientStore();
  const flow = { requestOptions: () => ({}) };
  const html = render(PilotTraining, { props: { store, flow } }).body;
  assert.match(html, /Pilot Training/);
  assert.match(html, /Choose role/);
  assert.match(html, /MINER/);
  assert.match(html, /Reading skill qualification/);
  assert.doesNotMatch(html, /No characters are available/);
  const source = readFileSync(fileURLToPath(new URL("./PilotTraining.svelte", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /saveSkillQueue|SaveNewQueue|\/skills\/queue|Apply button/);
});
