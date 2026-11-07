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
