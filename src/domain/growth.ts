import type { BabyProfile, EntryDraft, GrowthEntry } from "../types.ts";
import { localDateTime } from "./date.ts";

/**
 * 生长曲线只画家长自己记录的测量点。
 * 百分位参考线需要 WS/T 423-2022 标准原文的数据，未录入前不画、也不做任何「偏高/偏矮」判断。
 */

export type GrowthMetric = "weightKg" | "heightCm" | "headCm";

export const GROWTH_METRICS: ReadonlyArray<{
  id: GrowthMetric;
  label: string;
  unit: string;
}> = [
  { id: "weightKg", label: "体重", unit: "kg" },
  { id: "heightCm", label: "身高", unit: "cm" },
  { id: "headCm", label: "头围", unit: "cm" },
];

const DAYS_PER_MONTH = 30.4375;

/** 早产儿 2 周岁前按矫正月龄画：把预产期当作起点。 */
export function correctedBirthDate(baby: BabyProfile): {
  date: string;
  corrected: boolean;
} {
  if (baby.dueDate && baby.birthDate && baby.dueDate > baby.birthDate)
    return { date: baby.dueDate, corrected: true };
  return { date: baby.birthDate, corrected: false };
}

function dayNumber(date: string): number {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}

export function monthsBetween(from: string, to: string): number {
  const value = (dayNumber(to) - dayNumber(from)) / DAYS_PER_MONTH;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export interface GrowthPoint {
  date: string;
  /** 横轴月龄（早产按矫正月龄）。 */
  months: number;
  value: number;
}

export function growthSeries(
  entries: GrowthEntry[],
  baby: BabyProfile,
  metric: GrowthMetric,
): GrowthPoint[] {
  const origin = correctedBirthDate(baby);
  if (!origin.date) return [];
  const points: GrowthPoint[] = [];
  for (const entry of entries) {
    const care = entry.care;
    if (!care || care.kind !== "measurement") continue;
    const value = care[metric];
    if (value === undefined || !Number.isFinite(value)) continue;
    if (!entry.capturedAt) continue;
    points.push({
      date: entry.capturedAt,
      months: monthsBetween(origin.date, entry.capturedAt),
      value,
    });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

export interface MeasurementSnapshot {
  date: string;
  weightKg?: number;
  heightCm?: number;
  headCm?: number;
}

export function latestMeasurement(
  entries: GrowthEntry[],
): MeasurementSnapshot | undefined {
  const latest = [...entries]
    .filter((entry) => entry.care?.kind === "measurement" && entry.capturedAt)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
  if (!latest) return undefined;
  return {
    date: latest.capturedAt,
    weightKg: latest.care?.weightKg,
    heightCm: latest.care?.heightCm,
    headCm: latest.care?.headCm,
  };
}

export function measurementDraft(
  values: { weightKg?: number; heightCm?: number; headCm?: number },
  now = new Date(),
): EntryDraft {
  return {
    title: "生长测量记录",
    note: "",
    capturedAt: localDateTime(now),
    tag: "测量",
    milestone: false,
    care: {
      kind: "measurement",
      ...values,
      sourceText: "手动记录测量",
    },
  };
}
