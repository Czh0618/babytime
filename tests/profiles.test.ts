import { test } from "node:test";
import assert from "node:assert/strict";
import { activeProfileOf, legacyWorkspaceOf, migrateProfiles } from "../src/domain/profiles.ts";
import { emptyWorkspace } from "../src/domain/seed.ts";
import { isWorkspace, parseBackup } from "../src/domain/workspace-schema.ts";
import type { LegacyWorkspace, Workspace } from "../src/types.ts";

const clone = (value: Workspace): Workspace => JSON.parse(JSON.stringify(value));
let nextId = 0;
const ids = () => `p${++nextId}`;

function legacy(): LegacyWorkspace {
  const workspace = emptyWorkspace();
  const { profiles: _profiles, activeProfileId: _active, ...rest } = workspace;
  return {
    ...rest,
    baby: { name: "小满", birthDate: "2026-05-01", sex: "female" },
    vaccinePlan: { specialProgram: true, choices: { je: "JE-L" } },
    milestones: { "m2:0": "2026-11-01" },
    entries: [{
      id: "e1", title: "第一次翻身", note: "", capturedAt: "2026-11-01T10:00",
      tag: "成长瞬间", milestone: true, favorite: false,
    }],
    media: [{
      id: "m1", kind: "image", name: "a.jpg", mime: "image/jpeg", size: 10,
      capturedAt: "2026-11-01T10:00", theme: "sand",
    }],
    vaccinations: [{
      id: "v1", code: "HepB", dose: 1, date: "2026-05-01", createdAt: "2026-05-01T00:00:00Z",
    }],
    tombstones: [
      { kind: "milestone", id: "m1:0", deletedAt: "2026-10-01T00:00:00Z", deviceId: "old" },
      { kind: "entry", id: "gone", deletedAt: "2026-10-01T00:00:00Z", deviceId: "old" },
    ],
    syncDirty: ["baby", "vaccinePlan", "milestone:m2:0", "entry:e1"],
  };
}

test("旧结构迁移：唯一宝宝、记录补 babyId、计划与里程碑搬进档案，一次到位", () => {
  const workspace = migrateProfiles(legacy(), ids);
  assert.equal(workspace.profiles.length, 1);
  const profile = workspace.profiles[0]!;
  assert.equal(profile.name, "小满");
  assert.equal(profile.id, "default", "固定 id，两台设备迁移后记录能合并");
  assert.equal(workspace.activeProfileId, "default");
  assert.deepEqual(profile.vaccinePlan, { specialProgram: true, choices: { je: "JE-L" } });
  assert.deepEqual(profile.milestones, { "m2:0": "2026-11-01" });
  assert.equal("baby" in workspace, false, "旧字段已删除");
  assert.equal("vaccinePlan" in workspace, false);
  assert.equal("milestones" in workspace, false);

  for (const item of [workspace.entries[0]!, workspace.media[0]!, workspace.vaccinations![0]!])
    assert.equal(item.babyId, "default");
  assert.deepEqual(workspace.tombstones, [
    { kind: "entry", id: "gone", deletedAt: "2026-10-01T00:00:00Z", deviceId: "old" },
  ], "里程碑墓碑随结构变更作废");
  assert.deepEqual(workspace.syncDirty, ["entry:e1", "profiles"], "旧键清理，档案推一次");
});

test("迁移幂等：重复执行不改 id、不重复标记，也不新增待推键", () => {
  const once = migrateProfiles(legacy(), ids);
  const twice = migrateProfiles(clone(once), () => "should-not-be-used");
  assert.deepEqual(twice, once);
});

test("已有 profiles：只补缺失的 id 与默认计划，activeProfileId 失效时退回第一个", () => {
  const workspace = emptyWorkspace(() => "first");
  workspace.profiles.push({ name: "弟弟", birthDate: "2026-10-01" });
  workspace.activeProfileId = "missing";
  const migrated = migrateProfiles(clone(workspace), () => "second");
  assert.deepEqual(migrated.profiles.map((profile) => profile.id), ["first", "second"]);
  assert.equal(migrated.activeProfileId, "first");
  assert.deepEqual(migrated.profiles[1]!.vaccinePlan, { specialProgram: false, choices: {} });
  assert.equal(activeProfileOf(migrated).name, "宝宝");
});

test("备份：旧结构成套导入，迁移后可按新结构往返", () => {
  const backup = parseBackup(JSON.stringify(legacy()));
  assert.equal(isWorkspace(backup), true);
  const workspace = migrateProfiles(backup, ids);
  const restored = parseBackup(JSON.stringify(workspace));
  assert.deepEqual(restored, JSON.parse(JSON.stringify(workspace)));
});

test("导出当前宝宝旧格式：计划与里程碑回到顶层，另一个宝宝的记录不混进来", () => {
  const workspace = migrateProfiles(legacy(), ids);
  const legacyOut = legacyWorkspaceOf(workspace);
  assert.equal(legacyOut.baby.name, "小满");
  assert.deepEqual(legacyOut.vaccinePlan, { specialProgram: true, choices: { je: "JE-L" } });
  assert.deepEqual(legacyOut.milestones, { "m2:0": "2026-11-01" });
  assert.equal(legacyOut.entries?.length, 1);
  assert.equal(isWorkspace(legacyOut), true, "旧版浅层校验通过");
  assert.doesNotThrow(() => parseBackup(JSON.stringify(legacyOut)));

  workspace.profiles.push({ id: "p2", name: "弟弟", birthDate: "2026-10-01" });
  workspace.entries.push({
    id: "e2", babyId: "p2", title: "弟弟的第一声", note: "",
    capturedAt: "2026-10-02T10:00", tag: "成长瞬间", milestone: true, favorite: false,
  });
  const second = legacyWorkspaceOf({ ...workspace, activeProfileId: "p2" });
  assert.equal(second.baby.name, "弟弟");
  assert.deepEqual(second.entries?.map((item) => item.id), ["e2"]);
});
