import type { GrowthEntry } from "../types.ts";
import { CARE_LABELS } from "../domain/care-types.ts";
import { describeCare } from "../domain/care-records.ts";
import { formatTime } from "../domain/date.ts";

/**
 * 所有照护记录的 CSV，带 UTF-8 BOM，Excel 打开不会乱码。
 * 只导出本机已有的文字与数值，不含原片。
 */

const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const CSV_HEADER = [
  "日期",
  "时间",
  "类型",
  "标题",
  "照护内容",
  "标签",
  "备注",
  "里程碑",
  /** P7.1：多图只记张数，不导出素材 id 或原片。 */
  "照片数",
] as const;

export function buildEntriesCsv(entries: GrowthEntry[]): string {
  const rows = [...entries]
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .map((entry) => [
      entry.capturedAt.slice(0, 10),
      formatTime(entry.capturedAt) || "",
      entry.care ? CARE_LABELS[entry.care.kind] : "成长记录",
      entry.title,
      entry.care ? describeCare(entry.care) : "",
      entry.tag,
      entry.note,
      entry.milestone ? "是" : "",
      String((entry.mediaIds ?? []).filter((id) => Boolean(id)).length),
    ]);
  const lines = [Array.from(CSV_HEADER), ...rows].map((row) =>
    row.map(escapeCell).join(","),
  );
  // Excel 需要 BOM 才按 UTF-8 解析。
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
