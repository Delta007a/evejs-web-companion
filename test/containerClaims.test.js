"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createLootMemory, CONTAINER_LEASE_MS } = require("../src/lootMemory");

test("claims use system + actual item identity, not a display name/type", () => {
  const memory = createLootMemory();
  assert.equal(memory.claimContainer("one", "run", 1, 100), true);
  assert.equal(memory.claimContainer("two", "run", 2, 100), true);
  assert.equal(memory.claimContainer("three", "run", 1, 101), true);
  assert.equal(memory.claimContainer("four", "run", 1, 100), false);
});

test("release is session/run scoped and old generations cannot release a successor", () => {
  const memory = createLootMemory();
  memory.claimContainer("one", "old", 1, 100);
  memory.releaseClaims("two", "old");
  assert.equal(memory.claimContainer("two", "new", 1, 100), false);
  memory.releaseClaims("one", "old");
  assert.equal(memory.claimContainer("one", "new", 1, 100), true);
  memory.releaseClaims("one", "old");
  assert.equal(memory.claimContainer("two", "new", 1, 100), false);
  memory.releaseClaims("one");
  assert.equal(memory.claimContainer("two", "new", 1, 100), true);
});

test("renew-only cannot resurrect expiry, and switching targets releases the former", () => {
  let now = 0;
  const memory = createLootMemory({ now: () => now });
  memory.claimContainer("one", "run", 1, 100);
  now = CONTAINER_LEASE_MS;
  assert.equal(memory.claimContainer("one", "run", 1, 100, true), false);
  assert.equal(memory.claimContainer("one", "run", 1, 100), true);
  assert.equal(memory.claimContainer("one", "run", 1, 101), true);
  assert.equal(memory.claimContainer("two", "run", 1, 100), true);
});

test("claims never contaminate emptied memory or vice versa", () => {
  const memory = createLootMemory();
  memory.claimContainer("one", "run", 1, 100);
  assert.deepEqual(memory.emptiedItemIDs(1), []);
  memory.markEmptied(1, 100);
  assert.equal(memory.claimContainer("two", "run", 1, 100), false);
  memory.releaseClaims("one");
  assert.deepEqual(memory.emptiedItemIDs(1), [100]);
});

test("invalid identity cannot create a claim", () => {
  const memory = createLootMemory();
  for (const item of [0, -1, null, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => memory.claimContainer("one", "run", 1, item));
  }
});
