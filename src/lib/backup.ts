import type { StoredWorkspace, Workspace } from "../types.ts";
import { parseBackupContent, type WorkspaceBackup } from "../domain/workspace-schema.ts";
import { blobToDataUrl, MAX_FILE_BYTES } from "./media.ts";
import { readMedia, type StoredMedia } from "./storage.ts";

/** 逐个读取原片，避免同时将所有视频载入内存。缺失的原片由调用方明确提示。 */
export async function createBackup(workspace: StoredWorkspace): Promise<WorkspaceBackup> {
  const backup = parseBackupContent(JSON.stringify(workspace));
  for (const media of backup.workspace.media) {
    if (media.demo) continue;
    const data = await readMedia(media.id);
    if (!data) continue;
    backup.mediaFiles.push({
      id: media.id,
      dataUrl: await blobToDataUrl(data.file),
      thumbnailDataUrl: data.thumbnail ? await blobToDataUrl(data.thumbnail) : undefined,
    });
  }
  return backup;
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
