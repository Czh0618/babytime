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
import {
  bmiFrom,
  correctedBirthDate,
  latestMeasurement,
  monthsBetween,
} from "./growth.ts";
import { percentileBand } from "./growth-percentiles.ts";
import { GROWTH_STANDARD_SOURCE } from "../data/growth-standard-2022.ts";
import type { GrowthMetricId } from "../data/growth-standard-2022.ts";

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
  /** P8.7：最近一次生长测量与客观百分位区间；没填性别时只列数值。 */
  growth?: VisitGrowthData;
}

export interface VisitGrowthBand {
  label: string;
  text: string;
}

export interface VisitGrowthData {
  date: string;
  weightKg?: number;
  heightCm?: number;
  headCm?: number;
  /** 由同一条记录的体重与身高派生，不存储。 */
  bmi?: number;
  bands: VisitGrowthBand[];
  note: string;
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

  // P8.7：最近一次测量 + 客观百分位区间；BMI 由同一次的体重与身高派生。
  const measurement = latestMeasurement(entries);
  let growth: VisitGrowthData | undefined;
  if (measurement) {
    const bmi = bmiFrom(measurement.weightKg, measurement.heightCm);
    const months = monthsBetween(
      correctedBirthDate(baby).date,
      measurement.date,
    );
    const values: Array<{
      metric: GrowthMetricId;
      label: string;
      value?: number;
    }> = [
      { metric: "weightKg", label: "体重", value: measurement.weightKg },
      { metric: "heightCm", label: "身高 / 身长", value: measurement.heightCm },
      { metric: "headCm", label: "头围", value: measurement.headCm },
      { metric: "bmi", label: "BMI", value: bmi },
    ];
    const bands = baby.sex
      ? values.flatMap((item) => {
          if (item.value === undefined) return [];
          const text = percentileBand(
            baby.sex,
            item.metric,
            months,
            item.value,
          );
          return text ? [{ label: item.label, text }] : [];
        })
      : [];
    growth = {
      date: measurement.date,
      ...(measurement.weightKg !== undefined
        ? { weightKg: measurement.weightKg }
        : {}),
      ...(measurement.heightCm !== undefined
        ? { heightCm: measurement.heightCm }
        : {}),
      ...(measurement.headCm !== undefined
        ? { headCm: measurement.headCm }
        : {}),
      ...(bmi !== undefined ? { bmi } : {}),
      bands,
      note: baby.sex
        ? `区间按同月龄同性别参考表（${GROWTH_STANDARD_SOURCE}），只描述数据，不做发育判断，具体请以医生为准。`
        : "未填写性别，这里只列测量数值，不给参考区间；具体请以医生为准。",
    };
  }

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
    ...(growth ? { growth } : {}),
  };
}
