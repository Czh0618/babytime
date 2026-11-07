import { localDateTime } from "./date.ts";
import { CARE_LABELS } from "./care-types.ts";
import type { CareKind, CareObservation } from "./care-types.ts";
import type { EntryDraft } from "../types.ts";

/**
 * 一键快记：默认当前时间，只写确定的事实（喂了 / 换了 / 睡着了 / 醒来了）。
 * 数量、时长留空，家长可以在记录里补充。
 */

export type QuickKind = "feeding" | "diaper" | "asleep" | "awake";

export const QUICK_ACTIONS: ReadonlyArray<{
  id: QuickKind;
  label: string;
  title: string;
}> = [
  { id: "feeding", label: "喂奶", title: "喂奶记录" },
  { id: "diaper", label: "尿布", title: "换尿布记录" },
  { id: "asleep", label: "睡着", title: "睡眠记录" },
  { id: "awake", label: "醒来", title: "醒来记录" },
];

function careFor(kind: QuickKind): CareObservation {
  if (kind === "feeding")
    return { kind: "feeding" satisfies CareKind, sourceText: "快记：喂奶" };
  if (kind === "diaper")
    return { kind: "diaper", diaper: "changed", sourceText: "快记：换尿布" };
  return {
    kind: "sleep",
    sleepState: kind === "awake" ? "awake" : "asleep",
    sourceText: kind === "awake" ? "快记：醒来" : "快记：睡着",
  };
}

export function quickCareDraft(kind: QuickKind, now = new Date()): EntryDraft {
  const action = QUICK_ACTIONS.find((item) => item.id === kind)!;
  const care = careFor(kind);
  return {
    title: action.title,
    note: "",
    capturedAt: localDateTime(now),
    tag: CARE_LABELS[care.kind],
    milestone: false,
    care,
  };
}

export function quickActionLabel(kind: QuickKind): string {
  return QUICK_ACTIONS.find((item) => item.id === kind)!.label;
}

/**
 * 点「醒来」时把进行中的「睡着」补成一段睡眠：改同一条记录，不另起一条。
 * 不足 1 分钟（或时钟回拨）按 1 分钟记，避免保存时被判成 0。
 */
export function wakeUpCare(
  care: CareObservation,
  asleepAt: string,
  now = new Date(),
): CareObservation {
  const minutes = Math.round((now.getTime() - Date.parse(asleepAt)) / 60_000);
  return {
    ...care,
    sleepState: "duration",
    durationMinutes: Math.max(1, minutes),
    sourceText: [care.sourceText, "快记：醒来"].filter(Boolean).join("；"),
  };
}

/**
 * 补记一段睡眠：只填「几点睡着、几点醒来」（HH:mm）。醒来取不晚于现在的最近一次，
 * 睡着取醒来之前的最近一次，跨午夜自动算到前一天；没填或两个时间相同返回 null。
 */
export function manualSleepDraft(
  asleep: string,
  awake: string,
  now = new Date(),
): EntryDraft | null {
  const clock = /^(\d{2}):(\d{2})/;
  const a = clock.exec(asleep);
  const b = clock.exec(awake);
  if (!a || !b || asleep === awake) return null;
  const end = new Date(now);
  end.setHours(Number(b[1]), Number(b[2]), 0, 0);
  if (end > now) end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setHours(Number(a[1]), Number(a[2]), 0, 0);
  if (start >= end) start.setDate(start.getDate() - 1);
  return {
    ...quickCareDraft("asleep", start),
    care: {
      kind: "sleep",
      sleepState: "duration",
      durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
      sourceText: `补记：${asleep} 睡着，${awake} 醒来`,
    },
  };
}
