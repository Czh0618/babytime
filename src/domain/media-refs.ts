import type { MediaAsset, Workspace } from "../types.ts";

/**
 * 仍被引用的原片 id：素材元信息、记录与待整理候选，外加调用方刚写入、
 * 还没进 workspace 的 id。恢复备份、删除宝宝或远端删除素材后，用它做
 * 孤儿原片回收的白名单；不在这里判断哪些原片真的存在。
 */
export function referencedMediaIds(
  workspace: Workspace,
  extraIds: Iterable<string> = [],
): string[] {
  const ids = new Set<string>(extraIds);
  for (const item of workspace.media) ids.add(item.id);
  for (const item of workspace.entries) for (const id of item.mediaIds ?? []) ids.add(id);
  for (const item of workspace.candidates) for (const id of item.mediaIds ?? []) ids.add(id);
  return [...ids].sort();
}

/** P7.1：列表里第一张是封面；视频记录只有一个素材。 */
export function coverMediaId(ids?: string[]): string | undefined {
  return ids?.[0];
}

export function coverMedia(
  assets: MediaAsset[],
  ids?: string[],
): MediaAsset | undefined {
  const id = coverMediaId(ids);
  return id ? assets.find((item) => item.id === id) : undefined;
}

export function mediaCount(ids?: string[]): number {
  return ids?.length ?? 0;
}
