import type {
  Candidate,
  EntryDraft,
  GrowthEntry,
  RecapDraft,
  Workspace,
} from "../types.ts";
import { demoWorkspace } from "./seed.ts";
import { coverMediaId } from "./media-refs.ts";
import {
  MEASURE_DECIMALS,
  MEASURE_RANGES,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  hasMeasurePrecision,
} from "./care-types.ts";

export function validateEntry(
  draft: EntryDraft,
  duration?: number,
): string | null {
  if (!draft.title.trim()) return "给这个瞬间取个名字吧。";
  if (draft.title.trim().length > 48) return "标题最多填写 48 个字。";
  if (!draft.capturedAt || Number.isNaN(new Date(draft.capturedAt).getTime()))
    return "请填写记录时间。";
  if (draft.note.length > 500) return "备注最多填写 500 个字。";
  if (draft.care) {
    if (
      ![
        "feeding",
        "sleep",
        "diaper",
        "note",
        "temperature",
        "medicine",
        "vaccination",
        "measurement",
      ].includes(draft.care.kind)
    )
      return "请选择有效的照护类型。";
    const { amountMl, durationMinutes, leftMinutes, rightMinutes, feedingMinutes } = draft.care;
    for (const value of [amountMl, durationMinutes, leftMinutes, rightMinutes, feedingMinutes]) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0))
        return "奶量或时长需要填写大于 0 的数字，也可以留空。";
    }
    if (amountMl !== undefined && amountMl > 400) return "奶量需要在 400 ml 以内，请核对。";
    if ([leftMinutes, rightMinutes, feedingMinutes].some((value) => value !== undefined && value > 600))
      return "喂奶时长需要在 600 分钟以内，请核对。";
    if (draft.care.kind === "temperature") {
      const value = draft.care.temperatureC;
      if (value === undefined || !Number.isFinite(value))
        return "请填写体温。";
      if (value < TEMPERATURE_MIN || value > TEMPERATURE_MAX)
        return `体温需要在 ${TEMPERATURE_MIN}–${TEMPERATURE_MAX}℃ 之间，请核对。`;
    }
    if (draft.care.kind === "medicine" && !draft.care.medicineName?.trim())
      return "请填写药名。";
    if (draft.care.kind === "vaccination" && !draft.care.vaccineCode)
      return "请选择对应的疫苗。";
    if (draft.care.kind === "measurement") {
      const values = [
        draft.care.weightKg,
        draft.care.heightCm,
        draft.care.headCm,
      ];
      if (values.every((value) => value === undefined))
        return "测量记录至少要填体重、身高或头围中的一项。";
      for (const [key, range] of Object.entries(MEASURE_RANGES) as Array<
        [
          keyof typeof MEASURE_RANGES,
          (typeof MEASURE_RANGES)[keyof typeof MEASURE_RANGES],
        ]
      >) {
        const value = draft.care[key];
        if (value === undefined) continue;
        if (!Number.isFinite(value) || value < range.min || value > range.max)
          return `${range.label}需要在 ${range.min}–${range.max}${range.unit} 之间，请核对。`;
        if (!hasMeasurePrecision(value))
          return `${range.label}最多保留 ${MEASURE_DECIMALS} 位小数，请核对。`;
      }
    }
  }
  if (draft.start !== undefined || draft.end !== undefined) {
    const { start, end } = draft;
    if (
      start === undefined ||
      end === undefined ||
      !Number.isFinite(start) ||
      !Number.isFinite(end)
    )
      return "请填写完整的片段起止时间。";
    if (
      start < 0 ||
      end <= start ||
      (duration !== undefined && end > duration + 0.05)
    )
      return "片段结束时间需要大于开始时间，并且不能超过原片时长。";
  }
  return null;
}

