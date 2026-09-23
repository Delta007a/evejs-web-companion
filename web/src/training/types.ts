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
  readonly fitName: string;
  readonly hullTypeID: number;
  readonly hard: readonly RequirementRow[];
  readonly support: readonly RequirementRow[];
  readonly skillQualification: QualificationState;
  readonly equipmentReadiness: QualificationState;
  readonly equipmentReason: string;
}

export type PlanEta =
  | { readonly kind: "READY"; readonly remainingMs: number }
  | { readonly kind: "SERVER_QUEUE"; readonly completionMs: number; readonly remainingMs: number }
  | { readonly kind: "UNKNOWN"; readonly reason: string };

export interface PlanPreview {
  readonly stage: string | null;
  readonly targets: readonly RequirementRow[];
  readonly eta: PlanEta;
}

export interface MinerReport {
  readonly role: "MINER";
  readonly policyVersion: number;
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
}
