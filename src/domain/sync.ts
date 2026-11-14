import type { BabyProfile, Workspace } from "../types.ts";
import { activeProfileOf } from "./profiles.ts";
import { removeEntry } from "./records.ts";
import { normalizeMediaIds } from "./workspace-schema.ts";
import { LIST_KINDS, lists, type ListKind, type SyncItem } from "./sync-meta.ts";
import {
  KEYED_PROFILE_FIELDS,
  type KeyedRemovedField,
  type KeyedValuesField,
} from "./profile-keyed.ts";
export { KEYED_PROFILE_FIELDS } from "./profile-keyed.ts";

/** 线上格式，与 server/sync.ts 对应。 */
export interface SyncRecord {
  kind: ListKind;
  id: string;
  deleted?: boolean;
  payload?: Record<string, unknown> | null;
}
/** 单条同步的整块内容：宝宝档案（各自的计划与里程碑都在里面）。 */
export interface Singletons {
  profiles?: BabyProfile[];
}
export interface PullResult {
  now: number;
  records: SyncRecord[];
  singletons: Singletons;
}
export interface PushBatch {
  records: SyncRecord[];
  singletons: Singletons;
  /** 每个推送键当时的内容指纹；推送成功后只清除没再改过的键。 */
  sent: Record<string, string>;
}

/**
 * 对象 URL 只属于当前页面，永远不上传。
 * P7.1：旧设备 / 空白记录没有 mediaIds，推送与指纹都统一补空数组，
 * 否则「B 合并后补了字段、A 没补」会被当成内容变化来回推。
 */
function stripLocal(item: SyncItem): Record<string, unknown> {
  const { url: _url, thumbnailUrl: _thumb, mediaId: _legacy, ...rest } = item as SyncItem & {
    url?: string;
    thumbnailUrl?: string;
    mediaId?: string;
  };
  const value = { ...rest } as Record<string, unknown>;
  if ("tag" in value && !("mediaIds" in value)) value.mediaIds = [];
  return value;
}

function findItem(workspace: Workspace, kind: ListKind, id: string) {
  return lists(workspace)[kind].find((item) => item.id === id);
}

/** 某个键在本机的当前内容；已删除返回 "deleted"。 */
function fingerprint(workspace: Workspace, key: string): string {
  if (key === "profiles") return JSON.stringify(workspace.profiles);
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");
  const item = findItem(workspace, kind as ListKind, id);
  return item ? JSON.stringify(stripLocal(item)) : "deleted";
}

/** 首次（或恢复备份后）全量推送时的键：全部非示例条目、待推墓碑与宝宝档案。 */
function allKeys(workspace: Workspace): Set<string> {
  const keys = new Set(workspace.syncDirty ?? []);
  for (const kind of LIST_KINDS)
    for (const item of lists(workspace)[kind])
      if (!item.demo) keys.add(`${kind}:${item.id}`);
  keys.add("profiles");
  return keys;
}

export function buildPush(workspace: Workspace, full: boolean): PushBatch {
  const keys = full ? allKeys(workspace) : new Set(workspace.syncDirty ?? []);
  const batch: PushBatch = { records: [], singletons: {}, sent: {} };
  for (const key of keys) {
    batch.sent[key] = fingerprint(workspace, key);
    if (key === "profiles") batch.singletons.profiles = workspace.profiles;
    else {
      const [kind, ...rest] = key.split(":");
      if (!(LIST_KINDS as string[]).includes(kind!)) continue;
      const id = rest.join(":");
      const item = findItem(workspace, kind as ListKind, id);
      if (item?.demo) continue;
      batch.records.push(
        item
          ? { kind: kind as ListKind, id, payload: stripLocal(item) }
          : { kind: kind as ListKind, id, deleted: true },
      );
    }
  }
  return batch;
}

function removeItem(workspace: Workspace, kind: ListKind, id: string) {
  if (kind === "entry") removeEntry(workspace, id);
  else if (kind === "vaccination")
    workspace.vaccinations = (workspace.vaccinations ?? []).filter((item) => item.id !== id);
  else if (kind === "recap") workspace.recaps = workspace.recaps.filter((item) => item.id !== id);
  // 远端删除素材元信息后，本机残留的原片由 workspace.ts 的孤儿回收清掉。
  else workspace.media = workspace.media.filter((item) => item.id !== id);
}

function dropDirty(workspace: Workspace, keys: Iterable<string>) {
  const gone = new Set(keys);
  workspace.syncDirty = (workspace.syncDirty ?? []).filter((key) => !gone.has(key));
}

