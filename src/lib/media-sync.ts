import { ref } from "vue";
import type { MediaAsset, Workspace } from "../types";
import { createImageThumbnail } from "./media.ts";
import { readMedia, storeMedia } from "./storage.ts";
import { readSyncConfig, syncUnavailableReason } from "./sync-service.ts";

/**
 * P7.2 原片同步客户端（与 server/sync.ts 的 /sync/media/ 对应）。
 * 只同步照片与缩略图，视频仍只存本机；本机 IndexedDB 永远优先，
 * 离线或未开启同步时不发任何请求，行为与 P7 之前完全一致。
 */

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
/** 服务端只接受 UUID，示例素材 / 旧版 ID 直接跳过。 */
export const MEDIA_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type MediaVariant = "original" | "thumb";
const PROGRESS_KEY = "babytime.mediaSync";

export interface MediaProgress {
  /** 本机有、服务器还没有的照片 id；失败会留在里面，下次同步重试。 */
  pending: string[];
  lastAt: string;
  error: string;
  uploaded: number;
  downloaded: number;
  /** 超过 20 MB、服务端拒收的照片数量；不静默跳过，家庭页会说明。 */
  oversized: number;
}

const emptyProgress = (): MediaProgress => ({
  pending: [],
  lastAt: "",
  error: "",
  uploaded: 0,
  downloaded: 0,
  oversized: 0,
});

/** 家庭页展示的待上传数量；写进度时同步刷新。 */
export const mediaSyncState = ref<MediaProgress>(readMediaProgress());

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readMediaProgress(): MediaProgress {
  try {
    const raw = storage()?.getItem(PROGRESS_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<MediaProgress>;
    return {
      pending: Array.isArray(parsed.pending)
        ? parsed.pending.filter((id): id is string => typeof id === "string")
        : [],
      lastAt: typeof parsed.lastAt === "string" ? parsed.lastAt : "",
      error: typeof parsed.error === "string" ? parsed.error : "",
      uploaded: Number(parsed.uploaded) || 0,
      downloaded: Number(parsed.downloaded) || 0,
      oversized: Number(parsed.oversized) || 0,
    };
  } catch {
    return emptyProgress();
  }
}

export function refreshMediaSyncState() {
  mediaSyncState.value = readMediaProgress();
}

export function writeMediaProgress(progress: MediaProgress) {
  try {
    storage()?.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // 隐私模式下写不进 localStorage，本次会话仍用内存里的状态。
  }
  mediaSyncState.value = progress;
}

export function clearMediaProgress() {
  try {
    storage()?.removeItem(PROGRESS_KEY);
  } catch {
    /* 忽略 */
  }
  mediaSyncState.value = emptyProgress();
}

/**
 * 只同步照片：视频仍只在本机；示例素材与旧版非 UUID 标识没有服务端路径。
 * P7.2 补传：历史照片同样走这条规则，因此升级前导入的照片会在下一轮同步自动补传。
 */
export function isSyncableMedia(asset: MediaAsset): boolean {
  return (
    asset.kind === "image" &&
    !asset.demo &&
    MEDIA_ID_RE.test(asset.id) &&
    asset.size > 0 &&
    !isOversizedMedia(asset)
  );
}

/** 超过单张上限的照片服务端会拒收；单独计数，避免历史照片静默消失在列表外。 */
export function isOversizedMedia(asset: MediaAsset): boolean {
  return asset.size > MAX_MEDIA_BYTES;
}

/** 纯函数：去重、跳过服务器已有的 id；失败下次 exists 结果里仍缺席，自然重试。 */
export function planMediaUploads(localIds: string[], serverIds: string[]): string[] {
  const onServer = new Set(serverIds);
  return [...new Set(localIds)].filter((id) => !onServer.has(id));
}

/**
 * 纯函数：服务器上已有原片、却缺缩略图的照片。
 * 历史照片可能是 P7.2 之前导入的（当时没生成缩略图），也可能上次传到一半断了；
 * 这类照片只有在补传缩略图之后，家人的设备才看得到网格预览。
 */
export function planThumbBackfill(existing: string[], withThumb: string[]): string[] {
  const onServer = new Set(withThumb);
  return [...new Set(existing)].filter((id) => !onServer.has(id));
}

const mediaPath = (id: string, variant: MediaVariant) =>
  `/sync/media/${encodeURIComponent(id)}?variant=${variant}`;

async function request(key: string, path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`原片同步失败（${response.status}）`);
  return response;
}

/** 批量查服务器已有的原片 / 缩略图，避免重复上传。 */
export async function mediaExists(
  key: string,
  ids: string[],
  variant: MediaVariant = "original",
): Promise<string[]> {
  if (!ids.length) return [];
  const response = await request(key, "/sync/media/exists", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, variant }),
  });
  const data = (await response.json().catch(() => null)) as { ids?: unknown } | null;
  return Array.isArray(data?.ids)
    ? data.ids.filter((id): id is string => typeof id === "string")
    : [];
}

export async function uploadMedia(
  key: string,
  id: string,
  variant: MediaVariant,
  blob: Blob,
): Promise<void> {
  await request(key, mediaPath(id, variant), {
    method: "PUT",
    headers: { "content-type": blob.type || "application/octet-stream" },
    body: blob,
  });
}

