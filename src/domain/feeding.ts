import type { GrowthEntry } from "../types.ts";

/**
 * 下次喂奶参考：取最近若干次喂奶间隔的中位数，只给一个参考时间点。
 * 样本不足、间隔异常或上一次喂奶太久以前，就不显示，避免误导。
 */

export interface NextFeedingReference {
  /** HH:mm，参考的下一次喂奶时间。 */
  time: string;
  /** 参与计算的间隔数量。 */
  sampleSize: number;
  /** 参考时间已经过去了。 */
  passed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL = 30;
const MAX_INTERVAL = 600;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function nextFeedingReference(
  entries: GrowthEntry[],
  now = new Date(),
  maxSamples = 5,
): NextFeedingReference | null {
  const nowMs = now.getTime();
  const times = entries
    .filter(
      (entry) =>
        entry.care?.kind === "feeding" &&
        // 吸奶不等于喂宝宝，不能拿来做喂奶间隔。
        entry.care.feedingMethod !== "pump" &&
        Boolean(entry.capturedAt),
    )
    .map((entry) => Date.parse(entry.capturedAt))
    .filter((value) => Number.isFinite(value) && value <= nowMs)
    .sort((a, b) => a - b);
  if (times.length < 2) return null;

  const intervals: number[] = [];
  for (let index = 1; index < times.length; index++)
    intervals.push((times[index]! - times[index - 1]!) / 60_000);
  const recent = intervals
    .slice(-maxSamples)
    .filter((value) => value >= MIN_INTERVAL && value <= MAX_INTERVAL);
  // 少于 3 个间隔时中位数没有意义，宁可不显示。
  if (recent.length < 3) return null;

  const last = times[times.length - 1]!;
  // 上一次喂奶超过一天，说明今天没有在照护记录里，别拿旧间隔推算。
  if (nowMs - last > DAY_MS) return null;

  const next = new Date(last + median(recent) * 60_000);
  return {
    time: clock(next),
    sampleSize: recent.length,
    passed: next.getTime() < nowMs,
  };
}
