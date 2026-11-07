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

const LIST_KINDS: ListKind[] = ["entry", "vaccination", "recap", "media"];

function lists(workspace: Workspace): Record<ListKind, SyncItem[]> {
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
 * 消失的条目写墓碑，重新出现的条目撤销墓碑。示例数据只在本机，删除不写墓碑。
 * ponytail: 墓碑只增不减，P4.3 推送成功后再按 90 天清理。
 * ponytail: 里程碑只记取消勾选的墓碑，没有逐键修改时间，P4.3 按推送快照判断新增。
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
  const live = new Set<string>();
  for (const kind of LIST_KINDS) {
    const old = new Map(before[kind].map((item) => [item.id, item]));
    for (const item of after[kind]) {
      live.add(`${kind}:${item.id}`);
      const was = old.get(item.id);
      if (was && sameJson(was, item)) continue;
      item.updatedAt = now;
      item.deviceId = deviceId;
    }
    for (const item of before[kind])
      if (!live.has(`${kind}:${item.id}`) && !item.demo)
        tombstones.push({ kind, id: item.id, deletedAt: now, deviceId });
  }
  const milestones = next.milestones ?? {};
  for (const key of Object.keys(milestones)) live.add(`milestone:${key}`);
  for (const key of Object.keys(prev.milestones ?? {}))
    if (!(key in milestones))
      tombstones.push({ kind: "milestone", id: key, deletedAt: now, deviceId });
  next.tombstones = tombstones.filter(
    (item) => !live.has(`${item.kind}:${item.id}`),
  );
  if (!sameJson(prev.baby, next.baby)) next.babyUpdatedAt = now;
  if (!sameJson(prev.vaccinePlan, next.vaccinePlan))
    next.vaccinePlanUpdatedAt = now;
}
