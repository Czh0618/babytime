import type { GrowthEntry } from "../types.ts";
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
  let pendingStart: string | null = null;
  for (const entry of events) {
    const care = entry.care!;
    if (care.durationMinutes && care.durationMinutes > 0) {
      segments.push({
        start: entry.capturedAt,
        end: addMinutes(entry.capturedAt, care.durationMinutes),
        minutes: care.durationMinutes,
        ongoing: false,
        source: "duration",
      });
      pendingStart = null;
      continue;
    }
    if (care.sleepState === "awake") {
      if (pendingStart) {
        const minutes =
          (Date.parse(entry.capturedAt) - Date.parse(pendingStart)) / 60_000;
        if (minutes > 0)
          segments.push({
            start: pendingStart,
            end: entry.capturedAt,
            minutes,
            ongoing: false,
            source: "paired",
          });
        pendingStart = null;
      }
      continue;
    }
    // asleep 或未标注状态都视为「睡着了」；连续两条只保留后一条。
    pendingStart = entry.capturedAt;
  }
  if (pendingStart)
    segments.push({
      start: pendingStart,
      end: null,
      minutes: null,
      ongoing: true,
      source: "ongoing",
    });
  return segments;
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

export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}
