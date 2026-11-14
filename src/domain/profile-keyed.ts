/**
 * P8：宝宝档案里三组「按键求并集 + 取消标记」的字段。
 * 放在独立模块里，避免 domain/sync.ts 与 domain/sync-meta.ts 互相 import。
 * 值可以是日期字符串（里程碑、发育观察），也可以是对象（体检完成记录）。
 */
export const KEYED_PROFILE_FIELDS = [
  ["milestones", "deletedMilestones"],
  ["healthChecks", "deletedHealthChecks"],
  ["warningSigns", "deletedWarningSigns"],
] as const;

export type KeyedValuesField = (typeof KEYED_PROFILE_FIELDS)[number][0];
export type KeyedRemovedField = (typeof KEYED_PROFILE_FIELDS)[number][1];