export async function downloadMedia(
  key: string,
  id: string,
  variant: MediaVariant,
): Promise<Blob> {
  const response = await request(key, mediaPath(id, variant), { method: "GET" });
  return response.blob();
}

/** 点开大图 / 详情页时按需拉原片并缓存；返回的对象 URL 只存在本次会话。 */
const remoteOriginals = ref<Record<string, string>>({});
export function resolvedOriginalUrl(id: string): string | undefined {
  return remoteOriginals.value[id];
}

export async function ensureRemoteOriginal(media: MediaAsset): Promise<string> {
  if (media.url) return media.url;
  const cached = resolvedOriginalUrl(media.id);
  if (cached) return cached;
  const config = readSyncConfig();
  if (!config?.enabled || syncUnavailableReason() || !isSyncableMedia(media))
    throw new Error("这台设备上没有原片，也没有开启照片同步。");
  const blob = await downloadMedia(config.key, media.id, "original");
  const stored = await readMedia(media.id);
  await storeMedia(media.id, blob, stored?.thumbnail);
  const url = URL.createObjectURL(blob);
  remoteOriginals.value = { ...remoteOriginals.value, [media.id]: url };
  return url;
}

export interface MediaSyncResult {
  uploaded: string[];
  downloaded: string[];
  error: string;
}

/** 本机有照片但还没缩略图（旧版本导入、HEIC 等解不出预览）时补一张，家人设备才有网格预览。 */
async function ensureThumbnail(
  id: string,
  stored: { file: Blob; thumbnail?: Blob; remoteOnly?: boolean },
): Promise<Blob | undefined> {
  if (stored.thumbnail) return stored.thumbnail;
  const thumbnail = await createImageThumbnail(stored.file).catch(() => undefined);
  // remoteOnly 里的 file 是别处拉回来的缩略图，不能覆盖，否则会被当成原片。
  if (thumbnail && !stored.remoteOnly)
    await storeMedia(id, stored.file, thumbnail, false).catch(() => {});
  return thumbnail;
}

/**
 * 一轮结构化同步成功后调用：先 exists 批查原片与缩略图，再串行上传（并发 1，避免占满小带宽），
 * 最后把服务器上新出现、本机没有的素材只拉缩略图。返回需要刷新预览地址的 id。
 *
 * P7.2 补传：升级前就存在本机的照片、以及「原片传了但缩略图没传成功」的照片都会被补上，
 * 不需要用户重新导入。每传一张就更新一次进度，家庭页能看到待上传数量往下走。
 */
export async function syncMedia(
  workspace: Workspace,
  key: string,
): Promise<MediaSyncResult> {
  const photos = workspace.media.filter(
    (asset) =>
      asset.kind === "image" &&
      !asset.demo &&
      MEDIA_ID_RE.test(asset.id) &&
      asset.size > 0,
  );
  const ids = photos.filter((asset) => !isOversizedMedia(asset)).map((asset) => asset.id);
  const oversized = photos.length - ids.length;
  const [existing, withThumb] = await Promise.all([
    mediaExists(key, ids, "original"),
    mediaExists(key, ids, "thumb"),
  ]);
  const queue = planMediaUploads(ids, existing);
  const uploaded: string[] = [];
  const downloaded: string[] = [];
  const pending = new Set(queue);
  let error = "";

  const report = () =>
    writeMediaProgress({
      pending: [...pending],
      lastAt: new Date().toISOString(),
      error,
      uploaded: uploaded.length,
      downloaded: downloaded.length,
      oversized,
    });
  if (queue.length) report();

  for (const id of queue) {
    const stored = await readMedia(id);
    if (!stored || stored.remoteOnly) {
      pending.delete(id); // 本机没有原片，等有原片的那台设备传
      report();
      continue;
    }
    try {
      const thumbnail = await ensureThumbnail(id, stored);
      await uploadMedia(key, id, "original", stored.file);
      if (thumbnail) await uploadMedia(key, id, "thumb", thumbnail);
      uploaded.push(id);
      pending.delete(id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "照片上传失败，下次同步会重试。";
    }
    report();
  }

  // 原片早就在服务器上、缩略图却缺失的照片：单独补传一次（上次中途失败或当时解不出预览）。
  for (const id of planThumbBackfill(existing, withThumb)) {
    const stored = await readMedia(id);
    if (!stored) continue;
    try {
      const thumbnail = await ensureThumbnail(id, stored);
      if (thumbnail) await uploadMedia(key, id, "thumb", thumbnail);
    } catch {
      // 补不上缩略图不影响原片与记录，下一轮继续尝试。
    }
  }

  for (const id of existing.filter((id) => withThumb.includes(id))) {
    const stored = await readMedia(id);
    if (stored && !stored.remoteOnly) continue; // 本机原片优先
    try {
      const thumbnail = await downloadMedia(key, id, "thumb");
      await storeMedia(id, thumbnail, thumbnail, true);
      downloaded.push(id);
    } catch {
      // 服务器还没传缩略图（或暂时拉不到）时，下次同步再试，不影响记录。
    }
  }

  report();
  return { uploaded, downloaded, error };
}
