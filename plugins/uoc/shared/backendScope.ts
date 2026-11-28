import { createHash, randomBytes, randomUUID } from "node:crypto";
import { linkSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { BackendRequest, BackendRoute } from "../../../web/src/plugin-api/backend.ts";

export interface BackendPilotObservation {
  readonly accountName: string;
  readonly characterID: number;
  readonly owner: string;
  readonly online: boolean;
  readonly observedAt: number;
  readonly dock: {
    readonly shipID: number | null;
    readonly systemID: number | null;
    readonly stationID: number | null;
    readonly structureID: number | null;
  } | null;
}

/** Optional fields carried only by hosts that verify them before forwarding a request. */
export interface UocBackendRequest extends BackendRequest {
  readonly worldID?: string | null;
  readonly pilotObservations?: readonly BackendPilotObservation[];
}

const Database = createRequire(import.meta.url)("better-sqlite3");
const worldFile = "world-id.json";
let verifiedWorld: { directory: string; worldID: string } | undefined;

function installationID(value: unknown): value is string {
  return typeof value === "string" && /^wc-install:[a-f0-9]{64}$/.test(value);
}

// Read only the scopes already used by UOC's saved operations, profiles and journals.
// MCC definitions store the scope tuple directly. Launch records nest that tuple in their key.
const storedWorlds = {
  "restored-mining-definitions.sqlite": `
    SELECT CASE WHEN name GLOB 'mining-definitions:*' THEN scope
                ELSE json_extract(scope, '$[0]') END
    FROM (
      SELECT name, json_extract(substr(name, instr(name, ':') + 1), '$[0]') AS scope
      FROM documents WHERE name GLOB 'mining-*:*'
    )`,
  "mining-preparation.sqlite": `
    SELECT json_extract(substr(name, 10), '$[0]') FROM documents WHERE name GLOB 'evidence:*'`,
  "distribution.sqlite": `
    SELECT substr(name, 8) FROM documents WHERE name GLOB 'routes:*'
    UNION SELECT name FROM documents WHERE name GLOB 'wc-install:*'
    UNION SELECT json_extract(record.value, '$.civilian.worldID')
      FROM documents, json_each(documents.value, '$.records') AS record
      WHERE name = 'distribution-missions'
    UNION SELECT json_extract(record.value, '$.row.civilian.worldID')
      FROM documents, json_each(documents.value, '$.history') AS record
      WHERE name = 'distribution-missions'`,
  "civilian-index.sqlite": `
    SELECT substr(name, 10) FROM documents WHERE name GLOB 'profiles:*'
    UNION SELECT json_extract(run.value, '$.worldID')
      FROM documents, json_each(documents.value, '$.rows') AS run WHERE name = 'runs'`,
  "missions.sqlite": `
    SELECT json_extract(value, '$.civilian.worldID')
      FROM documents WHERE name GLOB 'native-mining:*'
    UNION SELECT json_extract(record.value, '$.civilian.worldID')
      FROM documents, json_each(documents.value, '$.history') AS record
      WHERE name GLOB 'native-mining:*'`,
  "training-onboarding.sqlite": `
    SELECT json_extract(value, '$.worldID') FROM documents WHERE name GLOB 'onboarding:*'`,
};

function readStoredWorlds(directory: string): Set<string> {
  const worlds = new Set<string>();
  for (const [name, query] of Object.entries(storedWorlds)) {
    const filename = path.join(directory, name);
    try {
      if (!statSync(filename, { throwIfNoEntry: false })) continue;
      const db = new Database(filename, { readonly: true, fileMustExist: true });
      try {
        const ids: unknown[] = db.prepare(query).pluck().all();
        for (const id of ids) if (typeof id === "string" && id) worlds.add(id);
      } finally {
        db.close();
      }
    } catch (cause) {
      throw new Error(`UOC could not verify the saved world in ${name}.`, { cause });
    }
  }
  return worlds;
}

function readWorldFile(file: string): string | null {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let worldID: unknown;
  try {
    worldID = JSON.parse(content)?.worldID;
  } catch (cause) {
    throw new Error(`UOC ${worldFile} is invalid. Restore the original file.`, { cause });
  }
  if (!installationID(worldID))
    throw new Error(`UOC ${worldFile} is invalid. Restore the original file.`);
  return worldID;
}

function saveWorldFile(file: string, worldID: string): string {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ worldID }) + "\n", { flag: "wx", mode: 0o600 });
    // Publish the complete file without replacing an existing identity.
    linkSync(temporary, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = readWorldFile(file);
    if (existing === null) throw error;
    return existing;
  } finally {
    rmSync(temporary, { force: true });
  }
  return worldID;
}

function initialWorldID(directory: string, worlds: Set<string>): string {
  if (!worlds.size) return "wc-install:" + randomBytes(32).toString("hex");
  const candidates = [...worlds].filter(installationID);
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1) {
    // For an upgrade in place, the old path may identify one of several saved scopes.
    const legacyDirectory = process.platform === "win32" ? directory.toLowerCase() : directory;
    const previous = "wc-install:" + createHash("sha256").update(legacyDirectory).digest("hex");
    if (worlds.has(previous)) return previous;
  }
  throw new Error(`UOC could not identify the previous installation world. Restore its ${worldFile} or provide the world ID through the host.`);
}

export function worldForRequest(request: UocBackendRequest): string | null {
  if (Object.hasOwn(request, "worldID")) return request.worldID ?? null;
  const directory = process.env.EVEJS_PLUGIN_DATA_DIR;
  if (!directory) return null;
  if (verifiedWorld?.directory === directory) return verifiedWorld.worldID;

  const file = path.join(directory, worldFile);
  const saved = readWorldFile(file);
  const worlds = readStoredWorlds(directory);
  const worldID = saved ?? saveWorldFile(file, initialWorldID(directory, worlds));
  if (worlds.size && !worlds.has(worldID))
    throw new Error(`UOC ${worldFile} does not match the saved installation worlds. Restore the original file.`);
  verifiedWorld = { directory, worldID };
  return worldID;
}

export const worldRoute: BackendRoute = (request) => {
  try {
    const worldID = worldForRequest(request);
    return worldID
      ? { body: { ok: true, worldID } }
      : { status: 503, body: { ok: false, error: "UOC_SCOPE_UNAVAILABLE" } };
  } catch (error) {
    return {
      status: 503,
      body: {
        ok: false,
        error: "UOC_SCOPE_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};
