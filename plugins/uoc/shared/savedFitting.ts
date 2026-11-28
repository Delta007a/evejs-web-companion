import { createHash } from "node:crypto";
import { fields, scalar } from "../training/funding.ts";

type FittingIdentity = {
  fittingID?: number;
  corporationID?: number;
  goalTypeID: number;
  fingerprint?: string;
};
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function fittingRow(value: any, fittingID: number | undefined) {
  if (
    value?.type === "object" &&
    String(scalar(value.name)).endsWith("objectCaching.CachedMethodCallResult")
  )
    value = value.args?.[1]?.value;
  if (value?.type !== "dict" || !Array.isArray(value.entries))
    throw Error("Corporation fitting library is unreadable.");
  const matches = value.entries.filter(
    (entry: any) => Array.isArray(entry) && Number(scalar(entry[0])) === fittingID,
  );
  if (matches.length !== 1) throw Error("The selected corporation fitting is unavailable.");
  return fields(matches[0][1]);
}

/** Keep slot flags and quantities, and verify them against the reviewed native definition. */
export function fittingItems(
  value: unknown,
  expected: FittingIdentity,
): [number, number, number][] {
  const fit = fittingRow(value, expected.fittingID);
  if (
    Number(scalar(fit.fittingID)) !== expected.fittingID ||
    Number(scalar(fit.ownerID)) !== expected.corporationID ||
    Number(scalar(fit.shipTypeID)) !== expected.goalTypeID ||
    fit.fitData?.type !== "list" ||
    !Array.isArray(fit.fitData.items) ||
    !fit.fitData.items.length
  )
    throw Error("The selected fitting identity changed.");
  const tuples: [number, number, number][] = fit.fitData.items.map((row: any) => {
    const tuple = Array.isArray(row) ? row : row?.type === "tuple" ? row.items : null;
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 3 ||
      !tuple.every(positive) ||
      !(
        [5, 87, 158].includes(tuple[1]!) ||
        (
          [
            [11, 34],
            [92, 99],
            [125, 132],
            [164, 171],
          ] as const
        ).some(([lo, hi]) => tuple[1]! >= lo && tuple[1]! <= hi)
      )
    )
      throw Error("Fitting contents are unreadable.");
    return tuple as [number, number, number];
  });
  const canonical = [...tuples].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  if (
    createHash("sha256")
      .update(JSON.stringify([expected.goalTypeID, canonical]))
      .digest("hex") !== expected.fingerprint
  )
    throw Error("The selected fitting changed; review again.");
  return tuples;
}
