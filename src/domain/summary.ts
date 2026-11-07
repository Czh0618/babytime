import type {
  BabyProfile,
  GrowthEntry,
  VaccinationRecord,
  VaccinePlan,
} from "../types.ts";
import { localDate } from "./date.ts";
import { aggregateByDay, dateRange } from "./stats.ts";
import { describeCare } from "./care-records.ts";
import {
  summarizeVaccines,
  vaccineTasks,
  type VaccineTask,
} from "./vaccines.ts";

/** 就诊摘要：最近 N 天的聚合 + 体温 + 用药 + 疫苗状态，全部由本机数据算出。 */

export interface VisitSummaryData {
  from: string;
  to: string;
  days: number;
  feedingCount: number;
  intakeMl: number;
  pumpedMl: number;
  sleepMinutes: number;
  diaperCount: number;
  wetCount: number;
  dirtyCount: number;
  temperature: Array<{ at: string; value: number; text: string }>;
  medicines: Array<{ at: string; text: string }>;
  vaccines: {
    done: number;
    overdue: number;
    dueSoon: number;
    upcoming: Array<{ name: string; dose: number; dueDate: string }>;
  };
  entryCount: number;
}

export function buildVisitSummary(
  entries: GrowthEntry[],
  baby: BabyProfile,
  records: VaccinationRecord[],
  plan: VaccinePlan,
  now = new Date(),
  days = 7,
): VisitSummaryData {
  const today = localDate(now);
  const dates = dateRange(days, today);
  const buckets = aggregateByDay(entries, days, today);
  const totals = buckets.reduce(
    (sum, day) => ({
      feedingCount: sum.feedingCount + day.feedingCount,
      intakeMl: sum.intakeMl + day.intakeMl,
      pumpedMl: sum.pumpedMl + day.pumpedMl,
      sleepMinutes: sum.sleepMinutes + day.sleepMinutes,
      diaperCount: sum.diaperCount + day.diaperCount,
      wetCount: sum.wetCount + day.wetCount,
      dirtyCount: sum.dirtyCount + day.dirtyCount,
    }),
    {
      feedingCount: 0,
      intakeMl: 0,
      pumpedMl: 0,
      sleepMinutes: 0,
      diaperCount: 0,
      wetCount: 0,
      dirtyCount: 0,
    },
  );
  const inRange = (value: string) => {
    const date = value.slice(0, 10);
    return date >= dates[0]! && date <= today;
  };
  const sorted = [...entries]
    .filter((entry) => inRange(entry.capturedAt))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  const temperature = sorted
    .filter(
      (entry) =>
        entry.care?.kind === "temperature" &&
        entry.care.temperatureC !== undefined,
    )
    .map((entry) => ({
      at: entry.capturedAt,
      value: entry.care!.temperatureC!,
      text: describeCare(entry.care!),
    }));

  const medicines = sorted
    .filter((entry) => entry.care?.kind === "medicine")
    .map((entry) => ({ at: entry.capturedAt, text: describeCare(entry.care!) }));

  const tasks: VaccineTask[] = vaccineTasks(baby, plan, records, today);
  const summary = summarizeVaccines(tasks);
  const upcoming = tasks
    .filter((task) => task.status === "overdue" || task.status === "due-soon")
    .slice(0, 8)
    .map((task) => ({
      name: task.name,
      dose: task.dose,
      dueDate: task.dueDate,
    }));

  return {
    from: dates[0]!,
    to: today,
    days,
    ...totals,
    temperature,
    medicines,
    vaccines: {
      done: summary.done,
      overdue: summary.overdue,
      dueSoon: summary.dueSoon,
      upcoming,
    },
    entryCount: sorted.length,
  };
}
