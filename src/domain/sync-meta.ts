import type { SyncKind, Tombstone, Workspace } from "../types.ts";

/** 按条同步的列表；candidates 只是本机待整理队列，不参与同步。 */
type ListKind = Exclude<SyncKind, "milestone">;
interface SyncItem {
  id: string;
  updatedAt?: string;
  deviceId?: string;
  demo?: boolean;
  capturedAt?: string;
  createdAt?: string;
}

export const LIST_KINDS: ListKind[] = ["entry", "vaccination", "recap", "media"];
export type { ListKind, SyncItem };

export function lists(workspace: Workspace): Record<ListKind, SyncItem[]> {
  return {
    entry: workspace.entries,
    vaccination: workspace.vaccinations ?? [],
    recap: workspace.recaps,
    media: workspace.media,
  };
}

function toIso(value: string | undefined, fallback: string): string {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

/**
 * 旧数据迁移（幂等）：没有 updatedAt 的条目取 capturedAt / createdAt，
 * 都没有或无法解析时取迁移时间。宝宝资料与疫苗计划不补，缺失即「从未改过」，
 * 以免新设备的空资料在同步时盖掉真实资料。
 */
export function migrateSyncMeta(
  workspace: Workspace,
  deviceId: string,
  now = new Date().toISOString(),
): void {
  for (const kind of LIST_KINDS)
    for (const item of lists(workspace)[kind]) {
      if (item.updatedAt) continue;
      item.updatedAt = toIso(item.capturedAt ?? item.createdAt, now);
      item.deviceId ??= deviceId;
    }
  if (!Array.isArray(workspace.tombstones)) workspace.tombstones = [];
}

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * 对比一次写入前后的工作区：新增或内容变化的条目盖上 updatedAt / deviceId，
 * 消失的条目写墓碑，重新出现的条目撤销墓碑。示例数据只在本机，不盖章、不写墓碑。
 * 所有变化的键同时记进 `syncDirty`（待推送清单），同步推送成功后由 domain/sync.ts 清除，
 * 墓碑也随之清理；不开同步时清单与墓碑只增不减，体积与记录数同量级。
 */
export function stampChanges(
  prev: Workspace,
  next: Workspace,
  deviceId: string,
  now = new Date().toISOString(),
): void {
  const before = lists(prev);
  const after = lists(next);
  const tombstones: Tombstone[] = [...(next.tombstones ?? [])];
  const dirty = new Set(next.syncDirty ?? []);
  const live = new Set<string>();
  for (const kind of LIST_KINDS) {
    const old = new Map(before[kind].map((item) => [item.id, item]));
    for (const item of after[kind]) {
      live.add(`${kind}:${item.id}`);
      const was = old.get(item.id);
      if (item.demo || (was && sameJson(was, item))) continue;
      item.updatedAt = now;
      item.deviceId = deviceId;
      dirty.add(`${kind}:${item.id}`);
    }
    for (const item of before[kind])
      if (!live.has(`${kind}:${item.id}`) && !item.demo) {
        tombstones.push({ kind, id: item.id, deletedAt: now, deviceId });
        dirty.add(`${kind}:${item.id}`);
      }
  }
  const milestones = next.milestones ?? {};
  const oldMilestones = prev.milestones ?? {};
  for (const [key, date] of Object.entries(milestones)) {
    live.add(`milestone:${key}`);
    if (oldMilestones[key] !== date) dirty.add(`milestone:${key}`);
  }
  for (const key of Object.keys(oldMilestones))
    if (!(key in milestones)) {
      tombstones.push({ kind: "milestone", id: key, deletedAt: now, deviceId });
      dirty.add(`milestone:${key}`);
    }
  next.tombstones = tombstones.filter(
    (item) => !live.has(`${item.kind}:${item.id}`),
  );
  if (!sameJson(prev.baby, next.baby)) {
    next.babyUpdatedAt = now;
    dirty.add("baby");
  }
  if (!sameJson(prev.vaccinePlan, next.vaccinePlan)) {
    next.vaccinePlanUpdatedAt = now;
    dirty.add("vaccinePlan");
  }
  if (dirty.size) next.syncDirty = [...dirty];
}
