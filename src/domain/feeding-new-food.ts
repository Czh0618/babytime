import type { GrowthEntry } from "../types.ts";

/**
 * P8.5.2：新食物引入记录完全由已有的 `care.food` / `care.reaction` 派生，
 * 不新增任何字段。食物名只做去首尾空格后的精确匹配，不猜同义词；
 * 归并不了的名字按原文各算一项，取它最早出现的那一天与同条记录的反应备注。
 * 这里只列「第一次吃」的日期，不计算观察天数、不给判断。
 */

export interface FirstFood {
  name: string;
  /** 首次出现的日期，YYYY-MM-DD。 */
  date: string;
  /** 首次那条记录里写下的反应备注。 */
  reaction?: string;
}

export function firstFoodIntroductions(entries: GrowthEntry[]): FirstFood[] {
  const rows = entries
    .filter(
      (entry) =>
        typeof entry.care?.food === "string" &&
        entry.care.food.trim() &&
        entry.capturedAt,
    )
    .map((entry) => ({
      name: entry.care!.food!.trim(),
      date: entry.capturedAt.slice(0, 10),
      at: entry.capturedAt,
      reaction: entry.care!.reaction?.trim() || undefined,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const first = new Map<string, FirstFood>();
  for (const row of rows)
    if (!first.has(row.name))
      first.set(row.name, {
        name: row.name,
        date: row.date,
        ...(row.reaction ? { reaction: row.reaction } : {}),
      });
  return [...first.values()].sort((a, b) => a.date.localeCompare(b.date));
}
