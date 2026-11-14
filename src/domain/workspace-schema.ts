import { MAX_ENTRY_MEDIA } from "../types.ts";
import type { BabyProfile, StoredWorkspace, Workspace } from "../types";

export interface BackupMediaFile {
  id: string;
  dataUrl: string;
  thumbnailDataUrl?: string;
}

export interface WorkspaceBackup {
  /** P7.1：2 = 多图（mediaIds）；1 = 旧的单图备份，读入时迁移。 */
  backupVersion: 2;
  workspace: StoredWorkspace;
  mediaFiles: BackupMediaFile[];
}

/** 去重、去空、截断到上限；旧数据 / 同步 payload / 外部导入都走这里。 */
export function normalizeMediaIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (id): id is string =>
      typeof id === "string" && id.length > 0 && id.length <= 200,
  );
  return [...new Set(ids)].slice(0, MAX_ENTRY_MEDIA);
}

/**
 * P7.1 单向迁移：旧 `mediaId: "x"` → `mediaIds: ["x"]`，并删除旧字段。
 * 幂等；本机读取、备份恢复、同步合并三条入口都要先调用它。
 */
export function migrateMediaIds<T extends StoredWorkspace>(workspace: T): T {
  const lists = [workspace.entries, workspace.candidates] as unknown as Array<
    Array<Record<string, unknown>>
  >;
  for (const list of lists)
    for (const item of list) {
      if (!("mediaIds" in item)) {
        const legacy = item.mediaId;
        item.mediaIds =
          typeof legacy === "string" && legacy ? [legacy] : [];
      } else if (Array.isArray(item.mediaIds))
        item.mediaIds = normalizeMediaIds(item.mediaIds);
      // 已经是 mediaIds 但类型不对时原样保留，交给严格校验拒绝，别悄悄吞掉数据。
      delete item.mediaId;
    }
  return workspace;
}

/** 备份 / 同步合入后的严格校验：列表必须是字符串数组且不超过上限。 */
const validMediaIds = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length <= MAX_ENTRY_MEDIA &&
  new Set(value).size === value.length &&
  value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200);

const hasIds = (value: unknown) =>
  Array.isArray(value) &&
  value.every(
    (item) => item && typeof item === "object" && typeof item.id === "string",
  );

/** P6.5b / P8：取消勾选的标记（里程碑、体检、发育观察），只接受短字符串数组。 */
const validDeletedKeys = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= 200,
    ));

/** P8.1：体检完成记录是可选的按键映射，值只接受已核实的四个字段。 */
function validHealthChecks(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, item]) => {
      if (!key || key.length > 200 || !item || typeof item !== "object" || Array.isArray(item))
        return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.date === "string" && record.date.length <= 40 &&
        (record.place === undefined ||
          (typeof record.place === "string" && record.place.length <= 200)) &&
        (record.note === undefined ||
          (typeof record.note === "string" && record.note.length <= 500)) &&
        (record.teethCount === undefined ||
          (finiteNumber(record.teethCount) &&
            record.teethCount >= 0 &&
            record.teethCount <= 40 &&
            Number.isInteger(record.teethCount)))
      );
    },
  );
}

/** P8.4：发育观察与里程碑一样是「键 → 日期字符串」。 */
function validKeyedDates(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, item]) =>
      key.length > 0 && key.length <= 200 &&
      typeof item === "string" && item.length <= 40,
  );
}

function isBabyProfile(value: unknown): value is BabyProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return (
    (profile.id === undefined || typeof profile.id === "string") &&
    typeof profile.name === "string" &&
    typeof profile.birthDate === "string" &&
    (profile.sex === undefined ||
      profile.sex === "male" ||
      profile.sex === "female") &&
    (profile.dueDate === undefined || typeof profile.dueDate === "string") &&
    validDeletedKeys(profile.deletedMilestones) &&
    validHealthChecks(profile.healthChecks) &&
    validDeletedKeys(profile.deletedHealthChecks) &&
    validKeyedDates(profile.warningSigns) &&
    validDeletedKeys(profile.deletedWarningSigns)
  );
}

function isDemoProfileRestorePoint(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const restorePoint = value as Record<string, unknown>;
  return (
    isBabyProfile(restorePoint.previousBaby) &&
    isBabyProfile(restorePoint.demoBaby)
  );
}

/** 浅层结构校验：本机读取与备份恢复共用，只拦截明显不兼容的数据。新旧两种结构都接受。 */
export function isWorkspace(value: unknown): value is StoredWorkspace {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const profiles =
    Array.isArray(data.profiles) &&
    data.profiles.every(isBabyProfile) &&
    typeof data.activeProfileId === "string";
  return (
    data.schemaVersion === 1 &&
    (profiles || isBabyProfile(data.baby)) &&
    isDemoProfileRestorePoint(data.demoProfileRestorePoint) &&
    hasIds(data.media) &&
    hasIds(data.entries) &&
    hasIds(data.candidates) &&
    hasIds(data.recaps)
  );
}

