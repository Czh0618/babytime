import { localDateTime } from "./date.ts";
import type { VoiceDraft } from "./care-types.ts";

/**
 * 亲喂 / 睡眠计时器：只做确定性的时间换算，不含界面与存储。
 * 页面被系统杀掉后重新打开，只要还能读到开始时间，计时就能恢复。
 */

export type TimerKind = "feeding" | "sleep";
export type TimerSide = "left" | "right";

export interface ActiveTimer {
  kind: TimerKind;
  /** 第一次开始的时间（YYYY-MM-DDTHH:mm），用作记录时间。 */
  startedAt: string;
  /** 当前这一段开始的时间；换边后更新。 */
  segmentAt: string;
  /** 仅亲喂：当前这一段在哪一侧。 */
  side?: TimerSide;
  /** 仅亲喂：换边前已经累计的分钟。 */
  accumulated?: { left: number; right: number };
}

const TIMER_KINDS: readonly TimerKind[] = ["feeding", "sleep"];
const TIMER_SIDES: readonly TimerSide[] = ["left", "right"];

function validStamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    !Number.isNaN(Date.parse(value))
  );
}

function validMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** 解析本地存储里的计时状态；任何不完整或损坏的内容都当作没有计时。 */
export function parseActiveTimer(raw: string | null | undefined): ActiveTimer | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!TIMER_KINDS.includes(record.kind as TimerKind)) return null;
  if (!validStamp(record.startedAt) || !validStamp(record.segmentAt)) return null;
  if (Date.parse(record.segmentAt) < Date.parse(record.startedAt)) return null;
  if (record.side !== undefined && !TIMER_SIDES.includes(record.side as TimerSide))
    return null;
  const timer: ActiveTimer = {
    kind: record.kind as TimerKind,
    startedAt: record.startedAt,
    segmentAt: record.segmentAt,
  };
  if (record.kind === "feeding") {
    if (!record.side) return null;
    timer.side = record.side as TimerSide;
    const accumulated = record.accumulated as Record<string, unknown> | undefined;
    if (accumulated !== undefined) {
      if (!validMinutes(accumulated.left) || !validMinutes(accumulated.right))
        return null;
      timer.accumulated = { left: accumulated.left, right: accumulated.right };
    }
  }
  return timer;
}

export function startTimer(
  kind: TimerKind,
  now = new Date(),
  side: TimerSide = "left",
): ActiveTimer {
  const stamp = localDateTime(now);
  return kind === "feeding"
    ? {
        kind,
        startedAt: stamp,
        segmentAt: stamp,
        side,
        accumulated: { left: 0, right: 0 },
      }
    : { kind, startedAt: stamp, segmentAt: stamp };
}

function segmentSeconds(timer: ActiveTimer, now: Date): number {
  const value = (now.getTime() - Date.parse(timer.segmentAt)) / 1000;
  // 时钟回拨或设备时间被改动时不给负数。
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function totalSeconds(timer: ActiveTimer, now: Date): number {
  const value = (now.getTime() - Date.parse(timer.startedAt)) / 1000;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function elapsedSeconds(timer: ActiveTimer, now = new Date()): number {
  return timer.kind === "sleep"
    ? totalSeconds(timer, now)
    : segmentSeconds(timer, now);
}

/** 亲喂左右两侧各自的分钟数（含正在进行的这一段，四舍五入到分钟）。 */
export function feedingSideMinutes(
  timer: ActiveTimer,
  now = new Date(),
): { left: number; right: number } {
  const base = timer.accumulated ?? { left: 0, right: 0 };
  const current = segmentSeconds(timer, now) / 60;
  return {
    left: Math.round(base.left + (timer.side === "left" ? current : 0)),
    right: Math.round(base.right + (timer.side === "right" ? current : 0)),
  };
}

/** 换边：把当前这段计入累计，再从此刻重新计时。 */
export function switchTimerSide(
  timer: ActiveTimer,
  side: TimerSide,
  now = new Date(),
): ActiveTimer {
  if (timer.kind !== "feeding" || timer.side === side) return timer;
  const minutes = feedingSideMinutes(timer, now);
  return {
    ...timer,
    side,
    segmentAt: localDateTime(now),
    accumulated: minutes,
  };
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${pad(minutes)}:${pad(rest)}`;
}

function spokenDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

/**
 * 结束计时后生成的草稿：走现有确认流程，不直接落库。
 * 不足一分钟按 1 分钟记，避免保存时被判成 0。
 */
export function timerDraft(timer: ActiveTimer, now = new Date()): VoiceDraft {
  const total = Math.max(1, Math.round(totalSeconds(timer, now) / 60));
  const base = {
    id: `timer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    capturedAt: timer.startedAt,
    needsTimeConfirmation: false,
    note: "",
    amountMl: undefined,
    durationMinutes: undefined,
    sleepState: undefined,
    diaper: undefined,
  };
  if (timer.kind === "sleep") {
    return {
      ...base,
      kind: "sleep",
      title: "睡眠记录",
      durationMinutes: total,
      sleepState: "duration",
      sourceText: `计时记录：睡了 ${spokenDuration(total)}`,
    };
  }
  const minutes = feedingSideMinutes(timer, now);
  // 两侧都是 0（刚点开就结束、或时钟被回拨）时，按当前所在的一侧记 1 分钟。
  if (!minutes.left && !minutes.right) {
    if (timer.side === "right") minutes.right = 1;
    else minutes.left = 1;
  }
  const left = minutes.left > 0 ? minutes.left : undefined;
  const right = minutes.right > 0 ? minutes.right : undefined;
  const parts = [
    left ? `左 ${left} 分` : "",
    right ? `右 ${right} 分` : "",
  ].filter(Boolean);
  return {
    ...base,
    kind: "feeding",
    title: "喂奶记录",
    feedingMethod: "breast",
    breastSide: left && right ? "both" : left ? "left" : "right",
    leftMinutes: left,
    rightMinutes: right,
    sourceText: parts.length
      ? `计时记录：亲喂 ${parts.join(" / ")}`
      : "计时记录：亲喂",
  };
}
