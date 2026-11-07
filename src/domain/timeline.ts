import type { GrowthEntry } from "../types.ts";
import { describeCare } from "./care-records.ts";

/** 时间线按天分组：同一天的照护记录折叠成一行摘要，照片文字记录照常展开。 */

export interface TimelineDay {
  date: string;
  /** 当天的全部记录，按时间倒序。 */
  entries: GrowthEntry[];
  /** 折叠进摘要的照护记录（两条以上才折叠）。 */
  care: GrowthEntry[];
  /** 照片、文字等非照护记录，始终逐条显示。 */
  memories: GrowthEntry[];
  careSummary: string;
}

export interface TimelinePage {
  days: TimelineDay[];
  hasMore: boolean;
  totalDays: number;
}

/** 折叠阈值：当天有 2 条以上照护记录才折叠，单独一条照常显示。 */
export const COLLAPSE_THRESHOLD = 2;

function summarize(care: GrowthEntry[]): string {
  let feeding = 0;
  let intakeMl = 0;
  let sleep = 0;
  let diaper = 0;
  let note = 0;
  for (const entry of care) {
    const item = entry.care!;
    if (item.kind === "feeding") {
      feeding++;
      if (item.amountMl && item.feedingMethod !== "pump") intakeMl += item.amountMl;
    } else if (item.kind === "sleep") sleep++;
    else if (item.kind === "diaper") diaper++;
    else note++;
  }
  const parts: string[] = [];
  if (feeding)
    parts.push(
      intakeMl ? `喂奶 ${feeding} 次（${intakeMl} ml）` : `喂奶 ${feeding} 次`,
    );
  if (sleep) parts.push(`睡眠 ${sleep} 条`);
  if (diaper) parts.push(`尿布 ${diaper} 次`);
  if (note) parts.push(`备注 ${note} 条`);
  return parts.join(" · ");
}

/**
 * 按天分组并只取最近 `limitDays` 个有记录的日子。
 * 先分组再切片，避免一次渲染整条时间线。
 */
export function buildTimeline(
  entries: GrowthEntry[],
  limitDays: number,
): TimelinePage {
  const buckets = new Map<string, GrowthEntry[]>();
  for (const entry of entries) {
    const date = entry.capturedAt.slice(0, 10);
    if (!date) continue;
    const bucket = buckets.get(date);
    if (bucket) bucket.push(entry);
    else buckets.set(date, [entry]);
  }
  const dates = [...buckets.keys()].sort((a, b) => b.localeCompare(a));
  const visible = dates.slice(0, Math.max(1, limitDays));
  const days = visible.map((date) => {
    const all = buckets
      .get(date)!
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const care = all.filter((entry) => entry.care);
    return {
      date,
      entries: all,
      care: care.length >= COLLAPSE_THRESHOLD ? care : [],
      memories: care.length >= COLLAPSE_THRESHOLD
        ? all.filter((entry) => !entry.care)
        : all,
      careSummary: care.length >= COLLAPSE_THRESHOLD ? summarize(care) : "",
    };
  });
  return { days, hasMore: dates.length > visible.length, totalDays: dates.length };
}

/** 分类筛选只列日常最高频的照护类型；测量、接种等仍可用关键词搜到。 */
export type TimelineCareFilter =
  | "all"
  | "feeding"
  | "sleep"
  | "diaper"
  | "temperature"
  | "medicine";

export const TIMELINE_CARE_FILTERS: ReadonlyArray<{
  id: TimelineCareFilter;
  label: string;
}> = [
  { id: "all", label: "全部类型" },
  { id: "feeding", label: "喂奶" },
  { id: "sleep", label: "睡眠" },
  { id: "diaper", label: "换尿布" },
  { id: "temperature", label: "体温" },
  { id: "medicine", label: "用药" },
];

/** 关键词匹配标题、备注、标签、整理后的照护内容、原话与照护里的文字字段。 */
export function matchesTimelineQuery(entry: GrowthEntry, keyword: string): boolean {
  const query = keyword.trim().toLocaleLowerCase();
  if (!query) return true;
  const care = entry.care;
  const parts: string[] = [entry.title, entry.note, entry.tag];
  if (care) {
    parts.push(describeCare(care));
    for (const value of Object.values(care))
      if (typeof value === "string") parts.push(value);
  }
  return parts.some((part) => part?.toLocaleLowerCase().includes(query));
}

export function hasTimelineQuery(
  keyword: string,
  care: TimelineCareFilter,
): boolean {
  return Boolean(keyword.trim()) || care !== "all";
}

/** 搜索或照护分类筛选：先按类别收窄，再按关键词匹配，两个条件同时生效。 */
export function filterTimelineEntries(
  entries: GrowthEntry[],
  keyword = "",
  care: TimelineCareFilter = "all",
): GrowthEntry[] {
  if (!hasTimelineQuery(keyword, care)) return entries;
  const query = keyword.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      (care === "all" || entry.care?.kind === care) &&
      matchesTimelineQuery(entry, query),
  );
}
