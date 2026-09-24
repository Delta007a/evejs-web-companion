"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { reconnectCandidate, hasPendingRecovery } = require("./droneRecoveryGate");

test("only locally owned disconnected drones are reconnect candidates", () => {
  assert.equal(reconnectCandidate({ ownerID: 42, controllerID: null }, 42), true);
  assert.equal(reconnectCandidate({ ownerID: 42, controllerID: 0 }, 42), true);
  assert.equal(reconnectCandidate({ ownerID: 42, controllerID: 50 }, 42), false);
  assert.equal(reconnectCandidate({ ownerID: 43, controllerID: null }, 42), false);
  assert.equal(reconnectCandidate({ ownerID: null, controllerID: null }, 42), null);
  assert.equal(reconnectCandidate({ ownerID: 42 }, 42), null);
});

test("server handoff blocks its held pilot until browser recovery is ready", () => {
  const held = { characterID: 42, droneRecoveryReady: false };
  assert.equal(hasPendingRecovery(held, 42), true);
  assert.equal(hasPendingRecovery(held, 1), false);
  assert.equal(hasPendingRecovery(null, 42), false);
  held.droneRecoveryReady = true;
  assert.equal(hasPendingRecovery(held, 42), false);
});
