export type CareKind =
  | "feeding"
  | "sleep"
  | "diaper"
  | "note"
  | "temperature"
  | "medicine"
  | "vaccination"
  | "measurement";

export type TemperatureSite = "ear" | "forehead" | "armpit" | "rectal";

export const TEMPERATURE_SITES: readonly TemperatureSite[] = [
  "ear",
  "forehead",
  "armpit",
  "rectal",
];

export const SITE_LABELS: Record<TemperatureSite, string> = {
  ear: "耳温",
  forehead: "额温",
  armpit: "腋下",
  rectal: "肛温",
};

/** 体温合理范围；超出就要求家长核对，不做任何判断。 */
export const TEMPERATURE_MIN = 34;
export const TEMPERATURE_MAX = 43;

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

export const FEEDING_METHOD_LABELS: Record<FeedingMethod, string> = {
  breast: "亲喂",
  "bottle-formula": "配方奶",
  "bottle-breastmilk": "瓶喂母乳",
  solid: "辅食",
  pump: "吸奶",
};

/** 照护记录里的可选细分字段；全部可选，旧数据没有这些字段也能正常加载。 */
export interface CareFields {
  feedingMethod?: FeedingMethod;
  breastSide?: BreastSide;
  leftMinutes?: number;
  rightMinutes?: number;
  feedingMinutes?: number;
  food?: string;
  reaction?: string;
  /** 体温，摄氏度。 */
  temperatureC?: number;
  /** 测温部位。 */
  site?: TemperatureSite;
  /** 药名，保留家长说的原文。 */
  medicineName?: string;
  /** 剂量，保留原文，例如「2.5ml」；不做任何换算或推荐。 */
  dose?: string;
  /** 疫苗缩写（对应 vaccines-2026.ts），仅接种记录使用。 */
  vaccineCode?: string;
  /** 疫苗名称，语音里说的原文。 */
  vaccineName?: string;
  /** 生长测量：体重 kg、身高 cm、头围 cm。 */
  weightKg?: number;
  heightCm?: number;
  headCm?: number;
}

/** 测量的合理范围；只用于拦住明显输错，不做任何判断。 */
export const MEASURE_RANGES = {
  weightKg: { min: 0.5, max: 40, label: "体重", unit: "kg" },
  heightCm: { min: 20, max: 130, label: "身高", unit: "cm" },
  headCm: { min: 20, max: 60, label: "头围", unit: "cm" },
} as const;

/** 体重、身高/身长、头围最多保留两位小数；界面 step 与数据校验共用。 */
export const MEASURE_DECIMALS = 2;

/** 语音或 AI 给出的更多位小数收敛到两位，避免草稿在界面上被原生校验拦住。 */
export function roundMeasure(value: number): number {
  const factor = 10 ** MEASURE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** 是否没有超过两位小数；容差用于避开浮点乘法误差。 */
export function hasMeasurePrecision(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const scaled = value * 10 ** MEASURE_DECIMALS;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
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
  temperature: "体温",
  medicine: "用药",
  vaccination: "接种",
  measurement: "测量",
};

/** 手动记录里「放进哪一类」与照护类型的对应关系，非照护标签返回 undefined。 */
const TAG_CARE_KINDS: Record<string, CareKind> = {
  喂奶: "feeding",
  睡眠: "sleep",
  换尿布: "diaper",
  日常备注: "note",
  体温: "temperature",
  用药: "medicine",
  接种: "vaccination",
  测量: "measurement",
};

export function careFromTag(
  tag: string,
  sourceText = "",
): CareObservation | undefined {
  const kind = TAG_CARE_KINDS[tag];
  return kind ? { kind, sourceText } : undefined;
}
