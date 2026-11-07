import { localDateTime } from "./date.ts";
import type { VoiceDraft } from "./care-types.ts";

/**
 * 亲喂左右两侧计时：只做确定性的时间换算，不含界面与存储。
 * 睡眠改用「记一次 / 醒来 / 补记一觉」，旧版残留的 sleep 计时会被安全忽略。
 * 页面被系统杀掉后重新打开，只要还能读到开始时间，计时就能恢复。
 */

export type TimerKind = "feeding";
export type TimerSide = "left" | "right";

export interface ActiveTimer {
  kind: TimerKind;
  /** 归属的宝宝；旧计时状态没有该字段时默认归当前宝宝。 */
  babyId?: string;
  /** 第一次开始的时间（YYYY-MM-DDTHH:mm），用作记录时间。 */
  startedAt: string;
  /** 当前这一段开始的时间；换边后更新。 */
  segmentAt: string;
  /** 当前这一段在哪一侧。 */
  side: TimerSide;
  /** 换边前已经累计的分钟。 */
  accumulated?: { left: number; right: number };
}

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

/** 解析本地存储里的计时状态；旧 sleep 计时、不完整或损坏的内容都当作没有计时。 */
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
  if (record.kind !== "feeding") return null;
  if (!validStamp(record.startedAt) || !validStamp(record.segmentAt)) return null;
  if (Date.parse(record.segmentAt) < Date.parse(record.startedAt)) return null;
  if (!TIMER_SIDES.includes(record.side as TimerSide)) return null;
  if (
    record.babyId !== undefined &&
    (typeof record.babyId !== "string" || !record.babyId.trim())
  )
    return null;
  const timer: ActiveTimer = {
    kind: "feeding",
    ...(record.babyId ? { babyId: record.babyId as string } : {}),
    startedAt: record.startedAt,
    segmentAt: record.segmentAt,
    side: record.side as TimerSide,
  };
  const accumulated = record.accumulated as Record<string, unknown> | undefined;
  if (accumulated !== undefined) {
    if (!validMinutes(accumulated.left) || !validMinutes(accumulated.right))
      return null;
    timer.accumulated = { left: accumulated.left, right: accumulated.right };
  }
  return timer;
}

/**
 * 按宝宝并存多条计时。兼容旧版的单对象格式，自动丢掉旧 sleep 计时；
 * 同一宝宝只保留最后一条（去重），无 babyId 的旧计时用空键代表当前宝宝。
 */
export function parseActiveTimers(raw: string | null | undefined): ActiveTimer[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = Array.isArray(value) ? value : [value];
  const byBaby = new Map<string, ActiveTimer>();
  for (const item of items) {
    const timer = parseActiveTimer(JSON.stringify(item));
    if (timer) byBaby.set(timer.babyId ?? "", timer);
  }
  return [...byBaby.values()];
}

export function startTimer(
  now = new Date(),
  side: TimerSide = "left",
  babyId?: string,
): ActiveTimer {
  const stamp = localDateTime(now);
  return {
    kind: "feeding",
    ...(babyId ? { babyId } : {}),
    startedAt: stamp,
    segmentAt: stamp,
    side,
    accumulated: { left: 0, right: 0 },
  };
}

function segmentSeconds(timer: ActiveTimer, now: Date): number {
  const value = (now.getTime() - Date.parse(timer.segmentAt)) / 1000;
  // 时钟回拨或设备时间被改动时不给负数。
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function elapsedSeconds(timer: ActiveTimer, now = new Date()): number {
  return segmentSeconds(timer, now);
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
  if (timer.side === side) return timer;
  return {
    ...timer,
    side,
    segmentAt: localDateTime(now),
    accumulated: feedingSideMinutes(timer, now),
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

/**
 * 结束计时后生成的草稿：走现有确认流程，不直接落库。
 * 不足一分钟按 1 分钟记，避免保存时被判成 0。
 */
export function timerDraft(timer: ActiveTimer, now = new Date()): VoiceDraft {
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
    id: `timer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "feeding",
    title: "喂奶记录",
    capturedAt: timer.startedAt,
    needsTimeConfirmation: false,
    note: "",
    feedingMethod: "breast",
    breastSide: left && right ? "both" : left ? "left" : "right",
    leftMinutes: left,
    rightMinutes: right,
    sourceText: parts.length
      ? `计时记录：亲喂 ${parts.join(" / ")}`
      : "计时记录：亲喂",
    amountMl: undefined,
    durationMinutes: undefined,
    sleepState: undefined,
    diaper: undefined,
  };
}
