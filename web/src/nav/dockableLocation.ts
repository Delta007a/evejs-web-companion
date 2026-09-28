import type { FlightStatus } from "../store/types.ts";

/** Identity shared by ordinary destinations, parking and training Home. */
export type DockableKind = "station" | "structure";

export interface DockableLocation {
  readonly kind: DockableKind;
  readonly id: number;
  readonly name: string;
  readonly solarSystemID: number;
  readonly solarSystemName: string | null;
}

/** Runtime structureDirectory service IDs. This is an access-scoped list, not
 * the owner-only operational structure directory. An unreadable list is null. */
export type DockableCapability = "dock" | "personalInventory" | "corporationHangar" |
  "fitting" | "repair" | "reprocessing" | "market" | "industry";

const STRUCTURE_SERVICE: Readonly<Record<Exclude<DockableCapability, "personalInventory">, number>> = {
  dock: 1,
  fitting: 2,
  corporationHangar: 3,
  reprocessing: 4,
  market: 5,
  repair: 8,
  industry: 20,
};

export function structureHasCapability(serviceIDs: readonly number[] | null, capability: DockableCapability): boolean {
  if (serviceIDs === null) return false;
  if (capability === "personalInventory") return serviceIDs.includes(STRUCTURE_SERVICE.dock);
  return serviceIDs.includes(STRUCTURE_SERVICE[capability]);
}

/** An NPC station and a player structure occupy different flight-status slots. */
export function dockedAt(status: FlightStatus | null | undefined, location: Pick<DockableLocation, "kind" | "id">): boolean {
  return status?.docked === true &&
    (location.kind === "structure" ? status.structureID : status.stationID) === location.id;
}
