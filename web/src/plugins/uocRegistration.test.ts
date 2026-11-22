import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { render } from "svelte/server";
import { PLUGINS } from "../../../plugins/index.ts";
import { PLUGIN_VIEWS } from "../../../plugins/views.ts";
import { definePlugin } from "../plugin-api/index.ts";
import { isGlobalTab, pluginPageAt, pluginWindowGroups } from "../ui/globalWindow.ts";
import { pinStore } from "../ui/pluginPinStore.ts";
import { meetPlugins, pluginLaunchers, togglePlugin, type PinState } from "../ui/pluginPins.ts";
import { activatePagePlugins, pluginProblem } from "./pluginHost.ts";

register("../ui/svelteSsrHook.ts", import.meta.url);

test("UOC only appears as a plugin launcher and legacy links stay absent in both states", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const windowPlugins = ["pi-manager", "fleet-companion"];
  const pins: PinState = {
    pins: windowPlugins.map((pluginID) => ({ kind: "plugin", pluginID })),
    seen: windowPlugins,
  };
  const disabledKey = "evejs-web-plugins-disabled:v1";
  const values = new Map([
    ["evejs-web-plugin-pins:v1", JSON.stringify(pins)],
    [disabledKey, JSON.stringify(["uoc"])],
  ]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });

  const Hangar = (await import("../ui/PilotHangar.svelte")).default;
  const renderHangar = () => render(Hangar, {
    props: { onlineIDs: new Set<number>(), onLaunch: async () => {}, onShowPilot() {}, onOpenGlobal() {} },
  }).body;
  const legacy = /href="\/(?:mining-command-center|pilot-training|goblin-factory|ship-provisioning|courier|distribution-center|combat-operations-center)(?:["/?#])/;

  const disabled = await activatePagePlugins(PLUGINS, PLUGIN_VIEWS);
  assert.deepEqual(disabled.map(({ id, state }) => [id, state]), [
    ["pi-manager", "active"], ["fleet-companion", "active"], ["uoc", "disabled"],
  ]);
  assert.equal(pluginPageAt("/uoc/"), undefined);
  const otherLaunchers = pluginLaunchers(pins, pluginWindowGroups(), new Set()).map(({ key }) => key);
  assert.equal(otherLaunchers.length, 2);
  const withoutUoc = renderHangar();
  assert.doesNotMatch(withoutUoc, legacy);
  assert.doesNotMatch(withoutUoc, /data-launch="plugin:uoc"/);

  values.set(disabledKey, "[]");
  const [enabled] = await activatePagePlugins(
    PLUGINS.filter(({ id }) => id === "uoc"),
    PLUGIN_VIEWS.filter(({ id }) => id === "uoc"),
  );
  assert.equal(enabled?.state, "active");
  const page = pluginPageAt("/uoc/");
  assert.ok(page);
  assert.equal(pluginPageAt("/uoc/distribution-center/"), page);
  assert.equal(pluginPageAt("/uoc-other/"), undefined);
  assert.equal(isGlobalTab("plugin:uoc"), false);

  const groups = pluginWindowGroups();
  const seen = meetPlugins(pins, groups);
  const launchers = pluginLaunchers(seen, groups, new Set());
  assert.deepEqual(launchers.map(({ key }) => key), [...otherLaunchers, "plugin:uoc"]);
  assert.equal(launchers[2]?.kind, "page");
  const group = groups.find(({ plugin }) => plugin.id === "uoc")!;
  assert.deepEqual(group.windows, []);
  const unpinned = togglePlugin(seen, group);
  assert.equal(meetPlugins(unpinned, groups), unpinned);
  assert.deepEqual(pluginLaunchers(unpinned, groups, new Set()).map(({ key }) => key), otherLaunchers);

  // The browser creates this store again on reload. Use the same pin reducer in this test process.
  pinStore().set(seen);
  const withUoc = renderHangar();
  assert.doesNotMatch(withUoc, legacy);
  assert.match(withUoc, /<a[^>]+data-launch="plugin:uoc"[^>]+href="\/uoc\/"[^>]+target="_blank"[^>]+rel="noopener"/);
  for (const html of [withoutUoc, withUoc]) {
    for (const key of ["botManager", "industryManager", ...otherLaunchers, "plugins"]) {
      assert.ok(html.includes(`data-launch="${key}"`), key);
    }
  }
  const order = [...otherLaunchers, "plugin:uoc", "plugins"].map((key) => withUoc.indexOf(`data-launch="${key}"`));
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
});

test("a page requires a browser view; the backend can load the same manifest without Svelte", () => {
  const manifest = definePlugin({
    id: "dashboard", name: "Dashboard", apiVersion: 1, version: "1.0.0", description: "Dashboard", page: {},
  });
  assert.equal(pluginProblem(manifest, null), null);
  assert.match(pluginProblem(manifest, { id: manifest.id, windows: {} }) ?? "", /page has nothing to draw/);
});
