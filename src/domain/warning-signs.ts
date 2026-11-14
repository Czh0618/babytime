import type { BabyProfile } from "../types.ts";
import {
  REGRESSION_KEY,
  WARNING_SIGN_CHECKPOINTS,
  type WarningSignCheckpoint,
} from "../data/warning-signs-cn.ts";
import { ageOn } from "./age.ts";
import { localDate } from "./date.ts";

/**
 * 发育观察：按规范原文规则「检查日期介于两个月龄段之间的按最近的小月龄内容
 * 进行测查和记录」，取不超过当前完整月龄的最近检查点。
 * 只做「家长勾选观察到」，不判定结果、不下结论。
 */

export function warningSignKey(checkpointId: string, index: number): string {
  return `${checkpointId}:${index}`;
}

export function nearestWarningCheckpoint(
  months: number,
): WarningSignCheckpoint | undefined {
  if (!Number.isFinite(months) || months < 0) return undefined;
  const complete = Math.floor(months);
  return [...WARNING_SIGN_CHECKPOINTS]
    .reverse()
    .find((checkpoint) => checkpoint.months <= complete);
}

export function warningCheckpointForBaby(
  baby: BabyProfile,
  today?: string,
): { months: number; checkpoint?: WarningSignCheckpoint } {
  const age = ageOn(baby.birthDate, today);
  if (!age.valid) return { months: 0 };
  return {
    months: age.months,
    checkpoint: nearestWarningCheckpoint(age.months),
  };
}

export function toggleWarningSign(
  signs: Record<string, string>,
  key: string,
  today = localDate(),
): Record<string, string> {
  const next = { ...signs };
  if (next[key]) delete next[key];
  else next[key] = today;
  return next;
}

/** 任一条勾选（含任何月龄都可勾选的倒退项）就给同一条评估提示。 */
export function hasObservedWarning(signs: Record<string, string>): boolean {
  return Object.keys(signs).length > 0;
}

export function isRegressionChecked(signs: Record<string, string>): boolean {
  return Boolean(signs[REGRESSION_KEY]);
}