/** 重复确认同一个候选，返回同一条记录，保留家长已保存的修改。 */
export function confirmCandidate(
  workspace: Workspace,
  candidate: Candidate,
  draft: EntryDraft,
  id: string,
): GrowthEntry {
  const existing = workspace.entries.find(
    (entry) => entry.candidateId === candidate.id,
  );
  if (existing) return existing;
  const media = workspace.media.find((asset) => asset.id === coverMediaId(candidate.mediaIds));
  const error = validateEntry(draft, media?.duration);
  if (error) throw new Error(error);
  const entry: GrowthEntry = {
    ...draft,
    title: draft.title.trim(),
    id,
    babyId: candidate.babyId ?? workspace.activeProfileId,
    candidateId: candidate.id,
    mediaIds: [...candidate.mediaIds],
    favorite: false,
    demo: candidate.origin === "demo",
  };
  workspace.entries.push(entry);
  candidate.status = "confirmed";
  return entry;
}

export function validateRecap(
  draft: RecapDraft,
  entries: GrowthEntry[],
): string | null {
  if (!draft.title.trim()) return "请给这份回顾取个名字。";
  if (!draft.dateFrom || !draft.dateTo || draft.dateFrom > draft.dateTo)
    return "请选择有效的日期范围。";
  if (!draft.entryIds.length) return "至少选择一个已确认的瞬间。";
  if (new Set(draft.entryIds).size !== draft.entryIds.length)
    return "同一个瞬间只能选择一次。";
  if (
    draft.entryIds.some(
      (id) =>
        !entries.some(
          (entry) =>
            entry.id === id &&
            entry.capturedAt.slice(0, 10) >= draft.dateFrom &&
            entry.capturedAt.slice(0, 10) <= draft.dateTo,
        ),
    )
  )
    return "部分瞬间已删除或不在所选日期范围内，请重新选择。";
  return null;
}

export function removeEntry(workspace: Workspace, id: string): void {
  workspace.entries = workspace.entries.filter((entry) => entry.id !== id);
  workspace.recaps = workspace.recaps.map((recap) => ({
    ...recap,
    entryIds: recap.entryIds.filter((entryId) => entryId !== id),
  }));
}

/** 把示例并入当前宝宝的工作区；已填写有效生日的资料不被覆盖。 */
export function addDemo(workspace: Workspace): void {
  removeDemo(workspace);
  const demo = demoWorkspace();
  const babyId = workspace.activeProfileId;
  const tag = <T extends { babyId?: string }>(items: T[]) =>
    items.map((item) => ({ ...item, babyId }));
  workspace.media.push(...tag(demo.media));
  workspace.candidates.push(...tag(demo.candidates));
  workspace.entries.push(...tag(demo.entries));
  workspace.recaps.push(...tag(demo.recaps));
  const profile = workspace.profiles.find((item) => item.id === babyId);
  if (profile && !profile.birthDate) {
    const demoBaby = demo.profiles[0]!;
    workspace.demoProfileRestorePoint = {
      previousBaby: { ...profile },
      demoBaby: { ...demoBaby },
    };
    Object.assign(profile, { name: demoBaby.name, birthDate: demoBaby.birthDate });
  }
}

export function removeDemo(workspace: Workspace): void {
  const restorePoint = workspace.demoProfileRestorePoint;
  const active = workspace.profiles.find((item) => item.id === workspace.activeProfileId);
  if (
    restorePoint &&
    active &&
    active.name === restorePoint.demoBaby.name &&
    active.birthDate === restorePoint.demoBaby.birthDate
  ) {
    Object.assign(active, restorePoint.previousBaby);
  }
  delete workspace.demoProfileRestorePoint;
  workspace.entries = workspace.entries.filter((entry) => !entry.demo);
  workspace.media = workspace.media.filter((media) => !media.demo);
  workspace.candidates = workspace.candidates.filter(
    (candidate) => candidate.origin !== "demo",
  );
  const available = new Set(workspace.entries.map((entry) => entry.id));
  workspace.recaps = workspace.recaps
    .map((recap) => ({
      ...recap,
      entryIds: recap.entryIds.filter((id) => available.has(id)),
    }))
    .filter((recap) => recap.entryIds.length);
}
