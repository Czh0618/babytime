import type {
  BabyProfile,
  LegacyWorkspace,
  StoredWorkspace,
  Workspace,
} from "../types.ts";
import { defaultVaccinePlan } from "./vaccines.ts";

/**
 * 旧数据迁移出的宝宝用固定 id：两台设备各自升级后都得到同一个 id，
 * 记录合并到同一个档案下，不会因为 id 不一致而在对方设备上「消失」。
 */
export const LEGACY_PROFILE_ID = "default";

/** 按条同步的列表：迁移时给缺 `babyId` 的条目补上唯一宝宝的标识。 */
const LISTS = ["media", "candidates", "entries", "recaps", "vaccinations"] as const;
/** 同步待推清单里仍然有效的键前缀；`baby` / `vaccinePlan` / `milestone:*` 随结构变更作废。 */
const KEY_PREFIXES = ["entry:", "vaccination:", "recap:", "media:"];

/** 当前宝宝；`activeProfileId` 失效时退回第一个，界面永远有资料可显示。 */
export function activeProfileOf(workspace: Workspace): BabyProfile {
  return (
    workspace.profiles.find((profile) => profile.id === workspace.activeProfileId) ??
    workspace.profiles[0]!
  );
}

/**
 * 把旧结构（顶层 `baby` / `vaccinePlan` / `milestones`）归一成 `profiles[]`：
 * 旧数据整体归入唯一的宝宝，记录补 `babyId`，计划与里程碑搬进档案；幂等。
 * 迁移动过的设备会把 `profiles` 记进待推清单，推一次让家人的设备拿到新结构。
 */
export function migrateProfiles(input: StoredWorkspace, idFactory: () => string): Workspace {
  const workspace = input as Workspace & Partial<LegacyWorkspace>;
  const legacy = !Array.isArray(workspace.profiles) || !workspace.profiles.length;
  if (legacy) {
    const profile: BabyProfile = { ...(workspace.baby as BabyProfile) };
    if (!profile.id) profile.id = LEGACY_PROFILE_ID;
    if (workspace.vaccinePlan) profile.vaccinePlan = workspace.vaccinePlan;
    if (workspace.milestones) profile.milestones = workspace.milestones;
    workspace.profiles = [profile];
    workspace.activeProfileId = profile.id!;
    const previous = workspace.babyUpdatedAt ?? workspace.vaccinePlanUpdatedAt;
    if (previous) workspace.profilesUpdatedAt = previous;
    delete workspace.baby;
    delete workspace.vaccinePlan;
    delete workspace.milestones;
    delete workspace.babyUpdatedAt;
    delete workspace.vaccinePlanUpdatedAt;
    // 里程碑改为随档案整体同步，旧的里程碑墓碑不再有意义。
    workspace.tombstones = (workspace.tombstones ?? []).filter((item) => item.kind !== "milestone");
  }

  workspace.profiles = workspace.profiles.map((profile) => ({
    ...profile,
    id: profile.id || idFactory(),
    vaccinePlan:
      profile.vaccinePlan && profile.vaccinePlan.choices
        ? profile.vaccinePlan
        : defaultVaccinePlan(),
    milestones:
      profile.milestones && typeof profile.milestones === "object"
        ? profile.milestones
        : {},
  }));
  if (!workspace.profiles.some((profile) => profile.id === workspace.activeProfileId))
    workspace.activeProfileId = workspace.profiles[0]!.id!;

  if (!Array.isArray(workspace.vaccinations)) workspace.vaccinations = [];
  const home = workspace.activeProfileId;
  for (const key of LISTS)
    for (const item of workspace[key] ?? [])
      if (!item.babyId) item.babyId = home;

  workspace.syncDirty = (workspace.syncDirty ?? []).filter(
    (key) => key === "profiles" || KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
  if (legacy && !workspace.syncDirty.includes("profiles")) workspace.syncDirty.push("profiles");
  if (!workspace.syncDirty.length) delete workspace.syncDirty;
  return workspace;
}

/**
 * 只取当前宝宝的旧格式（P4 及以前）工作区，用于回滚：旧版前端能直接恢复。
 * 只做导出，不写回本机。
 */
export function legacyWorkspaceOf(workspace: Workspace): LegacyWorkspace {
  const profile = activeProfileOf(workspace);
  const id = profile.id;
  const mine = <T extends { babyId?: string }>(items: T[]) =>
    items.filter((item) => !item.babyId || item.babyId === id);
  const { id: _id, vaccinePlan, milestones, ...baby } = profile;
  return {
    schemaVersion: 1,
    baby,
    vaccinePlan,
    milestones,
    media: mine(workspace.media),
    candidates: mine(workspace.candidates),
    entries: mine(workspace.entries),
    recaps: mine(workspace.recaps),
    vaccinations: mine(workspace.vaccinations ?? []),
    tombstones: workspace.tombstones,
    syncDirty: workspace.syncDirty,
  };
}
