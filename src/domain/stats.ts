import type { GrowthEntry } from "../types.ts";
import { localDate } from "./date.ts";
import {
  deriveSleepSegments,
  splitSegmentByDay,
  type SleepSegment,
} from "./sleep.ts";
import { nightWindow } from "./night.ts";

/** 按天聚合照护记录；睡眠段按自然日切分，吸出量不计入摄入。 */
export interface DayStats {
  date: string;
  /** 这一天是否有任何记录；缺数据的天在图表里留空，而不是画成 0。 */
  hasData: boolean;
  feedingCount: number;
  intakeMl: number;
  pumpedMl: number;
  sleepMinutes: number;
  diaperCount: number;
  wetCount: number;
  dirtyCount: number;
}

function emptyDay(date: string): DayStats {
  return {
    date,
    hasData: false,
    feedingCount: 0,
    intakeMl: 0,
    pumpedMl: 0,
    sleepMinutes: 0,
    diaperCount: 0,
    wetCount: 0,
    dirtyCount: 0,
  };
}

export function dateRange(days: number, today = localDate()): string[] {
  const end = new Date(`${today}T12:00`);
  const result: string[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(end);
    day.setDate(day.getDate() - offset);
    result.push(localDate(day));
  }
  return result;
}

export function aggregateByDay(
  entries: GrowthEntry[],
  days: number,
  today = localDate(),
): DayStats[] {
  const dates = dateRange(days, today);
  const buckets = new Map<string, DayStats>(
    dates.map((date) => [date, emptyDay(date)]),
  );
  for (const entry of entries) {
    const bucket = buckets.get(entry.capturedAt.slice(0, 10));
    const care = entry.care;
    if (!bucket || !care) continue;
    bucket.hasData = true;
    if (care.kind === "feeding") {
      bucket.feedingCount++;
      if (care.amountMl) {
        if (care.feedingMethod === "pump") bucket.pumpedMl += care.amountMl;
        else bucket.intakeMl += care.amountMl;
      }
    } else if (care.kind === "diaper") {
      bucket.diaperCount++;
      if (care.diaper === "wet") bucket.wetCount++;
      if (care.diaper === "dirty") bucket.dirtyCount++;
      if (care.diaper === "mixed") {
        bucket.wetCount++;
        bucket.dirtyCount++;
      }
    }
  }
  // 睡眠由「睡着/醒来」配对而来，跨午夜时分别计入两天。
  for (const segment of deriveSleepSegments(entries)) {
    for (const part of splitSegmentByDay(segment)) {
      const bucket = buckets.get(part.date);
      if (bucket) {
        bucket.sleepMinutes += part.minutes;
        bucket.hasData = true;
      }
    }
  }
  return dates.map((date) => buckets.get(date)!);
}

export type TrendMetric = "intake" | "sleep" | "diaper";

export const TREND_METRICS: Array<{ id: TrendMetric; label: string; unit: string }> = [
  { id: "intake", label: "奶量", unit: "ml" },
  { id: "sleep", label: "睡眠", unit: "小时" },
  { id: "diaper", label: "尿布", unit: "次" },
];

export function metricValue(day: DayStats, metric: TrendMetric): number {
  if (metric === "sleep") return day.sleepMinutes / 60;
  if (metric === "diaper") return day.diaperCount;
  return day.intakeMl;
}

export interface NightSummary {
  wakeCount: number;
  longestSleepMinutes: number;
}

/** 基于同一份按天聚合数据，统计昨夜（前一天 22:00–当天 06:00）的醒来次数与最长连续睡眠。 */
export function nightSummary(
  entries: GrowthEntry[],
  segments: SleepSegment[],
  now: Date,
): NightSummary {
  const { start, end } = nightWindow(now);
  const inWindow = (value: string) => {
    const time = Date.parse(value);
    return time >= start.getTime() && time < end.getTime();
  };
  const wakeCount = entries.filter(
    (entry) =>
      entry.care?.kind === "sleep" &&
      entry.care.sleepState === "awake" &&
      inWindow(entry.capturedAt),
  ).length;
  let longestSleepMinutes = 0;
  for (const segment of segments) {
    if (!segment.end || segment.minutes === null) continue;
    const overlap =
      Math.min(Date.parse(segment.end), end.getTime()) -
      Math.max(Date.parse(segment.start), start.getTime());
    if (overlap > 0)
      longestSleepMinutes = Math.max(longestSleepMinutes, overlap / 60_000);
  }
  return { wakeCount, longestSleepMinutes };
}
