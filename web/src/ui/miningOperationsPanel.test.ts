import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const MiningOperations = (await import("./MiningOperations.svelte")).default;
const MiningCommandCenter = (await import("./MiningCommandCenter.svelte")).default;

test("Mining Command Center renders without a selected pilot workspace", () => {
  const output = render(MiningOperations as never, { props: {} } as never);
  const text = output.body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /Mining Operations/);
  assert.match(text, /one jointly moving industrial fleet/i);
  assert.match(text, /Global target board/i);
});

test("direct Command Center route mounts its own shell, not App or pilot sessions", () => {
  const output = render(MiningCommandCenter as never, { props: {} } as never);
  assert.match(output.body, /Mining Command Center/);
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const shell = readFileSync(new URL("./MiningCommandCenter.svelte", import.meta.url), "utf8");
  assert.match(main, /pathname === "\/mining-command-center"/);
  assert.match(main, /import\("\.\/ui\/MiningCommandCenter\.svelte"\)/);
  assert.doesNotMatch(shell, /createAppFlow|createSession|readSpaceSnapshot|Overview|Workspace/);
  assert.doesNotMatch(readFileSync(new URL("./PanelHost.svelte", import.meta.url), "utf8"), /<MiningOperations/);
});

test("unsupported target and defender execution are explicit, not false capabilities", () => {
  const source = readFileSync(new URL("./MiningOperations.svelte", import.meta.url), "utf8");
  assert.match(source, /Ice — online Ice Harvesters required/);
  assert.match(source, /Gas — not supported yet/);
  assert.match(source, /Defender — execution not supported/);
  assert.match(source, /dynamic discovery deferred/);
  assert.match(source, /bind:group=\{targetFamily\} value="ORE_ANOMALY"/);
});

test("Fleet Parking uses an explicit station and defaults old definitions to Stay", () => {
  const source = readFileSync(new URL("./MiningOperations.svelte", import.meta.url), "utf8");
  assert.match(source, /On manual Stop \/ Fleet Parking/);
  assert.match(source, /definition\.policies\?\.parking.mode \?\? "STAY_IN_PLACE"/);
  assert.match(source, /Use hauler delivery station as parking station/);
  assert.match(source, /resolved\.stationID === Number\(value\)/);
  assert.match(source, /stopMode !== "STAY_IN_PLACE" && \(!parkingStation \|\| parkingError\)/);
  assert.match(source, /Retry parking/);
  assert.match(source, /failure\.message/);
  assert.doesNotMatch(source, /createAppFlow|runFleetParking|getScriptObservation/);
});

test("opening and viewing Command Center adds zero readSpaceSnapshot polling", () => {
  const panel = readFileSync(new URL("./MiningOperations.svelte", import.meta.url), "utf8");
  const shell = readFileSync(new URL("./MiningCommandCenter.svelte", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api.ts", import.meta.url), "utf8");
  const managementSlice = api.slice(
    api.indexOf("export interface MiningOperationMemberDefinition"),
    api.indexOf("/** Atomic acquisition", api.indexOf("export interface MiningOperationMemberDefinition")),
  );
  assert.doesNotMatch(panel, /readSpaceSnapshot|getSpaceSnapshot|loadSpaceSnapshot/);
  assert.doesNotMatch(shell, /readSpaceSnapshot|getSpaceSnapshot|loadSpaceSnapshot/);
  assert.doesNotMatch(managementSlice, /readSpaceSnapshot|getSpaceSnapshot|loadSpaceSnapshot/);
  assert.match(panel, /loadMiningOperations/);
});

test("new drafts offer Auto travel assist without reinterpreting old definitions", () => {
  const source = readFileSync(new URL("./MiningOperations.svelte", import.meta.url), "utf8");
  assert.match(source, /let travelAssist = \$state\(true\)/);
  assert.match(source, /travelAssist = definition\.policies\?\.travelAssist\?\.mode === "AUTO"/);
  assert.match(source, /Use fitted AB\/MWD/);
});

test("system editor resolves either side and only offers operation-compatible routines", () => {
  const source = readFileSync(new URL("./MiningOperations.svelte", import.meta.url), "utf8");
  assert.match(source, /findMapLocations\(value\.trim\(\), "system"/);
  assert.match(source, /resolveDestination\(anchorSystemID/);
  assert.match(source, /script\.roles\[member\.role\]\?\.compatible/);
  assert.match(source, /disabled=\{busy !== null \|\| !anchorValid\}/);
});

test("the dashboard explains a split main body and logistics tail", () => {
  const source = readFileSync(new URL("./MiningOperations.svelte", import.meta.url), "utf8");
  assert.match(source, /Logistics tail/);
  assert.match(source, /main body may relocate/);
  assert.match(source, /DRAINING/);
});

test("normal BELT setup defaults to Standard profiles and keeps Custom as Advanced", () => {
  const source = readFileSync(new URL("./MiningOperations.svelte", import.meta.url), "utf8");
  assert.match(source, /routineMode: "STANDARD"/);
  assert.match(source, /Standard \/ Automatic/);
  assert.match(source, /Custom \/ Advanced/);
  assert.match(source, /\$\{label\} Miner \/ Hauler Service/);
  assert.match(source, /\$\{label\} Hauler/);
  assert.match(source, /family === "BELT" \? "Belt"/);
  assert.match(source, /getMiningOperationLaunchPlan/);
  assert.match(source, /findMapLocations\(value\.trim\(\), "station"/);
  assert.match(source, /Corporation division/);
  assert.match(source, /Start readiness/);
  assert.doesNotMatch(source, /getBotScript\(/);
});
