"use strict";
const { randomUUID } = require("node:crypto");
const { readMinerPilot, trainingError } = require("./pilotTrainingRead");
const { planFingerprint } = require("./pilotTrainingQueue");

function createFactorySkills({ store, gateway, data, queues, sessions, now = Date.now, loadPilot = readMinerPilot }) {
  const reviews = new Map();
  const refs = (account, characterID, funding) => [{ account, characterID }, ...(funding ? [funding] : [])];
  async function review(context, request, funding) {
    const q = await queues.review(context.account, request);
    if (q.blockers.some((row) => row.code !== "SKILLBOOK_REQUIRED")) throw trainingError("ACQUISITION_BLOCKED", "Resolve unknown skills, invalid queue or fitting review first.");
    const ids = [...new Set(q.blockers.filter((row) => row.code === "SKILLBOOK_REQUIRED").map((row) => row.typeID))].sort((a, b) => a - b);
    if (!ids.length) throw trainingError("NOTHING_TO_ACQUIRE", "Skills are already injected; review the queue.");
    const policy = request.policy || "CHARACTER_WALLET_ONLY";
    if (!["CHARACTER_WALLET_ONLY", "CHARACTER_PLUS_CORPORATION_SHORTFALL"].includes(policy)) throw trainingError("INVALID_FUNDING_POLICY");
    if (policy === "CHARACTER_PLUS_CORPORATION_SHORTFALL" && !funding) throw trainingError("FUNDING_AUTHORITY_REQUIRED");
    if (policy === "CHARACTER_WALLET_ONLY") funding = null;
    const result = await sessions.withSessions(refs(context.account, request.characterID, funding), async ([trainee, officer]) =>
      gateway.quoteFactorySkills({ trainee, officer, skillTypeIDs: ids, policy, division: request.division }));
    const { reviewID: runtimeReviewID, ...quote } = result.value;
    const released = result.cleanup.every((row) => row.released);
    const reviewID = randomUUID();
    for (const [id, item] of reviews) if (item.expiresAt <= now()) reviews.delete(id);
    while (reviews.size >= 100) reviews.delete(reviews.keys().next().value);
    if (quote.canAcquire && released) reviews.set(reviewID, { accountID: context.account.accountID, sessionID: context.sessionID,
      characterID: request.characterID, mode: request.mode, stage: q.stage, targetStage: request.targetStage || null, selections: structuredClone(request.selections || {}),
      planHash: planFingerprint(q.fresh.report, request.mode), funding: funding ? { accountID: funding.account.accountID, sessionID: funding.sessionID, characterID: funding.characterID } : null,
      runtimeReviewID, expiresAt: quote.expiresAt });
    return { ...quote, reviewID: quote.canAcquire && released ? reviewID : null, canAcquire: quote.canAcquire && released,
      mode: request.mode, stage: q.stage, cleanup: result.cleanup,
      skills: quote.skills.map((row) => ({ ...row, name: data.getSkillType(row.typeID)?.name || `Skill ${row.typeID}` })) };
  }
  async function acquire(context, request, funding) {
    if (request.confirm !== true) throw trainingError("CONFIRMATION_REQUIRED", "Explicit skill acquisition confirmation is required.", 400);
    const review = reviews.get(request.reviewID);
    if (!review || review.accountID !== context.account.accountID || review.sessionID !== context.sessionID || review.expiresAt <= now()) throw trainingError("REVIEW_REQUIRED");
    reviews.delete(request.reviewID);
    if (review.funding && (!funding || funding.account.accountID !== review.funding.accountID || funding.sessionID !== review.funding.sessionID || funding.characterID !== review.funding.characterID)) throw trainingError("FUNDING_AUTHORITY_CHANGED");
    if (!review.funding) funding = null;
    const current = await loadPilot({ store, gateway, data, account: context.account, characterID: review.characterID, selections: review.selections, targetStage: review.targetStage });
    if (planFingerprint(current.read.report, review.mode) !== review.planHash) throw trainingError("PLAN_CHANGED", "Stage, fitting or plan changed. Review again.");
    let result;
    try {
      result = await sessions.withSessions(refs(context.account, review.characterID, funding), async ([trainee, officer]) => {
        try { return await gateway.acquireFactorySkills({ trainee, officer, reviewID: review.runtimeReviewID, confirm: true }); }
        catch (error) {
          if (error.statusCode >= 400 && error.statusCode < 500) throw error;
          return { status: "ACQUISITION_UNVERIFIED", verified: false, errorCode: error.code, purchased: [], missing: [],
            funded: null, wallet: null, message: "Financial outcome unknown. Inspect authoritative skills and wallets; no retry was made." };
        }
      });
    } catch (error) {
      return { status: "ACQUISITION_REFUSED", verified: false, errorCode: error.code, message: error.message,
        cleanup: error.cleanup || [], mode: review.mode, stage: review.stage, at: now(), fresh: null };
    }
    let fresh = null;
    try { fresh = (await loadPilot({ store, gateway, data, account: context.account, characterID: review.characterID, selections: review.selections, targetStage: review.targetStage })).read; } catch { /* outcome still reports verified runtime facts */ }
    return { ...result.value, cleanup: result.cleanup, mode: review.mode, stage: review.stage, at: now(), fresh,
      readyForQueueReview: result.value.verified && result.cleanup.every((row) => row.released) };
  }
  return { review, acquire };
}
module.exports = { createFactorySkills };
