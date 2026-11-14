import type { GrowthEntry } from "../types.ts";
import type { SleepKind } from "./care-types.ts";
import { localDate, localDateTime } from "./date.ts";

/**
 * 从已有的照护记录推导睡眠段，不迁移、不改写任何数据。
 * 只有睡着没有醒来记为「进行中」；连续两条睡着只保留后一条；
 * 带 durationMinutes 的记录直接成段。
 */

export interface SleepSegment {
  start: string;
  /** null 表示进行中（尚未记录醒来）。 */
  end: string | null;
  minutes: number | null;
  ongoing: boolean;
  source: "paired" | "duration" | "ongoing";
  /** 睡眠类型：家长选过用手动值，否则按入睡时刻推断。 */
  kind: SleepKind;
}

/**
 * 按入睡时刻推断小睡还是夜睡：19:00 至次日 06:00 记夜睡，其余记小睡。
 * 只做这一个粗分，不碰深浅睡眠——那需要脑电、眼动、肌电才能判读。
 */
export function inferSleepKind(start: string): SleepKind {
  const hour = Number(start.slice(11, 13));
  if (!Number.isFinite(hour)) return "nap";
  return hour >= 19 || hour < 6 ? "night" : "nap";
}

function kindOf(entry: GrowthEntry): SleepKind {
  return entry.care?.sleepKind ?? inferSleepKind(entry.capturedAt);
}

export interface SleepDaySummary {
  totalMinutes: number;
  longestMinutes: number;
  segmentCount: number;
}

function addMinutes(value: string, minutes: number): string {
  return localDateTime(
    new Date(Date.parse(value) + minutes * 60_000),
  );
}

export function deriveSleepSegments(entries: GrowthEntry[]): SleepSegment[] {
  const events = entries
    .filter((entry) => entry.care?.kind === "sleep" && entry.capturedAt)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const segments: SleepSegment[] = [];
  let pending: { at: string; kind: SleepKind } | null = null;
  for (const entry of events) {
    const care = entry.care!;
    if (care.durationMinutes && care.durationMinutes > 0) {
      segments.push({
        start: entry.capturedAt,
        end: addMinutes(entry.capturedAt, care.durationMinutes),
        minutes: care.durationMinutes,
        ongoing: false,
        source: "duration",
        kind: kindOf(entry),
      });
      pending = null;
      continue;
    }
    if (care.sleepState === "awake") {
      if (pending) {
        const minutes =
          (Date.parse(entry.capturedAt) - Date.parse(pending.at)) / 60_000;
        if (minutes > 0)
          segments.push({
            start: pending.at,
            end: entry.capturedAt,
            minutes,
            ongoing: false,
            source: "paired",
            kind: pending.kind,
          });
        pending = null;
      }
      continue;
    }
    // asleep 或未标注状态都视为「睡着了」；连续两条只保留后一条。
    pending = { at: entry.capturedAt, kind: kindOf(entry) };
  }
  if (pending)
    segments.push({
      start: pending.at,
      end: null,
      minutes: null,
      ongoing: true,
      source: "ongoing",
      kind: pending.kind,
    });
  return segments;
}

/** 超过 24 小时还没点「醒来」，当作忘了点，不再往上续。 */
const ONGOING_LIMIT_MS = 24 * 60 * 60_000;

/**
 * 正在睡的那条记录：不晚于现在的最近一条睡眠记录仍是「睡着」（没醒来、没时长）。
 * 判断规则与 deriveSleepSegments 的「进行中」一致，供快记「醒来」续上同一条记录。
 */
export function ongoingSleep(
  entries: GrowthEntry[],
  now = new Date(),
): GrowthEntry | undefined {
  let latest: GrowthEntry | undefined;
  for (const entry of entries) {
    if (entry.care?.kind !== "sleep" || !entry.capturedAt) continue;
    if (Date.parse(entry.capturedAt) > now.getTime()) continue;
    // 同一时刻取后一条，与排序后逐条配对的结果一致。
    if (!latest || entry.capturedAt >= latest.capturedAt) latest = entry;
  }
  const care = latest?.care;
  if (!latest || !care) return undefined;
  if (care.sleepState === "awake" || (care.durationMinutes ?? 0) > 0)
    return undefined;
  return now.getTime() - Date.parse(latest.capturedAt) <= ONGOING_LIMIT_MS
    ? latest
    : undefined;
}

/** 跨午夜的睡眠按自然日切分，进行中的段不参与统计。 */
export function splitSegmentByDay(
  segment: SleepSegment,
): Array<{ date: string; minutes: number }> {
  if (!segment.end || segment.minutes === null) return [];
  const start = Date.parse(segment.start);
  const end = Date.parse(segment.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return [];
  const result: Array<{ date: string; minutes: number }> = [];
  let cursor = start;
  while (cursor < end) {
    const day = new Date(cursor);
    const nextDay = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate() + 1,
    );
    const chunkEnd = Math.min(end, nextDay.getTime());
    result.push({
      date: localDate(day),
      minutes: (chunkEnd - cursor) / 60_000,
    });
    cursor = chunkEnd;
  }
  return result;
}

export function sleepSummaryForDay(
  segments: SleepSegment[],
  date: string,
): SleepDaySummary {
  const parts: number[] = [];
  for (const segment of segments) {
    for (const part of splitSegmentByDay(segment)) {
      if (part.date === date && part.minutes > 0) parts.push(part.minutes);
    }
  }
  return {
    totalMinutes: parts.reduce((sum, value) => sum + value, 0),
    longestMinutes: parts.length ? Math.max(...parts) : 0,
    segmentCount: parts.length,
  };
}

export interface SleepDayBreakdown {
  /** 当天小睡段数与总时长。 */
  napCount: number;
  napMinutes: number;
  nightMinutes: number;
  catchUpMinutes: number;
}

/**
 * 按自然日切分后，按睡眠类型分别累加；进行中的段不参与。
 * 只汇总时长和次数，不判断睡得够不够——那是医生的事。
 */
export function sleepBreakdownForDay(
  segments: SleepSegment[],
  date: string,
): SleepDayBreakdown {
  const result: SleepDayBreakdown = {
    napCount: 0,
    napMinutes: 0,
    nightMinutes: 0,
    catchUpMinutes: 0,
  };
  for (const segment of segments) {
    for (const part of splitSegmentByDay(segment)) {
      if (part.date !== date || part.minutes <= 0) continue;
      if (segment.kind === "night") result.nightMinutes += part.minutes;
      else if (segment.kind === "catch-up")
        result.catchUpMinutes += part.minutes;
      else {
        result.napCount++;
        result.napMinutes += part.minutes;
      }
    }
  }
  return result;
}

export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}
