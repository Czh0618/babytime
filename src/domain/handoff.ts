import type { GrowthEntry } from "../types.ts";
import { formatTime, localDate } from "./date.ts";
import {
  describeCare,
  lastMedicineEntry,
  summarizeMilk,
  summarizeTemperature,
} from "./care-records.ts";
import { deriveSleepSegments, formatMinutes, sleepSummaryForDay } from "./sleep.ts";
import { aggregateByDay } from "./stats.ts";

/**
 * 今日交接摘要：给家人或阿姨看的一段话，全部由本机数据生成。
 * 只陈述记录到的数字，不给建议。
 */

export function buildHandoffSummary(
  entries: GrowthEntry[],
  options: { name?: string; today?: string; now?: Date } = {},
): string {
  const today = options.today ?? localDate();
  const now = options.now ?? new Date();
  const name = options.name || "宝宝";
  const day = aggregateByDay(entries, 1, today)[0]!;
  const milk = summarizeMilk(entries, today);
  const sleep = sleepSummaryForDay(deriveSleepSegments(entries), today);

  if (!day.hasData && !sleep.totalMinutes) return "";

  const parts: string[] = [];
  if (day.feedingCount)
    parts.push(
      `${name}今天喂奶 ${day.feedingCount} 次${milk.intakeMl ? `、共 ${milk.intakeMl} ml` : ""}`,
    );
  if (sleep.totalMinutes) parts.push(`睡眠 ${formatMinutes(sleep.totalMinutes)}`);
  if (day.diaperCount)
    parts.push(
      `尿布 ${day.diaperCount} 次（尿湿 ${day.wetCount}、便便 ${day.dirtyCount}）`,
    );

  const extra: string[] = [];
  const temperature = summarizeTemperature(entries, today);
  if (temperature)
    extra.push(`最近体温 ${temperature.maxC}℃（${formatTime(temperature.at)}）`);
  const medicine = lastMedicineEntry(entries, now);
  if (medicine && medicine.capturedAt.slice(0, 10) === today)
    extra.push(
      `上次用药 ${formatTime(medicine.capturedAt)} ${describeCare(medicine.care!)}`,
    );

  if (!parts.length && !extra.length) return "";
  return `${parts.join("；")}${parts.length ? "。" : ""}${extra.length ? `${extra.join("，")}。` : ""}`;
}

/** 提取文本里的数字，用来校验 AI 改写有没有编造新数字。 */
export function numbersIn(text: string): string[] {
  return (text.match(/[0-9]+(?:\.[0-9]+)?/g) ?? []).map((value) =>
    value.replace(/\.0+$/, ""),
  );
}

/**
 * AI 改写后的数字必须都能在原摘要里找到，否则整段丢弃。
 * 只允许少说，不允许新增。
 */
export function numbersConsistent(output: string, source: string): boolean {
  const allowed = new Set(numbersIn(source));
  return numbersIn(output).every((value) => allowed.has(value));
}
