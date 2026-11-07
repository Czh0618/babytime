import type { BabyProfile, GrowthEntry } from "../types.ts";
import { dayAge, localDate } from "./date.ts";

/**
 * 纪念日：满月、百天、生日、那年今日。
 * 全部在本机按日期判断，不联网、不推送。
 */

export interface Anniversary {
  key: string;
  title: string;
  detail: string;
}

function sameMonthDay(left: string, right: string): boolean {
  return left.slice(5, 10) === right.slice(5, 10);
}

export function findAnniversary(
  baby: BabyProfile,
  entries: GrowthEntry[],
  today = localDate(),
): Anniversary | null {
  if (!baby.birthDate || baby.birthDate > today) return null;
  const name = baby.name || "宝宝";
  const days = dayAge(baby.birthDate, today);

  if (days === 30)
    return {
      key: `full-month-${today}`,
      title: `${name}满月了`,
      detail: "出生第 30 天。可以为这一天留一张照片，或者写一句话。",
    };
  if (days === 100)
    return {
      key: `hundred-${today}`,
      title: `${name}百天了`,
      detail: "出生第 100 天。这段时间的记录都在时间轴里。",
    };

  const birthYear = Number(baby.birthDate.slice(0, 4));
  const currentYear = Number(today.slice(0, 4));
  if (sameMonthDay(baby.birthDate, today) && currentYear > birthYear) {
    const years = currentYear - birthYear;
    return {
      key: `birthday-${today}`,
      title: `${name}${years} 岁生日`,
      detail: `${years} 年前的今天出生。可以挑几张这一年最喜欢的照片。`,
    };
  }

  // 那年今日：同月同日的往年记录，用最近的那个往年做标题。
  const past = entries
    .filter(
      (entry) =>
        entry.capturedAt.slice(5, 10) === today.slice(5, 10) &&
        Number(entry.capturedAt.slice(0, 4)) < currentYear,
    )
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  if (past.length) {
    const first = past[0]!;
    const yearsAgo = currentYear - Number(first.capturedAt.slice(0, 4));
    return {
      key: `on-this-day-${today}`,
      title: `${yearsAgo} 年前的今天`,
      detail: `那天有 ${past.length} 条记录，最近的一条是「${first.title}」。`,
    };
  }
  return null;
}
