import type { StoredWorkspace, Workspace } from "../types.ts";
import { parseBackupContent, type WorkspaceBackup } from "../domain/workspace-schema.ts";
import { blobToDataUrl, MAX_FILE_BYTES } from "./media.ts";
import { readMedia, type StoredMedia } from "./storage.ts";

/** readMedia 的返回形状；测试注入的替身按同一形状返回。 */
type ReadMediaResult =
  | { file: Blob; thumbnail?: Blob; remoteOnly?: boolean }
  | undefined;

/** P7.1：多图记录可能让同一素材出现多次，内嵌原片按 id 去重，保留最后一份。 */
export function dedupeBackupMediaFiles<T extends { id: string }>(files: T[]): T[] {
  return [...new Map(files.map((item) => [item.id, item])).values()];
}

/**
 * 逐个读取原片，避免同时将所有视频载入内存。缺失的原片由调用方明确提示。
 * read 可注入，便于测试；默认读本机 IndexedDB。
 */
export async function createBackup(
  workspace: StoredWorkspace,
  read: (id: string) => Promise<ReadMediaResult> = readMedia,
): Promise<WorkspaceBackup> {
  const backup = parseBackupContent(JSON.stringify(workspace));
  const seen = new Set<string>();
  for (const media of backup.workspace.media) {
    if (media.demo || seen.has(media.id)) continue;
    seen.add(media.id);
    const data = await read(media.id);
    // P7.2：本机只有缩略图的照片不能当原片写进备份，否则恢复时
    // 尺寸校验会拒绝整份备份；这类照片计入调用方的「缺少原片」数量。
    if (!data || data.remoteOnly) continue;
    backup.mediaFiles.push({
      id: media.id,
      dataUrl: await blobToDataUrl(data.file),
      thumbnailDataUrl: data.thumbnail ? await blobToDataUrl(data.thumbnail) : undefined,
    });
  }
  backup.mediaFiles = dedupeBackupMediaFiles(backup.mediaFiles);
  return backup;
}

/**
 * P7.1 回滚用：把 mediaIds 还原成旧版前端认识的 mediaId，并写回备份版本 1。
 * 新版前端仍能恢复这个 JSON（读入时再迁移一次）。
 */
export function toLegacyBackup(backup: WorkspaceBackup): Record<string, unknown> {
  const workspace = JSON.parse(JSON.stringify(backup.workspace)) as Record<string, unknown>;
  for (const list of [workspace.entries, workspace.candidates] as Array<
    Array<Record<string, unknown>>
  >)
    for (const item of list) {
      const ids = item.mediaIds as string[] | undefined;
      item.mediaId = ids?.[0] ?? "";
      delete item.mediaIds;
    }
  return { backupVersion: 1, workspace, mediaFiles: backup.mediaFiles };
}

function decodeMedia(dataUrl: string): Blob {
  const match = /^data:([\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;[^,\r\n]*)?);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || match[2]!.length > Math.ceil(MAX_FILE_BYTES / 3) * 4)
    throw new Error("备份中的原片格式无效或超过 100 MB，当前记录未被修改。");
  try {
    const bytes = Uint8Array.from(atob(match[2]!), (char) => char.charCodeAt(0));
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error();
    return new Blob([bytes], { type: match[1] });
  } catch {
    throw new Error("备份中的原片已损坏，当前记录未被修改。");
  }
}

/** 全部解码成功后才能开始持久化，防止损坏的备份覆盖当前记录。 */
export function decodeBackup(text: string): { workspace: StoredWorkspace; mediaFiles: StoredMedia[] } {
  const backup = parseBackupContent(text);
  const mediaFiles = backup.mediaFiles.map((item) => {
    const media = backup.workspace.media.find((asset) => asset.id === item.id)!;
    const file = decodeMedia(item.dataUrl);
    if (file.size !== media.size ||
      (media.mime && file.type !== media.mime.toLowerCase()))
      throw new Error("备份中的原片与素材信息不匹配，当前记录未被修改。");
    const thumbnail = item.thumbnailDataUrl ? decodeMedia(item.thumbnailDataUrl) : undefined;
    if (thumbnail && !thumbnail.type.startsWith("image/"))
      throw new Error("备份中的素材缩略图格式无效，当前记录未被修改。");
    return {
      id: item.id,
      file,
      thumbnail,
    };
  });
  return { workspace: backup.workspace, mediaFiles };
}
