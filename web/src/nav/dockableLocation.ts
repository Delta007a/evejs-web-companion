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

/** An NPC station and a player structure occupy different flight-status slots. */
export function dockedAt(status: FlightStatus | null | undefined, location: Pick<DockableLocation, "kind" | "id">): boolean {
  return status?.docked === true &&
    (location.kind === "structure" ? status.structureID : status.stationID) === location.id;
}