const optionalString = (value: unknown) =>
  value === undefined || typeof value === "string";
const optionalBoolean = (value: unknown) =>
  value === undefined || typeof value === "boolean";
const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const optionalNumber = (value: unknown) =>
  value === undefined || finiteNumber(value);
const optionalEnum = (value: unknown, allowed: readonly string[]) =>
  value === undefined ||
  (typeof value === "string" && allowed.includes(value));

function validCare(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const care = value as Record<string, unknown>;
  return (
    typeof care.kind === "string" &&
    [
      "feeding",
      "sleep",
      "diaper",
      "note",
      "temperature",
      "medicine",
      "vaccination",
      "measurement",
    ].includes(care.kind) &&
    typeof care.sourceText === "string" &&
    optionalString(care.inputId) &&
    optionalNumber(care.amountMl) &&
    optionalNumber(care.durationMinutes) &&
    optionalNumber(care.temperatureC) &&
    optionalNumber(care.weightKg) &&
    optionalNumber(care.heightCm) &&
    optionalNumber(care.headCm) &&
    optionalNumber(care.leftMinutes) &&
    optionalNumber(care.rightMinutes) &&
    optionalNumber(care.feedingMinutes) &&
    optionalString(care.food) &&
    optionalString(care.reaction) &&
    optionalString(care.medicineName) &&
    optionalString(care.dose) &&
    optionalString(care.vaccineCode) &&
    optionalString(care.vaccineName) &&
    optionalEnum(care.site, ["ear", "forehead", "armpit", "rectal"]) &&
    optionalEnum(care.sleepKind, ["nap", "night", "catch-up"]) &&
    optionalEnum(care.feedingMethod, [
      "breast",
      "bottle-formula",
      "bottle-breastmilk",
      "solid",
      "pump",
    ]) &&
    optionalEnum(care.breastSide, ["left", "right", "both"]) &&
    (care.sleepState === undefined ||
      (typeof care.sleepState === "string" &&
        ["asleep", "awake", "duration"].includes(care.sleepState))) &&
    (care.diaper === undefined ||
      (typeof care.diaper === "string" &&
        ["wet", "dirty", "mixed", "changed"].includes(care.diaper)))
  );
}

/** 同步元信息（P4.2）对所有按条同步的列表都是可选的。 */
const validSyncMeta = (item: { updatedAt?: unknown; deviceId?: unknown; babyId?: unknown }) =>
  optionalString(item.updatedAt) && optionalString(item.deviceId) && optionalString(item.babyId);

function validTombstones(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item && typeof item === "object" &&
        ["entry", "vaccination", "recap", "media", "milestone"].includes(item.kind) &&
        typeof item.id === "string" && typeof item.deletedAt === "string" &&
        typeof item.deviceId === "string",
    )
  );
}

function validItems<T extends { id: string; updatedAt?: unknown; deviceId?: unknown }>(
  items: T[],
  validate: (item: T) => boolean,
  syncable = true,
): boolean {
  const seen = new Set<string>();
  return items.every((item) => {
    if (!item.id.trim() || seen.has(item.id) || !validate(item)) return false;
    if (syncable && !validSyncMeta(item)) return false;
    seen.add(item.id);
    return true;
  });
}

function validVaccinePlan(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  const choices = plan.choices;
  if (!choices || typeof choices !== "object" || Array.isArray(choices))
    return false;
  const option = choices as Record<string, unknown>;
  return (
    typeof plan.specialProgram === "boolean" &&
    optionalEnum(option.je, ["JE-L", "JE-I"]) &&
    optionalEnum(option.hepa, ["HepA-L", "HepA-I"])
  );
}

