// Name the failed part of a script observation without changing its authority
// or retry policy. In particular, session-loss codes must remain BridgeCallError
// so the runner still stops immediately instead of treating logout as a read blip.
import { BridgeCallError } from "../bridge/callMethod.ts";

export async function scriptObservationRead<T>(source: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof BridgeCallError) {
      throw new BridgeCallError(error.code, `${source}: ${error.message}`, error.status, error.diagnosis);
    }
    throw new Error(`${source}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
