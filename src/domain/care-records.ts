import type { CareObservation, VoiceDraft } from "./care-types.ts";
import {
  SITE_LABELS,
  SLEEP_KIND_LABELS,
  type CareKind,
} from "./care-types.ts";
import type { GrowthEntry, Workspace } from "../types.ts";
import { validateVoiceDraft, voiceDraftToEntry } from "./voice-parser.ts";
import { validateEntry } from "./records.ts";
import { createId } from "./id.ts";
import { localDate } from "./date.ts";
import { nextDose } from "./vaccines.ts";
import { VACCINE_BY_CODE } from "../data/vaccines-2026.ts";

export function addVoiceEntries(
  workspace: Workspace,
  drafts: VoiceDraft[],
  batchId: string,
  makeId = createId,
): number {
  if (!batchId || !drafts.length) throw new Error("请先整理至少一条记录。");
  if (drafts.length > 12) throw new Error("一次最多确认 12 条，请分批记录。");
  if (new Set(drafts.map((draft) => draft.id)).size !== drafts.length)
    throw new Error("这批记录有重复内容，请重新整理。");
  const existing = new Set(
    workspace.entries.map((entry) => entry.care?.inputId).filter(Boolean),
  );
  const additions: GrowthEntry[] = [];
  const vaccinations = (workspace.vaccinations ??= []);
  const activeBabyId = workspace.activeProfileId;
  const activeProfile = workspace.profiles?.find(
    (item) => item.id === activeBabyId,
  );
  const specialProgram = Boolean(activeProfile?.vaccinePlan?.specialProgram);
  for (const draft of drafts) {
    const error = validateVoiceDraft(draft);
    if (error) throw new Error(error);
    const inputId = `${batchId}:${draft.id}`;
    if (existing.has(inputId)) continue;
    const entry = voiceDraftToEntry(draft, inputId);
    const entryError = validateEntry(entry);
    if (entryError) throw new Error(entryError);
    additions.push({
      ...entry,
      id: makeId(),
      ...(activeBabyId ? { babyId: activeBabyId } : {}),
      favorite: false,
    });
    // 接种记录同时写进疫苗计划：只按当前宝宝已种剂次与特殊程序关联下一剂未种剂次。
    if (draft.kind === "vaccination" && draft.vaccineCode) {
      if (!vaccinations.some((item) => item.inputId === inputId)) {
        const spec = VACCINE_BY_CODE[draft.vaccineCode];
        const babyVaccinations = vaccinations.filter(
          (item) => !item.babyId || !activeBabyId || item.babyId === activeBabyId,
        );
        // 全部剂次都记过时 nextDose 返回 undefined；回退成第 1 剂会在下一轮
        // 同步后造出重复接种记录，所以只写成长记录，不再写接种表。
        const dose = nextDose(babyVaccinations, draft.vaccineCode, specialProgram);
        if (dose !== undefined)
          vaccinations.push({
            id: makeId(),
            ...(activeBabyId ? { babyId: activeBabyId } : {}),
            code: draft.vaccineCode,
            name: spec?.name ?? draft.vaccineName,
            dose,
            date: draft.capturedAt.slice(0, 10),
            createdAt: new Date().toISOString(),
            inputId,
          });
      }
    }
  }
  workspace.entries.push(...additions);
  return additions.length;
}

