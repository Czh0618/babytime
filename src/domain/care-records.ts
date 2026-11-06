import type { CareObservation, VoiceDraft } from "./care-types.ts";
import type { GrowthEntry, Workspace } from "../types.ts";
import { validateVoiceDraft, voiceDraftToEntry } from "./voice-parser.ts";
import { validateEntry } from "./records.ts";
import { createId } from "./id.ts";
import { localDate } from "./date.ts";

export function addVoiceEntries(
  workspace: Workspace,
  drafts: VoiceDraft[],
  batchId: string,
  makeId = createId,
): number {
  if (!batchId || !drafts.length) throw new Error("请先整理至少一条记录。");
  if (drafts.length > 12) throw new Error("一次最多确认 12 条，请分批记录。");
  if (new Set(drafts.map((draft) => draft.id)).size !== drafts.length)
    throw new Error("这批记录有重复内容，请重新整理。");
  const existing = new Set(
    workspace.entries.map((entry) => entry.care?.inputId).filter(Boolean),
  );
  const additions: GrowthEntry[] = [];
  for (const draft of drafts) {
    const error = validateVoiceDraft(draft);
    if (error) throw new Error(error);
    const inputId = `${batchId}:${draft.id}`;
    if (existing.has(inputId)) continue;
    const entry = voiceDraftToEntry(draft, inputId);
    const entryError = validateEntry(entry);
    if (entryError) throw new Error(entryError);
    additions.push({ ...entry, id: makeId(), favorite: false });
  }
  workspace.entries.push(...additions);
  return additions.length;
}

export function describeCare(care: CareObservation): string {
  if (care.kind === "feeding") {
    if (care.feedingMethod === "pump")
      return care.amountMl ? `吸奶 ${care.amountMl} ml` : "已记录吸奶";
    if (care.feedingMethod === "solid")
      return care.food ? `辅食 · ${care.food}` : "已记录辅食";
    if (care.feedingMethod === "breast") {
      const parts: string[] = [];
      if (care.leftMinutes) parts.push(`左 ${care.leftMinutes} 分`);
      if (care.rightMinutes) parts.push(`右 ${care.rightMinutes} 分`);
      if (care.feedingMinutes) parts.push(`${care.feedingMinutes} 分钟`);
      return parts.length ? `亲喂 ${parts.join(" / ")}` : "已记录亲喂";
    }
    const method =
      care.feedingMethod === "bottle-formula"
        ? "配方奶"
        : care.feedingMethod === "bottle-breastmilk"
          ? "瓶喂母乳"
          : "";
    return care.amountMl
      ? `${method ? `${method} ` : ""}${care.amountMl} ml`
      : method
        ? `已记录${method}`
        : "已记录喂奶";
  }
  if (care.kind === "sleep") {
    if (care.sleepState === "awake") return "醒来了";
    if (care.durationMinutes) return `${care.durationMinutes} 分钟`;
    return care.sleepState === "asleep" ? "睡着了" : "已记录睡眠";
  }
  if (care.kind === "diaper")
    return (
      {
        wet: "尿湿",
        dirty: "便便",
        mixed: "尿湿和便便",
        changed: "已更换",
      } as const
    )[care.diaper || "changed"];
  return "家长备注";
}

export interface MilkSummary {
  intakeMl: number;
  pumpedMl: number;
}

/** 今日奶量：吸出量单独统计，不计入宝宝摄入。 */
export function summarizeMilk(
  entries: GrowthEntry[],
  onDate = localDate(),
): MilkSummary {
  let intakeMl = 0;
  let pumpedMl = 0;
  for (const entry of entries) {
    const care = entry.care;
    if (
      !care ||
      care.kind !== "feeding" ||
      !care.amountMl ||
      entry.capturedAt.slice(0, 10) !== onDate
    )
      continue;
    if (care.feedingMethod === "pump") pumpedMl += care.amountMl;
    else intakeMl += care.amountMl;
  }
  return { intakeMl, pumpedMl };
}