/** 导入来自外部文件的数据前，检查界面和编辑流程直接使用的字段。 */
function validBackupWorkspace(workspace: StoredWorkspace): boolean {
  const data = workspace as Workspace & Partial<Workspace & { baby?: BabyProfile; vaccinePlan?: unknown; milestones?: unknown; babyUpdatedAt?: string; vaccinePlanUpdatedAt?: string }>;
  const profilesOk = Array.isArray(data.profiles)
    ? data.profiles.length > 0 &&
      data.profiles.every((item) => isBabyProfile(item) &&
        optionalString(item.id) &&
        (item.vaccinePlan === undefined || validVaccinePlan(item.vaccinePlan)) &&
        (item.milestones === undefined || validMilestones(item.milestones)) &&
        validDeletedKeys(item.deletedMilestones) &&
        validHealthChecks(item.healthChecks) &&
        validDeletedKeys(item.deletedHealthChecks) &&
        validKeyedDates(item.warningSigns) &&
        validDeletedKeys(item.deletedWarningSigns)) &&
      data.profiles.some((item) => item.id === data.activeProfileId)
    : isBabyProfile((data as LegacyLike).baby);
  return (
    profilesOk &&
    optionalString(data.profilesUpdatedAt) &&
    optionalString((data as LegacyLike).babyUpdatedAt) &&
    optionalString((data as LegacyLike).vaccinePlanUpdatedAt) &&
    validItems(workspace.media, (item) =>
      ["image", "video"].includes(item.kind) &&
      typeof item.name === "string" && typeof item.mime === "string" &&
      finiteNumber(item.size) && item.size >= 0 &&
      typeof item.capturedAt === "string" &&
      ["sand", "sage", "rose"].includes(item.theme) &&
      optionalNumber(item.duration) && optionalBoolean(item.previewable) &&
      optionalBoolean(item.demo)) &&
    validItems(workspace.entries, (item) =>
      typeof item.title === "string" && typeof item.note === "string" &&
      typeof item.capturedAt === "string" && typeof item.tag === "string" &&
      typeof item.favorite === "boolean" && typeof item.milestone === "boolean" &&
      validMediaIds(item.mediaIds ?? []) && optionalString(item.candidateId) &&
      optionalString(item.activityId) && optionalBoolean(item.demo) &&
      optionalNumber(item.start) && optionalNumber(item.end) && validCare(item.care)) &&
    validItems(workspace.candidates, (item) =>
      validMediaIds(item.mediaIds) && typeof item.title === "string" &&
      typeof item.note === "string" && typeof item.capturedAt === "string" &&
      ["demo", "upload"].includes(item.origin) &&
      ["pending", "confirmed", "dismissed"].includes(item.status) &&
      optionalString(item.suggestion) && optionalNumber(item.start) && optionalNumber(item.end),
      false) &&
    validItems(workspace.recaps, (item) =>
      typeof item.title === "string" && typeof item.dateFrom === "string" &&
      typeof item.dateTo === "string" && typeof item.createdAt === "string" &&
      Array.isArray(item.entryIds) && item.entryIds.every((id) => typeof id === "string")) &&
    (workspace.vaccinations === undefined ||
      validItems(workspace.vaccinations, (item) =>
        typeof item.code === "string" && typeof item.date === "string" &&
        finiteNumber(item.dose) && item.dose > 0 &&
        typeof item.createdAt === "string" &&
        optionalString(item.name) && optionalString(item.clinic) &&
        optionalString(item.lot) && optionalNumber(item.cost) &&
        optionalString(item.inputId))) &&
    ((data as LegacyLike).vaccinePlan === undefined || validVaccinePlan((data as LegacyLike).vaccinePlan)) &&
    validTombstones(workspace.tombstones) &&
    (workspace.syncDirty === undefined ||
      (Array.isArray(workspace.syncDirty) &&
        workspace.syncDirty.every((key) => typeof key === "string"))) &&
    ((data as LegacyLike).milestones === undefined || validMilestones((data as LegacyLike).milestones))
  );
}

/** 旧结构的顶层字段只在迁移前存在，校验时按可选处理。 */
interface LegacyLike {
  baby?: BabyProfile;
  vaccinePlan?: unknown;
  milestones?: unknown;
  babyUpdatedAt?: string;
  vaccinePlanUpdatedAt?: string;
}

function validMilestones(value: unknown): boolean {
  return (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(
      (item) => typeof item === "string",
    )
  );
}

export function parseBackupContent(text: string): WorkspaceBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("这不是有效的备份文件，请选择导出的成长记录 JSON。");
  }
  let workspace: StoredWorkspace;
  let mediaFiles: BackupMediaFile[] = [];
  if (isWorkspace(data)) workspace = data;
  else if (
    data && typeof data === "object" &&
    "backupVersion" in data && (data.backupVersion === 1 || data.backupVersion === 2) &&
    "workspace" in data && isWorkspace(data.workspace) &&
    "mediaFiles" in data && Array.isArray(data.mediaFiles)
  ) {
    workspace = data.workspace;
    const available = new Set(workspace.media.filter((item) => !item.demo).map((item) => item.id));
    const seen = new Set<string>();
    for (const file of data.mediaFiles) {
      if (!file || typeof file !== "object" || typeof file.id !== "string" ||
        !available.has(file.id) || seen.has(file.id) || typeof file.dataUrl !== "string" ||
        (file.thumbnailDataUrl !== undefined && typeof file.thumbnailDataUrl !== "string"))
        throw new Error("备份中的素材数据不完整或重复，当前记录未被修改。");
      seen.add(file.id);
      mediaFiles.push(file);
    }
  } else
    throw new Error("备份文件格式不兼容，当前记录未被修改。");
  // P7.1：旧备份 / 旧工作区里的单图字段在这里统一归一，之后按新结构严格校验。
  migrateMediaIds(workspace);
  if (!validBackupWorkspace(workspace))
    throw new Error("备份文件字段缺失、类型错误或标识重复，当前记录未被修改。");
  // 对象 URL 只属于导出时的页面，不能跨设备使用，也不信任备份里的外部地址。
  workspace.media = workspace.media.map(({ url: _url, thumbnailUrl: _thumbnail, ...item }) => item);
  return { backupVersion: 2, workspace, mediaFiles };
}

export function parseBackup(text: string): StoredWorkspace {
  return parseBackupContent(text).workspace;
}
