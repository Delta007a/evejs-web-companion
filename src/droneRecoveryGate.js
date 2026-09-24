"use strict";

// The gateway's current-scene drone projection carries ownerID and
// controllerID. Null controller means disconnected; any positive controller
// is a connected flight (possibly another hull) and must not be recovered.
function reconnectCandidate(row, characterID) {
  if (!Number.isSafeInteger(row.ownerID) ||
      !(row.controllerID === null || Number.isSafeInteger(row.controllerID))) return null;
  return characterID > 0 && row.ownerID === characterID &&
    (row.controllerID === null || row.controllerID === 0);
}

function hasPendingRecovery(held, characterID) {
  return !!held && Number(held.characterID) === characterID && !held.droneRecoveryReady;
}

module.exports = { reconnectCandidate, hasPendingRecovery };