/**
 * P7.1：旧设备推上来的 entry 仍带 `mediaId`。合入前归一成 `mediaIds`，
 * 否则本机列表里会出现新旧两种结构；这里不改服务端存储，旧设备仍可继续同步。
 */
function migratePulledRecord(row: SyncRecord): SyncRecord {
  if (row.kind !== "entry" || !row.payload) return row;
  const payload = { ...row.payload } as Record<string, unknown>;
  payload.mediaIds = normalizeMediaIds(
    payload.mediaIds ?? (typeof payload.mediaId === "string" ? [payload.mediaId] : []),
  );
  delete payload.mediaId;
  return { ...row, payload };
}

/** 按 key 合并其中一组记录，并处理取消标记；规则与旧的里程碑合并完全一致。 */
function mergeKeyedValues(
  mine: BabyProfile,
  remote: BabyProfile,
  base: BabyProfile,
  field: KeyedValuesField,
  removedField: KeyedRemovedField,
): void {
  const removed = new Set<string>([
    ...(mine[removedField] ?? []),
    ...(remote[removedField] ?? []),
  ]);
  const values: Record<string, unknown> = { ...(mine[field] ?? {}) };
  const remoteValues = (remote[field] ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(remoteValues)) {
    values[key] = value;
    removed.delete(key);
  }
  for (const key of remote[removedField] ?? [])
    if (!remoteValues[key]) {
      delete values[key];
      removed.add(key);
    }
  for (const key of mine[removedField] ?? [])
    if (!remoteValues[key]) {
      delete values[key];
      removed.add(key);
    }
  for (const key of Object.keys(values)) removed.delete(key);
  const target = base as unknown as Record<string, unknown>;
  if (Object.keys(values).length || remote[field] || mine[field] || removed.size)
    target[field] = values;
  else delete target[field];
  if (removed.size) target[removedField] = [...removed].sort();
  else delete target[removedField];
}

/**
 * 合并宝宝档案：同 id 的三组按键记录求并集，避免两台设备同时勾选/改资料时丢键；
 * 取消勾选靠 profiles 里的 deleted* 标记传播（见 sync-meta.ts 的 stampChanges）。
 * preferLocal 表示本机 profiles 有未推送修改：其它字段仍保留本机（后写者胜），
 * 但远端新加的宝宝会补进来，合并结果随后由本轮推送带上服务端。
 */
export function mergeProfiles(
  local: BabyProfile[],
  remote: BabyProfile[],
  preferLocal: boolean,
): BabyProfile[] {
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteIds = new Set(remote.map((item) => item.id));
  const merged = remote.map((item) => {
    const mine = localById.get(item.id);
    if (!mine) return item;
    const base: BabyProfile = preferLocal ? { ...mine } : { ...item };
    for (const [field, removedField] of KEYED_PROFILE_FIELDS)
      mergeKeyedValues(mine, item, base, field, removedField);
    return base;
  });
  if (preferLocal)
    for (const item of local) if (!remoteIds.has(item.id)) merged.push(item);
  return merged;
}

/**
 * 把拉到的变化合并进本机。规则（docs/SYNC.md 第 4 节）：
 * - 远端删除总是胜出，本机未推送的修改一并丢弃（计入 removed）；
 * - 本机有未推送的修改或删除时保留本机（计入 kept），随后推送，按服务端时间成为后写者；
 * - 其余情况整条采用远端版本，素材保留本机的预览地址。
 * 调用方不能对这次合并盖章，否则合并本身会被当成新修改推回去。
 */
