import type { BabyProfile, HealthCheckRecord } from "../types.ts";
import {
  CHILD_HEALTH_CHECKS,
  type HealthCheckNode,
} from "../data/child-health-checks.ts";
import { addDays, addMonths, SOON_DAYS } from "./vaccines.ts";
import { localDate } from "./date.ts";

/**
 * 儿保体检日程：只按生日算参考日期，状态口径与疫苗一致
 * （已完成 / 30 天内 / 已过 / 未到），复用 vaccines.ts 的自然月加法与月末顺延。
 * 不做早产矫正；早产与高危因素的随访频率由医生安排。
 */

export type HealthCheckStatus = "done" | "due-soon" | "overdue" | "upcoming";

export const HEALTH_CHECK_STATUS_LABELS: Record<HealthCheckStatus, string> = {
  done: "已完成",
  "due-soon": "30 天内",
  overdue: "已过参考时间",
  upcoming: "未到",
};

export interface HealthCheckTask {
  node: HealthCheckNode;
  /** 新生儿家庭访视没有固定日期，这里为 undefined。 */
  dueDate?: string;
  status: HealthCheckStatus;
  record?: HealthCheckRecord;
}

/** 满月按出生后 28 天起算（28～30 天是区间），其余按自然月加月龄。 */
export function healthCheckDueDate(
  node: HealthCheckNode,
  birthDate: string,
): string | undefined {
  if (node.anytime || !birthDate) return undefined;
  if (node.dayRange) return addDays(birthDate, node.dayRange.min);
  if (node.months !== undefined) return addMonths(birthDate, node.months);
  return undefined;
}

function statusFor(
  dueDate: string | undefined,
  record: HealthCheckRecord | undefined,
  today: string,
): HealthCheckStatus {
  if (record) return "done";
  if (!dueDate) return "upcoming";
  if (dueDate < today) return "overdue";
  if (dueDate <= addDays(today, SOON_DAYS)) return "due-soon";
  return "upcoming";
}

export function healthCheckTasks(
  baby: BabyProfile,
  records: Record<string, HealthCheckRecord>,
  today = localDate(),
): HealthCheckTask[] {
  if (!baby.birthDate) return [];
  return CHILD_HEALTH_CHECKS.map((node) => {
    const dueDate = healthCheckDueDate(node, baby.birthDate);
    const record = records[node.id];
    return {
      node,
      ...(dueDate ? { dueDate } : {}),
      status: statusFor(dueDate, record, today),
      ...(record ? { record } : {}),
    };
  });
}

export function completeHealthCheck(
  records: Record<string, HealthCheckRecord>,
  id: string,
  record: HealthCheckRecord,
): Record<string, HealthCheckRecord> {
  return { ...records, [id]: record };
}

export function cancelHealthCheck(
  records: Record<string, HealthCheckRecord>,
  id: string,
): Record<string, HealthCheckRecord> {
  const next = { ...records };
  delete next[id];
  return next;
}
