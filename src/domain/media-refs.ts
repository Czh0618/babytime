import type { Workspace } from "../types.ts";

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
  for (const item of workspace.entries) if (item.mediaId) ids.add(item.mediaId);
  for (const item of workspace.candidates) if (item.mediaId) ids.add(item.mediaId);
  return [...ids].sort();
}