export function applyPull(workspace: Workspace, pull: PullResult) {
  const dirty = new Set(workspace.syncDirty ?? []);
  const cleared: string[] = [];
  let kept = 0;
  let removed = 0;
  let changed = 0;
  workspace.vaccinations ??= [];
  for (const pulled of pull.records) {
    const row = migratePulledRecord(pulled);
    if (!(LIST_KINDS as string[]).includes(row.kind)) continue;
    const key = `${row.kind}:${row.id}`;
    const local = findItem(workspace, row.kind, row.id);
    if (row.deleted) {
      if (dirty.has(key)) {
        cleared.push(key);
        if (local) removed++;
      }
      if (local) {
        removeItem(workspace, row.kind, row.id);
        changed++;
      }
      workspace.tombstones = (workspace.tombstones ?? []).filter(
        (item) => !(item.kind === row.kind && item.id === row.id),
      );
      continue;
    }
    if (dirty.has(key)) {
      kept++;
      continue;
    }
    if (!row.payload) continue;
    const list = lists(workspace)[row.kind];
    const next = { ...row.payload } as unknown as SyncItem & Record<string, unknown>;
    if (row.kind === "media" && local) {
      const { url, thumbnailUrl } = local as { url?: string; thumbnailUrl?: string };
      if (url) next.url = url;
      if (thumbnailUrl) next.thumbnailUrl = thumbnailUrl;
    }
    const index = list.indexOf(local!);
    if (index >= 0) list.splice(index, 1, next);
    else list.push(next);
    changed++;
  }
  if (pull.singletons.profiles) {
    const merged = mergeProfiles(
      workspace.profiles,
      pull.singletons.profiles,
      dirty.has("profiles"),
    );
    if (JSON.stringify(merged) !== JSON.stringify(workspace.profiles)) {
      workspace.profiles = merged;
      changed++;
    }
    // 远端删掉了当前宝宝时退回第一个，界面不会卡在空档案上。
    if (!workspace.profiles.some((profile) => profile.id === workspace.activeProfileId))
      workspace.activeProfileId = activeProfileOf(workspace).id ?? workspace.activeProfileId;
  }
  dropDirty(workspace, cleared);
  return { kept, removed, changed };
}

/**
 * 推送成功后：清除没再改过的键；被服务端拒绝的条目（已在别处删除）从本机删掉；
 * 不再待推的墓碑一并清理。
 */
export function finishPush(
  workspace: Workspace,
  sent: Record<string, string>,
  rejected: Array<{ kind: ListKind; id: string }>,
) {
  for (const { kind, id } of rejected) removeItem(workspace, kind, id);
  dropDirty(workspace, [
    ...Object.keys(sent).filter((key) => fingerprint(workspace, key) === sent[key]),
    ...rejected.map(({ kind, id }) => `${kind}:${id}`),
  ]);
  const dirty = new Set(workspace.syncDirty);
  workspace.tombstones = (workspace.tombstones ?? []).filter((item) =>
    dirty.has(`${item.kind}:${item.id}`),
  );
  return rejected.length;
}

/** 按条数分批，每批不超过服务端上限；资料、计划和里程碑放在第一批。 */
export function chunkPush(batch: PushBatch, size = 200) {
  const chunks: Array<Pick<PushBatch, "records" | "singletons">> = [];
  for (let start = 0; start < batch.records.length || start === 0; start += size)
    chunks.push({
      records: batch.records.slice(start, start + size),
      singletons: start === 0 ? batch.singletons : {},
    });
  return chunks;
}

export type Transport = (path: "/sync/pull" | "/sync/push", body: unknown) => Promise<unknown>;

export interface SyncOutcome {
  /** 下次增量拉取的起点（服务端时间）。 */
  now: number;
  pulled: number;
  pushed: number;
  kept: number;
  removed: number;
}

/**
 * 一轮同步：先拉后推。`merge` 必须在本机写入队列里执行且不盖章。
 * `since` 为 null 表示首次或恢复备份后：全量拉取、全量推送（服务端对未变内容不计写入）。
 */
export async function runSync(options: {
  since: number | null;
  deviceId: string;
  transport: Transport;
  read: () => Workspace;
  merge: (change: (next: Workspace) => void) => Promise<void>;
}): Promise<SyncOutcome> {
  const { since, deviceId, transport, read, merge } = options;
  const pull = (await transport("/sync/pull", {
    since: since ?? undefined,
    deviceId,
  })) as PullResult;
  let stats = { kept: 0, removed: 0, changed: 0 };
  if (pull.records.length || Object.keys(pull.singletons).length)
    await merge((next) => {
      stats = applyPull(next, pull);
    });
  const batch = buildPush(read(), since === null);
  const rejected: Array<{ kind: ListKind; id: string }> = [];
  let pushed = 0;
  if (batch.records.length || Object.keys(batch.singletons).length) {
    for (const chunk of chunkPush(batch)) {
      const result = (await transport("/sync/push", { deviceId, ...chunk })) as {
        applied: number;
        rejected: Array<{ kind: ListKind; id: string }>;
      };
      pushed += result.applied;
      rejected.push(...result.rejected);
    }
    await merge((next) => {
      finishPush(next, batch.sent, rejected);
    });
  }
  return {
    now: pull.now,
    pulled: stats.changed,
    pushed,
    kept: stats.kept,
    removed: stats.removed + rejected.length,
  };
}
