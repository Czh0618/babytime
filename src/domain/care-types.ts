export type CareKind = "feeding" | "sleep" | "diaper" | "note";

export type FeedingMethod =
  | "breast"
  | "bottle-formula"
  | "bottle-breastmilk"
  | "solid"
  | "pump";

export type BreastSide = "left" | "right" | "both";

export const FEEDING_METHODS: readonly FeedingMethod[] = [
  "breast",
  "bottle-formula",
  "bottle-breastmilk",
  "solid",
  "pump",
];

export const BREAST_SIDES: readonly BreastSide[] = ["left", "right", "both"];

/** 照护记录里的可选细分字段；全部可选，旧数据没有这些字段也能正常加载。 */
export interface CareFields {
  feedingMethod?: FeedingMethod;
  breastSide?: BreastSide;
  leftMinutes?: number;
  rightMinutes?: number;
  feedingMinutes?: number;
  food?: string;
  reaction?: string;
}

export interface CareObservation extends CareFields {
  kind: CareKind;
  amountMl?: number;
  durationMinutes?: number;
  sleepState?: "asleep" | "awake" | "duration";
  diaper?: "wet" | "dirty" | "mixed" | "changed";
  sourceText: string;
  /** 一次确认批次内的唯一标识，防止重复保存。 */
  inputId?: string;
}

export interface VoiceDraft extends CareFields {
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
  /** AI 输出里越界字段被丢弃时，提示家长核对。 */
  reviewNote?: string;
}

export const CARE_LABELS: Record<CareKind, string> = {
  feeding: "喂奶",
  sleep: "睡眠",
  diaper: "换尿布",
  note: "日常备注",
};

/** 手动记录里「放进哪一类」与照护类型的对应关系，非照护标签返回 undefined。 */
const TAG_CARE_KINDS: Record<string, CareKind> = {
  喂奶: "feeding",
  睡眠: "sleep",
  换尿布: "diaper",
  日常备注: "note",
};

export function careFromTag(
  tag: string,
  sourceText = "",
): CareObservation | undefined {
  const kind = TAG_CARE_KINDS[tag];
  return kind ? { kind, sourceText } : undefined;
}
