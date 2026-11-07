import type { BabyProfile, VaccinePlan, Workspace } from "../types.ts";
import { removeEntry } from "./records.ts";
import { LIST_KINDS, lists, type ListKind, type SyncItem } from "./sync-meta.ts";

/** 线上格式，与 server/sync.mjs 对应。 */
export interface SyncRecord {
  kind: ListKind;
  id: string;
  deleted?: boolean;
  payload?: Record<string, unknown> | null;
}
export interface Singletons {
  baby?: BabyProfile;
  vaccinePlan?: VaccinePlan;
}
export interface PullResult {
  now: number;
  records: SyncRecord[];
  singletons: Singletons;
  /** 空字符串表示另一台设备取消了勾选。 */
  milestones: Record<string, string>;
}
export interface PushBatch {
  records: SyncRecord[];
  singletons: Singletons;
  milestones: Record<string, string>;
  /** 每个推送键当时的内容指纹；推送成功后只清除没再改过的键。 */
  sent: Record<string, string>;
}

/** 对象 URL 只属于当前页面，永远不上传。 */
function stripLocal(item: SyncItem): Record<string, unknown> {
  const { url: _url, thumbnailUrl: _thumb, ...rest } = item as SyncItem & {
    url?: string;
    thumbnailUrl?: string;
  };
  return rest;
}

function findItem(workspace: Workspace, kind: ListKind, id: string) {
  return lists(workspace)[kind].find((item) => item.id === id);
}

/** 某个键在本机的当前内容；已删除返回 "deleted"。 */
function fingerprint(workspace: Workspace, key: string): string {
  if (key === "baby") return JSON.stringify(workspace.baby);
  if (key === "vaccinePlan") return JSON.stringify(workspace.vaccinePlan ?? null);
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");
  if (kind === "milestone") return workspace.milestones?.[id] ?? "";
  const item = findItem(workspace, kind as ListKind, id);
  return item ? JSON.stringify(stripLocal(item)) : "deleted";
}

/** 首次（或恢复备份后）全量推送时的键：全部非示例条目、待推墓碑、资料、计划与里程碑。 */
function allKeys(workspace: Workspace): Set<string> {
  const keys = new Set(workspace.syncDirty ?? []);
  for (const kind of LIST_KINDS)
    for (const item of lists(workspace)[kind])
      if (!item.demo) keys.add(`${kind}:${item.id}`);
  for (const key of Object.keys(workspace.milestones ?? {})) keys.add(`milestone:${key}`);
  keys.add("baby");
  if (workspace.vaccinePlan) keys.add("vaccinePlan");
  return keys;
}

export function buildPush(workspace: Workspace, full: boolean): PushBatch {
  const keys = full ? allKeys(workspace) : new Set(workspace.syncDirty ?? []);
  const batch: PushBatch = { records: [], singletons: {}, milestones: {}, sent: {} };
  for (const key of keys) {
    batch.sent[key] = fingerprint(workspace, key);
    if (key === "baby") batch.singletons.baby = workspace.baby;
    else if (key === "vaccinePlan") {
      if (workspace.vaccinePlan) batch.singletons.vaccinePlan = workspace.vaccinePlan;
    } else {
      const [kind, ...rest] = key.split(":");
      const id = rest.join(":");
      if (kind === "milestone") batch.milestones[id] = workspace.milestones?.[id] ?? "";
      else if ((LIST_KINDS as string[]).includes(kind!)) {
        const item = findItem(workspace, kind as ListKind, id);
        if (item?.demo) continue;
        batch.records.push(
          item
            ? { kind: kind as ListKind, id, payload: stripLocal(item) }
            : { kind: kind as ListKind, id, deleted: true },
        );
      }
    }
  }
  return batch;
}

function removeItem(workspace: Workspace, kind: ListKind, id: string) {
  if (kind === "entry") removeEntry(workspace, id);
  else if (kind === "vaccination")
    workspace.vaccinations = (workspace.vaccinations ?? []).filter((item) => item.id !== id);
  else if (kind === "recap") workspace.recaps = workspace.recaps.filter((item) => item.id !== id);
  // ponytail: 远端删除素材时本机若有原片字节不清理，与恢复备份一样留到孤儿原片回收。
  else workspace.media = workspace.media.filter((item) => item.id !== id);
}

function dropDirty(workspace: Workspace, keys: Iterable<string>) {
  const gone = new Set(keys);
  workspace.syncDirty = (workspace.syncDirty ?? []).filter((key) => !gone.has(key));
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
  for (const row of pull.records) {
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
  if (pull.singletons.baby && !dirty.has("baby")) {
    workspace.baby = pull.singletons.baby;
    changed++;
  }
  if (pull.singletons.vaccinePlan && !dirty.has("vaccinePlan")) {
    workspace.vaccinePlan = pull.singletons.vaccinePlan;
    changed++;
  }
  for (const [key, date] of Object.entries(pull.milestones)) {
    if (dirty.has(`milestone:${key}`)) continue;
    workspace.milestones ??= {};
    if (date) workspace.milestones[key] = date;
    else delete workspace.milestones[key];
    changed++;
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
  const chunks: Array<Pick<PushBatch, "records" | "singletons" | "milestones">> = [];
  for (let start = 0; start < batch.records.length || start === 0; start += size)
    chunks.push({
      records: batch.records.slice(start, start + size),
      singletons: start === 0 ? batch.singletons : {},
      milestones: start === 0 ? batch.milestones : {},
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
  if (pull.records.length || Object.keys(pull.singletons).length || Object.keys(pull.milestones).length)
    await merge((next) => {
      stats = applyPull(next, pull);
    });
  const batch = buildPush(read(), since === null);
  const rejected: Array<{ kind: ListKind; id: string }> = [];
  let pushed = 0;
  if (batch.records.length || Object.keys(batch.singletons).length || Object.keys(batch.milestones).length) {
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
