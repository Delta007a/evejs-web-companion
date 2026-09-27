export type SkillTargetState = "TRAINED" | "TRAINING" | "QUEUED" | "MISSING" | "UNKNOWN";
export type QualificationState = "READY" | "NOT_READY" | "UNKNOWN";

export interface RequirementRow {
  readonly typeID: number;
  readonly name: string;
  readonly level: number;
  readonly trainedLevel: number | null;
  readonly skillPoints: number | null;
  readonly state: SkillTargetState;
  readonly queuePosition: number;
}

export interface MinerStage {
  readonly id: string;
  readonly supportPolicyKey: string;
  readonly fitName: string;
  readonly hullTypeID: number;
  readonly fitting: StageFittingState;
  readonly hard: readonly RequirementRow[];
  readonly support: readonly RequirementRow[];
  readonly skillQualification: QualificationState;
  readonly equipmentReadiness: QualificationState;
  readonly equipmentReason: string;
}

export interface StageFittingSelection {
  readonly scope: "CORPORATION";
  readonly ownerID: number;
  readonly fittingID: number;
  readonly acceptedSavedDate?: string;
  readonly acceptedFingerprint?: string;
}

export interface StageFittingState {
  readonly status: "READY" | "UNCONFIGURED" | "INVALID_FIT" | "UNKNOWN" | "REVIEW_REQUIRED";
  readonly fittingID?: number;
  readonly name?: string;
  readonly reason?: string;
  readonly acceptedFingerprint?: string | null;
  readonly acceptedSavedDate?: string | null;
  readonly currentFingerprint?: string;
  readonly currentSavedDate?: string;
}

export interface CorporationSavedFitting {
  readonly fittingID: number;
  readonly ownerID: number;
  readonly shipTypeID: number | null;
  readonly name: string;
  readonly savedDate: string | null;
  readonly fingerprint: string | null;
  readonly items: readonly { readonly typeID: number; readonly flagID: number; readonly quantity: number }[];
  readonly invalid: boolean;
  readonly reason: string | null;
}

export interface MinerTrainingRead {
  readonly queue?: TrainingQueue | null;
  readonly report: MinerReport;
  readonly corporationID: number;
  readonly fittings: readonly CorporationSavedFitting[];
}

export type PlanEta =
  | { readonly kind: "READY"; readonly remainingMs: number }
  | { readonly kind: "SERVER_QUEUE"; readonly completionMs: number; readonly remainingMs: number }
  | { readonly kind: "UNKNOWN"; readonly reason: string };

export interface PlanPreview {
  readonly requirements?: readonly RequirementRow[];
  readonly stage: string | null;
  readonly targets: readonly RequirementRow[];
  readonly eta: PlanEta;
}

export interface MinerReport {
  readonly role: "MINER";
  readonly policyVersion: number;
  readonly trainingState: "TRAINING" | "QUEUED" | "IDLE" | "UNKNOWN";
  readonly pilot: { readonly characterID: number; readonly name: string; readonly account: string };
  readonly currentStage: string | null;
  readonly currentStageStatus: QualificationState;
  readonly nextStage: string | null;
  readonly stages: readonly MinerStage[];
  readonly previews: Readonly<Record<"FAST" | "BALANCED" | "MASTERY", PlanPreview>>;
}

export interface TrainingCharacter {
  readonly characterID: number;
  readonly name: string;
  readonly corporationID?: number | null;
  readonly corporationName?: string | null;
}

export interface QueueItem { readonly typeID: number; readonly toLevel: number; readonly name?: string }
export interface TrainingQueue {
  readonly active: boolean;
  readonly maxEntries: number;
  readonly entries: readonly (QueueItem & { readonly startTimeMs?: number | null; readonly endTimeMs?: number | null })[];
}
export interface QueueReview {
  readonly mode: "FAST" | "BALANCED" | "MASTERY";
  readonly stage: string | null;
  readonly reviewID: string | null;
  readonly expiresAt: number;
  readonly canApply: boolean;
  readonly status: "REVIEW_READY" | "BLOCKED" | "NOTHING_TO_ADD";
  readonly activate: boolean;
  readonly maxEntries: number | null;
  readonly existing: readonly QueueItem[];
  readonly additions: readonly QueueItem[];
  readonly requirements: readonly (RequirementRow & { readonly reviewState: "ALREADY_TRAINED" | "ALREADY_QUEUED" | "WILL_APPEND" | "BLOCKED" | "UNKNOWN" })[];
  readonly blockers: readonly { readonly code: string; readonly message: string; readonly typeID: number | null }[];
  readonly queue: TrainingQueue | null;
  readonly fresh: MinerTrainingRead;
}
export interface QueueApplyOutcome {
  readonly status: "APPLIED" | "REFUSED" | "APPLY_UNVERIFIED";
  readonly verified: boolean;
  readonly mode: "FAST" | "BALANCED" | "MASTERY";
  readonly stage: string;
  readonly at: number;
  readonly added: number | null;
  readonly attemptedAdditions: number;
  readonly code: string | null;
  readonly message: string;
  readonly fresh: MinerTrainingRead | null;
  readonly queue: TrainingQueue | null;
}
