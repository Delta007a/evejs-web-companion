"use strict";
const { trainingError } = require("./pilotTrainingRead");
const { readCorporationRow } = require("../web/src/bridge/corporationRow.ts");

function scalar(value) { return value && typeof value === "object" && "value" in value ? value.value : value; }
function row(value) {
  const fields = readCorporationRow(value);
  if (fields === null) throw trainingError("CORPORATION_STATE_UNKNOWN");
  return fields;
}
module.exports = { row };
