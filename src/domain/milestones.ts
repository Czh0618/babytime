import { AGE_GUIDES } from "../data/age-guides.ts";
import { localDate } from "./date.ts";

/**
 * 里程碑打勾：只记录「家长在哪天观察到」，不是发育筛查，也不给判断。
 * 键为 `guideId:index`，值记录达成日期。
 */

export type MilestoneMap = Record<string, string>;

export function milestoneKey(guideId: string, index: number): string {
  return `${guideId}:${index}`;
}

export function toggleMilestone(
  map: MilestoneMap,
  key: string,
  today = localDate(),
): MilestoneMap {
  const next = { ...map };
  if (next[key]) delete next[key];
  else next[key] = today;
  return next;
}

export interface AchievedMilestone {
  key: string;
  text: string;
  date: string;
  guideLabel: string;
}

/** 把打勾的记录还原成可读清单，按达成日期倒序。 */
export function achievedMilestones(map: MilestoneMap): AchievedMilestone[] {
  const result: AchievedMilestone[] = [];
  for (const guide of AGE_GUIDES) {
    guide.focus.forEach((text, index) => {
      const key = milestoneKey(guide.id, index);
      const date = map[key];
      if (date) result.push({ key, text, date, guideLabel: guide.label });
    });
  }
  return result.sort((a, b) => b.date.localeCompare(a.date));
}
