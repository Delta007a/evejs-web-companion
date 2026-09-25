import test from "node:test";
import assert from "node:assert/strict";

import { BridgeCallError } from "../bridge/callMethod.ts";
import { scriptObservationRead } from "./scriptObservationRead.ts";
import { isSessionLost } from "./flow.ts";

test("failed ship observation names its read and keeps the authority code", async () => {
  await assert.rejects(
    scriptObservationRead("ship holds", async () => {
      throw new BridgeCallError("NO_ACTIVE_SHIP", "No active ship.", 409);
    }),
    (error: unknown) => error instanceof BridgeCallError &&
      error.code === "NO_ACTIVE_SHIP" && error.status === 409 &&
      error.message === "ship holds: No active ship.",
  );
});

test("a named session-loss observation still fails closed immediately", async () => {
  await assert.rejects(
    scriptObservationRead("space and drones", async () => {
      throw new BridgeCallError("SESSION_NOT_FOUND", "Session ended.", 404);
    }),
    (error: unknown) => isSessionLost(error) &&
      error instanceof Error && error.message === "space and drones: Session ended.",
  );
});