export function describeCare(care: CareObservation): string {
  if (care.kind === "feeding") {
    if (care.feedingMethod === "pump")
      return care.amountMl ? `吸奶 ${care.amountMl} ml` : "已记录吸奶";
    if (care.feedingMethod === "solid")
      return care.food ? `辅食 · ${care.food}` : "已记录辅食";
    if (care.feedingMethod === "breast") {
      const parts: string[] = [];
      if (care.leftMinutes) parts.push(`左 ${care.leftMinutes} 分`);
      if (care.rightMinutes) parts.push(`右 ${care.rightMinutes} 分`);
      if (care.feedingMinutes) parts.push(`${care.feedingMinutes} 分钟`);
      return parts.length ? `亲喂 ${parts.join(" / ")}` : "已记录亲喂";
    }
    const method =
      care.feedingMethod === "bottle-formula"
        ? "配方奶"
        : care.feedingMethod === "bottle-breastmilk"
          ? "瓶喂母乳"
          : "";
    return care.amountMl
      ? `${method ? `${method} ` : ""}${care.amountMl} ml`
      : method
        ? `已记录${method}`
        : "已记录喂奶";
  }
  if (care.kind === "sleep") {
    if (care.sleepState === "awake") return "醒来了";
    // 只有家长手动选过类型才写出来；自动推断的结果在睡眠段里，不回写记录。
    const kind = care.sleepKind ? `${SLEEP_KIND_LABELS[care.sleepKind]} ` : "";
    if (care.durationMinutes) return `${kind}${care.durationMinutes} 分钟`;
    return care.sleepState === "asleep" ? `${kind}睡着了` : "已记录睡眠";
  }
  if (care.kind === "diaper")
    return (
      {
        wet: "尿湿",
        dirty: "便便",
        mixed: "尿湿和便便",
        changed: "已更换",
      } as const
    )[care.diaper || "changed"];
  if (care.kind === "temperature") {
    if (care.temperatureC === undefined) return "已记录体温";
    const site = care.site ? `（${SITE_LABELS[care.site]}）` : "";
    return `体温 ${care.temperatureC}℃${site}`;
  }
  if (care.kind === "medicine") {
    const name = care.medicineName || "用药";
    return care.dose ? `${name} ${care.dose}` : name;
  }
  if (care.kind === "vaccination") {
    const name =
      care.vaccineName ||
      (care.vaccineCode ? VACCINE_BY_CODE[care.vaccineCode]?.name : "") ||
      "疫苗";
    return `接种 ${name}`;
  }
  if (care.kind === "measurement") {
    const parts = [
      care.weightKg !== undefined ? `体重 ${care.weightKg} kg` : "",
      care.heightCm !== undefined ? `身高 ${care.heightCm} cm` : "",
      care.headCm !== undefined ? `头围 ${care.headCm} cm` : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "已记录测量";
  }
  return "家长备注";
}

export interface TemperatureSummary {
  /** 当天最高体温，摄氏度。 */
  maxC: number;
  /** 最高那次的时间。 */
  at: string;
  count: number;
}

/** 当天最高体温；只陈述数字与部位，不做任何健康判断。 */
export function summarizeTemperature(
  entries: GrowthEntry[],
  onDate = localDate(),
): TemperatureSummary | null {
  let result: TemperatureSummary | null = null;
  for (const entry of entries) {
    const care = entry.care;
    if (
      !care ||
      care.kind !== "temperature" ||
      care.temperatureC === undefined ||
      entry.capturedAt.slice(0, 10) !== onDate
    )
      continue;
    if (!result)
      result = { maxC: care.temperatureC, at: entry.capturedAt, count: 1 };
    else {
      result.count++;
      if (care.temperatureC > result.maxC) {
        result.maxC = care.temperatureC;
        result.at = entry.capturedAt;
      }
    }
  }
  return result;
}

/** 最近一次用药记录（不看日期，用于「距上次用药」）。 */
export function lastMedicineEntry(
  entries: GrowthEntry[],
  now = new Date(),
): GrowthEntry | undefined {
  const limit = now.getTime();
  return [...entries]
    .filter(
      (entry) =>
        entry.care?.kind === "medicine" &&
        Date.parse(entry.capturedAt) <= limit,
    )
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
}

export function hoursSince(capturedAt: string, now = new Date()): string {
  const minutes = Math.max(
    0,
    Math.round((now.getTime() - Date.parse(capturedAt)) / 60_000),
  );
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)} 小时` : `${Math.round(hours)} 小时`;
}

/**
 * 今天页的「距上次」：各类照护记录在最近 24 小时内的最新一条。
 * 只看「今天」会让零点后的夜奶显示成「还未记录」，跨午夜要往前看一天。
 */
export function latestCareByKind(
  entries: GrowthEntry[],
  now = new Date(),
  windowMs = 24 * 60 * 60 * 1000,
): Partial<Record<CareKind, GrowthEntry>> {
  const result: Partial<Record<CareKind, GrowthEntry>> = {};
  const cutoff = now.getTime() - windowMs;
  for (const entry of entries) {
    if (!entry.care) continue;
    const time = Date.parse(entry.capturedAt);
    if (!Number.isFinite(time) || time > now.getTime() || time < cutoff) continue;
    const kind = entry.care.kind;
    const current = result[kind];
    // 同一时刻取后出现的一条，与按时间倒序的结果一致。
    if (!current || entry.capturedAt >= current.capturedAt) result[kind] = entry;
  }
  return result;
}

/** 指定日期内最近一次体温记录；交接摘要说「最近体温」时用它，而不是当日最高。 */
export function lastTemperatureOn(
  entries: GrowthEntry[],
  onDate = localDate(),
  now = new Date(),
): { value: number; at: string } | undefined {
  let result: { value: number; at: string } | undefined;
  for (const entry of entries) {
    const care = entry.care;
    if (
      !care ||
      care.kind !== "temperature" ||
      care.temperatureC === undefined ||
      entry.capturedAt.slice(0, 10) !== onDate ||
      Date.parse(entry.capturedAt) > now.getTime()
    )
      continue;
    if (!result || entry.capturedAt >= result.at)
      result = { value: care.temperatureC, at: entry.capturedAt };
  }
  return result;
}

export interface MilkSummary {
  intakeMl: number;
  pumpedMl: number;
}

/** 今日奶量：吸出量单独统计，不计入宝宝摄入。 */
export function summarizeMilk(
  entries: GrowthEntry[],
  onDate = localDate(),
): MilkSummary {
  let intakeMl = 0;
  let pumpedMl = 0;
  for (const entry of entries) {
    const care = entry.care;
    if (
      !care ||
      care.kind !== "feeding" ||
      !care.amountMl ||
      entry.capturedAt.slice(0, 10) !== onDate
    )
      continue;
    if (care.feedingMethod === "pump") pumpedMl += care.amountMl;
    else intakeMl += care.amountMl;
  }
  return { intakeMl, pumpedMl };
}
