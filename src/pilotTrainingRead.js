"use strict";

const training = require("./pilotTraining");
const fittingAuthority = require("./pilotTrainingFittings");

function trainingError(code, message = code, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

async function readMinerPilot({ store, gateway, data, account, characterID, selections, sheet: providedSheet }) {
  const library = await fittingAuthority.readAccountCorpFittings({ store, gateway, data,
    accountID: account.accountID, characterID });
  if (library.status === "NOT_OWNED") throw trainingError("CHARACTER_NOT_FOUND", "Account does not own this pilot.", 404);
  if (library.status !== "READY") throw trainingError("CORPORATION_FITTINGS_UNAVAILABLE", "Corporation fitting authority is unavailable.", 503);
  const fittings = fittingAuthority.resolveStageFittings(training.STAGES, library.fittings, selections, library.corporationID);
  const sheet = providedSheet === undefined ? await gateway.getSkills(account.accountID, characterID) : providedSheet;
  if (!sheet) throw trainingError("SKILL_STATE_UNAVAILABLE", "Skill state is unreadable.", 503);
  let report;
  try {
    report = training.buildMinerReport(data, sheet, { characterID, name: library.character.characterName, account: account.username }, fittings);
  } catch (error) {
    throw trainingError("STATIC_SKILL_DATA_UNAVAILABLE", error.message, 503);
  }
  return { sheet, read: { report, queue: sheet.queue || null, corporationID: library.corporationID,
    fittings: library.fittings.map((fit) => ({ fittingID: fit.fittingID, ownerID: fit.ownerID || library.corporationID,
      shipTypeID: fit.shipTypeID || null, name: fit.name || "Invalid fitting", savedDate: fit.savedDate || null,
      fingerprint: fit.fingerprint || null, items: fit.items || [], invalid: fit.invalid === true, reason: fit.reason || null })) } };
}

module.exports = { readMinerPilot, trainingError };
