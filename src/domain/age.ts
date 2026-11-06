export interface AgeOn {
  months: number;
  days: number;
  valid: boolean;
}

const DAY = 86_400_000;

function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return date;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addCalendarMonths(date: Date, months: number): Date {
  const targetMonth = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

/**
 * 以日历月计算年龄，避免用“天数除以30”造成月末偏差。
 * 出生日期或查询日期无效、查询日期早于出生日期时返回 valid=false。
 */
export function ageOn(birthDate: string, today = localDate()): AgeOn {
  const birth = parseDate(birthDate);
  const target = parseDate(today);
  if (!birth || !target || target < birth)
    return { months: 0, days: 0, valid: false };

  let months =
    (target.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    target.getUTCMonth() -
    birth.getUTCMonth();
  let anniversary = addCalendarMonths(birth, months);
  if (anniversary > target) {
    months -= 1;
    anniversary = addCalendarMonths(birth, months);
  }
  return {
    months,
    days: Math.floor((target.getTime() - anniversary.getTime()) / DAY),
    valid: true,
  };
}
import { localDate } from "./date.ts";
