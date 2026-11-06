import type { BabyProfile, Workspace } from "../types";

export interface BackupMediaFile {
  id: string;
  dataUrl: string;
  thumbnailDataUrl?: string;
}

export interface WorkspaceBackup {
  backupVersion: 1;
  workspace: Workspace;
  mediaFiles: BackupMediaFile[];
}

const hasIds = (value: unknown) =>
  Array.isArray(value) &&
  value.every(
    (item) => item && typeof item === "object" && typeof item.id === "string",
  );

function isBabyProfile(value: unknown): value is BabyProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.name === "string" && typeof profile.birthDate === "string"
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

/** 浅层结构校验：本机读取与备份恢复共用，只拦截明显不兼容的数据。 */
export function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    data.schemaVersion === 1 &&
    isBabyProfile(data.baby) &&
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
    ["feeding", "sleep", "diaper", "note"].includes(care.kind) &&
    typeof care.sourceText === "string" &&
    optionalString(care.inputId) &&
    optionalNumber(care.amountMl) &&
    optionalNumber(care.durationMinutes) &&
    optionalNumber(care.leftMinutes) &&
    optionalNumber(care.rightMinutes) &&
    optionalNumber(care.feedingMinutes) &&
    optionalString(care.food) &&
    optionalString(care.reaction) &&
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

function validItems<T extends { id: string }>(
  items: T[],
  validate: (item: T) => boolean,
): boolean {
  const seen = new Set<string>();
  return items.every((item) => {
    if (!item.id.trim() || seen.has(item.id) || !validate(item)) return false;
    seen.add(item.id);
    return true;
  });
}

/** 导入来自外部文件的数据前，检查界面和编辑流程直接使用的字段。 */
function validBackupWorkspace(workspace: Workspace): boolean {
  return (
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
      optionalString(item.mediaId) && optionalString(item.candidateId) &&
      optionalString(item.activityId) && optionalBoolean(item.demo) &&
      optionalNumber(item.start) && optionalNumber(item.end) && validCare(item.care)) &&
    validItems(workspace.candidates, (item) =>
      typeof item.mediaId === "string" && typeof item.title === "string" &&
      typeof item.note === "string" && typeof item.capturedAt === "string" &&
      ["demo", "upload"].includes(item.origin) &&
      ["pending", "confirmed", "dismissed"].includes(item.status) &&
      optionalString(item.suggestion) && optionalNumber(item.start) && optionalNumber(item.end)) &&
    validItems(workspace.recaps, (item) =>
      typeof item.title === "string" && typeof item.dateFrom === "string" &&
      typeof item.dateTo === "string" && typeof item.createdAt === "string" &&
      Array.isArray(item.entryIds) && item.entryIds.every((id) => typeof id === "string"))
  );
}

export function parseBackupContent(text: string): WorkspaceBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("这不是有效的备份文件，请选择导出的成长记录 JSON。");
  }
  let workspace: Workspace;
  let mediaFiles: BackupMediaFile[] = [];
  if (isWorkspace(data)) workspace = data;
  else if (
    data && typeof data === "object" &&
    "backupVersion" in data && data.backupVersion === 1 &&
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
  if (!validBackupWorkspace(workspace))
    throw new Error("备份文件字段缺失、类型错误或标识重复，当前记录未被修改。");
  // 对象 URL 只属于导出时的页面，不能跨设备使用，也不信任备份里的外部地址。
  workspace.media = workspace.media.map(({ url: _url, thumbnailUrl: _thumbnail, ...item }) => item);
  return { backupVersion: 1, workspace, mediaFiles };
}

export function parseBackup(text: string): Workspace {
  return parseBackupContent(text).workspace;
}
