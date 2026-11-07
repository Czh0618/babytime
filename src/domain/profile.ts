import type { BabyProfile } from "../types.ts";
import { localDate } from "./date.ts";

export type BabySex = "male" | "female";

export const SEX_LABELS: Record<BabySex, string> = {
  male: "男孩",
  female: "女孩",
};

/** 预产期只用于早产矫正月龄，和生日差得太远就属于填错了。 */
const DUE_DATE_TOLERANCE_DAYS = 180;

function dayNumber(date: string): number {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day || month > 12) return false;
  const date = new Date(year, month - 1, day);
  // 2 月 30 日这类会被 Date 顺延，比较回读值才能挡住。
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** 宝宝资料校验：家庭页与保存逻辑共用，旧数据没有新字段也照样通过。 */
export function validateProfile(
  baby: BabyProfile,
  today = localDate(),
): string | null {
  if (!baby.name.trim()) return "请填写宝宝昵称。";
  if (baby.name.trim().length > 30) return "宝宝昵称最多 30 个字。";
  if (!baby.birthDate || !validDate(baby.birthDate))
    return "请填写有效的出生日期。";
  if (baby.birthDate > today) return "生日不能晚于今天。";
  if (baby.sex !== undefined && !["male", "female"].includes(baby.sex))
    return "请选择男孩或女孩，也可以留空。";
  if (baby.dueDate !== undefined && baby.dueDate !== "") {
    if (!validDate(baby.dueDate)) return "预产期格式不正确。";
    if (Math.abs(dayNumber(baby.dueDate) - dayNumber(baby.birthDate)) >
      DUE_DATE_TOLERANCE_DAYS)
      return "预产期和生日相差太大，请核对。";
  }
  return null;
}
