export type CareKind = "feeding" | "sleep" | "diaper" | "note";

export interface CareObservation {
  kind: CareKind;
  amountMl?: number;
  durationMinutes?: number;
  sleepState?: "asleep" | "awake" | "duration";
  diaper?: "wet" | "dirty" | "mixed" | "changed";
  sourceText: string;
  /** 一次确认批次内的唯一标识，防止重复保存。 */
  inputId?: string;
}

export interface VoiceDraft {
  id: string;
  kind: CareKind;
  title: string;
  note: string;
  capturedAt: string;
  needsTimeConfirmation: boolean;
  timeHint?: string;
  amountMl?: number;
  durationMinutes?: number;
  sleepState?: "asleep" | "awake" | "duration";
  diaper?: "wet" | "dirty" | "mixed" | "changed";
  sourceText: string;
}

export const CARE_LABELS: Record<CareKind, string> = {
  feeding: "喂奶",
  sleep: "睡眠",
  diaper: "换尿布",
  note: "日常备注",
};
