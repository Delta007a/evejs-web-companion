import { CLONE_GRADE_ALPHA, CLONE_GRADE_OMEGA, skillPointsForLevel, skillPointsPerMinute } from "../../training/skillMath.ts";
import { cents } from "../../training/funding.ts";

export type TrainingFundingEstimate = { personalISK: number | null; corporateISK: number | null; shortfallISK: number | null; reason: string | null };

export function estimateTrainingFunding(totalISK: number, balanceISK: unknown, enabled: boolean, wallet?: {balanceISK?: unknown; reason?: string | null}): TrainingFundingEstimate {
  if (totalISK === 0) return { personalISK: 0, corporateISK: 0, shortfallISK: 0, reason: null };
  if (typeof balanceISK !== "number" || !Number.isFinite(balanceISK) || balanceISK < 0)
    return { personalISK: null, corporateISK: null, shortfallISK: null, reason: "The trainee's personal wallet balance could not be read." };
  const personal = Math.min(cents(totalISK), cents(balanceISK)), remaining = cents(totalISK) - personal;
  if (!remaining || !enabled) return { personalISK: personal / 100, corporateISK: 0, shortfallISK: remaining / 100,
    reason: remaining ? "Corporate funding is off." : null };
  if (typeof wallet?.balanceISK !== "number" || !Number.isFinite(wallet.balanceISK) || wallet.balanceISK < 0)
    return { personalISK: personal / 100, corporateISK: null, shortfallISK: null, reason: wallet?.reason ?? "Corporation Master Wallet authority and balance are unavailable." };
  if (cents(wallet.balanceISK) < remaining) return { personalISK: personal / 100, corporateISK: 0, shortfallISK: remaining / 100,
    reason: "The Master Wallet cannot cover the full shortfall. Training does not make a partial transfer." };
  return { personalISK: personal / 100, corporateISK: remaining / 100, shortfallISK: 0, reason: null };
}

type Target = { typeID: number; name: string; level: number; currentLevel: number; queuedLevel: number };
type Skill = { typeID: number; skillPoints?: number };
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export function estimateAdditionalTraining(
  targets: readonly Target[], skills: readonly Skill[], grade: unknown,
  attributes: Readonly<Record<number, number>>, metadata: Readonly<Record<number, Record<number, number>>>,
): { additionalSP: number | null; additionalTrainingMs: number | null; trainingTimeReason: string | null } {
  const missing = (reason: string) => ({ additionalSP: null, additionalTrainingMs: null, trainingTimeReason: reason });
  const uncovered = targets.filter(t => t.level > Math.max(t.currentLevel, t.queuedLevel));
  if (!uncovered.length) return { additionalSP: 0, additionalTrainingMs: 0, trainingTimeReason: null };
  const byType = new Map(skills.map(s => [s.typeID, s]));
  let additionalSP = 0, milliseconds = 0;
  let reason = grade !== CLONE_GRADE_ALPHA && grade !== CLONE_GRADE_OMEGA ? "The trainee's native clone grade is unavailable." : null;
  for (const target of uncovered) {
    const dogma = metadata[target.typeID], rank = dogma?.[275], primaryID = dogma?.[180], secondaryID = dogma?.[181];
    if (!positive(rank)) return missing(`${target.name}: native skill rank is unavailable.`);
    const skill = byType.get(target.typeID), points = skill?.skillPoints;
    const earned = typeof points === "number" && Number.isFinite(points) && points >= 0 ? points : null;
    if (skill && earned === null && target.queuedLevel <= target.currentLevel)
      return missing(`${target.name}: the trainee's native skill points are unavailable.`);
    const covered = Math.max(earned ?? 0, skillPointsForLevel(rank, Math.max(target.queuedLevel, target.currentLevel)));
    const remaining = Math.max(0, skillPointsForLevel(rank, target.level) - covered);
    additionalSP += remaining;
    if (reason) continue;
    if (!positive(primaryID) || !positive(secondaryID)) {
      reason = `${target.name}: native training attribute IDs are unavailable.`;
      continue;
    }
    const primary = attributes[primaryID], secondary = attributes[secondaryID];
    if (!positive(primary) || !positive(secondary)) {
      reason = `${target.name}: the trainee's native training attributes (${primaryID}, ${secondaryID}) are unavailable.`;
      continue;
    }
    const rate = skillPointsPerMinute(primary, secondary) * (grade === CLONE_GRADE_ALPHA ? 0.5 : 1);
    milliseconds += remaining / rate * 60_000;
  }
  return { additionalSP, additionalTrainingMs: reason ? null : milliseconds, trainingTimeReason: reason };
}
