import type { CareObservation, VoiceDraft } from "./care-types.ts";
import type { GrowthEntry, Workspace } from "../types.ts";
import { validateVoiceDraft, voiceDraftToEntry } from "./voice-parser.ts";
import { validateEntry } from "./records.ts";
import { createId } from "./id.ts";

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
  if (care.kind === "feeding")
    return care.amountMl ? `${care.amountMl} ml` : "已记录喂奶";
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
