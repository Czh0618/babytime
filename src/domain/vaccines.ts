import {
  HEPB_SPECIAL_DOSES,
  VACCINES_2026,
  VACCINE_BY_CODE,
  type VaccineDoseSpec,
  type VaccineSpec,
} from "../data/vaccines-2026.ts";
import type {
  BabyProfile,
  VaccinationRecord,
  VaccinePlan,
} from "../types.ts";
import { localDate } from "./date.ts";

/**
 * 疫苗日程：全部由静态程序 + 生日推算，确定性计算，不经过 AI。
 * 「6 月龄」按自然月加 6 处理，月末顺延到当月最后一天。
 */

export type VaccineStatus = "done" | "due-soon" | "overdue" | "upcoming";

export const SOON_DAYS = 30;

export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const target = new Date(year!, month! - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day!, lastDay));
  return localDate(target);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const target = new Date(year!, month! - 1, day! + days);
  return localDate(target);
}

export function dosesFor(
  spec: VaccineSpec,
  specialProgram = false,
): readonly VaccineDoseSpec[] {
  return spec.code === "HepB" && specialProgram
    ? HEPB_SPECIAL_DOSES
    : spec.doses;
}

/** 算出这支疫苗每一剂的应种日期。 */
export function doseDates(
  spec: VaccineSpec,
  birthDate: string,
  specialProgram = false,
): Array<{ dose: number; dueDate: string; note?: string }> {
  const result: Array<{ dose: number; dueDate: string; note?: string }> = [];
  let previous: string | undefined;
  for (const item of dosesFor(spec, specialProgram)) {
    let due: string;
    if (item.monthsAfterPrevious !== undefined && previous)
      due = addMonths(previous, item.monthsAfterPrevious);
    else if (item.daysAfterPrevious !== undefined && previous)
      due = addDays(previous, item.daysAfterPrevious);
    else due = addMonths(birthDate, item.months);
    result.push({ dose: item.dose, dueDate: due, note: item.note });
    previous = due;
  }
  return result;
}

export interface VaccineTask {
  code: string;
  name: string;
  dose: number;
  dueDate: string;
  status: VaccineStatus;
  note?: string;
  /** 二选一还没选时，提示家长先确定用哪一支。 */
  pendingChoice?: boolean;
  record?: VaccinationRecord;
}

export function recordFor(
  records: VaccinationRecord[],
  code: string,
  dose: number,
): VaccinationRecord | undefined {
  return records.find((item) => item.code === code && item.dose === dose);
}

export function statusFor(
  dueDate: string,
  record: VaccinationRecord | undefined,
  today = localDate(),
): VaccineStatus {
  if (record) return "done";
  if (dueDate < today) return "overdue";
  if (dueDate <= addDays(today, SOON_DAYS)) return "due-soon";
  return "upcoming";
}

export const STATUS_LABELS: Record<VaccineStatus, string> = {
  done: "已接种",
  "due-soon": "即将到期",
  overdue: "已过期未种",
  upcoming: "未到时间",
};

/** 当前需要显示的程序疫苗：排除不适用性别，二选一按家长选择收敛。 */
export function visibleVaccines(
  profile: BabyProfile,
  plan: VaccinePlan,
): VaccineSpec[] {
  return VACCINES_2026.filter((spec) => {
    if (spec.femaleOnly && profile.sex !== "female") return false;
    if (spec.group === "je" && plan.choices.je && plan.choices.je !== spec.code)
      return false;
    if (
      spec.group === "hepatitis-a" &&
      plan.choices.hepa &&
      plan.choices.hepa !== spec.code
    )
      return false;
    return true;
  });
}

export function vaccineTasks(
  profile: BabyProfile,
  plan: VaccinePlan,
  records: VaccinationRecord[],
  today = localDate(),
): VaccineTask[] {
  if (!profile.birthDate) return [];
  const tasks: VaccineTask[] = [];
  for (const spec of visibleVaccines(profile, plan)) {
    const pendingChoice = Boolean(
      spec.group === "je"
        ? !plan.choices.je
        : spec.group === "hepatitis-a"
          ? !plan.choices.hepa
          : false,
    );
    for (const item of doseDates(spec, profile.birthDate, plan.specialProgram)) {
      const record = recordFor(records, spec.code, item.dose);
      tasks.push({
        code: spec.code,
        name: spec.name,
        dose: item.dose,
        dueDate: item.dueDate,
        status: statusFor(item.dueDate, record, today),
        note: item.note,
        pendingChoice,
        record,
      });
    }
  }
  return tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export interface VaccineSummary {
  overdue: number;
  dueSoon: number;
  done: number;
  total: number;
}

export function summarizeVaccines(tasks: VaccineTask[]): VaccineSummary {
  return {
    overdue: tasks.filter((item) => item.status === "overdue").length,
    dueSoon: tasks.filter((item) => item.status === "due-soon").length,
    done: tasks.filter((item) => item.status === "done").length,
    total: tasks.length,
  };
}

/** 语音说「打了百白破」时，关联到这支疫苗下一剂未种的剂次。 */
export function nextDose(
  records: VaccinationRecord[],
  code: string,
): number | undefined {
  const spec = VACCINE_BY_CODE[code];
  if (!spec) return undefined;
  for (const item of spec.doses)
    if (!recordFor(records, code, item.dose)) return item.dose;
  return undefined;
}

export function defaultVaccinePlan(): VaccinePlan {
  return { specialProgram: false, choices: {} };
}
