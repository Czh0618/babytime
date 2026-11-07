import type { GrowthEntry, RecapDraft } from "../types.ts";
import { localDate } from "./date.ts";
import { dateRange } from "./stats.ts";

/**
 * 月度回顾草稿：按收藏与里程碑预选上个月的素材。
 * 只生成草稿，家长点确认后才会保存成回顾。
 */

export function previousMonthRange(today = localDate()): {
  from: string;
  to: string;
  month: number;
  year: number;
} {
  const [year, month] = today.split("-").map(Number);
  const target = new Date(year!, month! - 2, 1);
  const from = localDate(target);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0);
  return {
    from,
    to: localDate(lastDay),
    month: target.getMonth() + 1,
    year: target.getFullYear(),
  };
}

export function suggestMonthlyRecap(
  entries: GrowthEntry[],
  today = localDate(),
): RecapDraft | null {
  const range = previousMonthRange(today);
  const inRange = entries.filter(
    (entry) =>
      entry.capturedAt.slice(0, 10) >= range.from &&
      entry.capturedAt.slice(0, 10) <= range.to,
  );
  if (!inRange.length) return null;

  // 优先收藏与里程碑；不够 3 条时补上有照片/视频的记录。
  const picked = inRange.filter((entry) => entry.favorite || entry.milestone);
  const pool =
    picked.length >= 3
      ? picked
      : [
          ...picked,
          ...inRange.filter(
            (entry) => !picked.includes(entry) && Boolean(entry.mediaId),
          ),
        ];
  if (!pool.length) return null;

  const entryIds = pool
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .slice(0, 12)
    .map((entry) => entry.id);

  return {
    title: `${range.month} 月的小日子`,
    entryIds,
    dateFrom: range.from,
    dateTo: range.to,
  };
}

/** 今天的记录按天聚合用的日期列表，供交接摘要复用。 */
export function todayRange(today = localDate()): string[] {
  return dateRange(1, today);
}
