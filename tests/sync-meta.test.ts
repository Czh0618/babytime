import { test } from "node:test";
import assert from "node:assert/strict";
import { addDemo, removeEntry } from "../src/domain/records.ts";
import { demoWorkspace, emptyWorkspace } from "../src/domain/seed.ts";
import { migrateSyncMeta, stampChanges } from "../src/domain/sync-meta.ts";
import { migrateProfiles } from "../src/domain/profiles.ts";
import { migrateMediaIds, parseBackup } from "../src/domain/workspace-schema.ts";
import type { GrowthEntry, LegacyWorkspace, Workspace } from "../src/types.ts";

const NOW = "2026-11-07T08:00:00.000Z";
const LATER = "2026-11-07T09:00:00.000Z";
const clone = (value: Workspace): Workspace => JSON.parse(JSON.stringify(value));

function entry(id: string, capturedAt: string): GrowthEntry {
  return {
    id, title: "喂奶", note: "", capturedAt, tag: "喂奶",
    milestone: false, favorite: false,
    care: { kind: "feeding", sourceText: "喂奶 90ml", amountMl: 90 },
  };
}

/** 旧版本（P4.2 之前）的工作区：顶层 baby、疫苗计划与里程碑，没有任何同步字段，也没有 profiles。 */
function legacyWorkspace(): LegacyWorkspace {
  const workspace = emptyWorkspace();
  const { profiles: _profiles, activeProfileId: _active, ...legacy } = workspace;
  return {
    ...legacy,
    baby: { name: "宝宝", birthDate: "" },
    vaccinePlan: { specialProgram: false, choices: {} },
    milestones: { "m2:0": "2026-11-03" },
    entries: [entry("a", "2026-11-01T10:00"), entry("b", "坏时间")],
    recaps: [{
      id: "r", title: "十一月", entryIds: ["a", "b"],
      dateFrom: "2026-11-01", dateTo: "2026-11-30", createdAt: "2026-11-02T00:00:00.000Z",
    }],
    vaccinations: [{
      id: "v", code: "HepB", dose: 1, date: "2026-11-01", createdAt: "2026-11-01T03:00:00.000Z",
    }],
  };
}

function migrated(): Workspace {
  const workspace = migrateProfiles(legacyWorkspace(), () => "p1");
  migrateSyncMeta(workspace, "dev-a", NOW);
  return workspace;
}

test("迁移：updatedAt 取 capturedAt / createdAt，解析不了取迁移时间，且幂等", () => {
  const workspace = migrated();
  assert.equal(workspace.entries[0]!.updatedAt, new Date("2026-11-01T10:00").toISOString());
  assert.equal(workspace.entries[1]!.updatedAt, NOW);
  assert.equal(workspace.recaps[0]!.updatedAt, "2026-11-02T00:00:00.000Z");
  assert.equal(workspace.vaccinations![0]!.updatedAt, "2026-11-01T03:00:00.000Z");
  assert.equal(workspace.entries[0]!.deviceId, "dev-a");
  assert.deepEqual(workspace.tombstones, []);
  assert.equal(workspace.profilesUpdatedAt, undefined, "档案不补时间，避免空资料在同步时胜出");

  const again = clone(workspace);
  migrateSyncMeta(again, "dev-b", LATER);
  assert.deepEqual(again, workspace, "重复迁移不改已有字段");
});

test("盖章：只有新增和改过的条目更新 updatedAt", () => {
  const prev = migrated();
  const next = clone(prev);
  next.entries[0]!.note = "改了备注";
  next.entries.push(entry("c", "2026-11-07T07:00"));
  stampChanges(prev, next, "dev-b", LATER);

  assert.equal(next.entries[0]!.updatedAt, LATER);
  assert.equal(next.entries[0]!.deviceId, "dev-b");
  assert.equal(next.entries[1]!.updatedAt, NOW, "没动的条目保持原时间");
  assert.equal(next.entries[2]!.updatedAt, LATER);
  assert.deepEqual(next.tombstones, []);
  assert.deepEqual(next.syncDirty, ["profiles", "entry:a", "entry:c"], "迁移后档案也要推一次");
});

test("删除写墓碑：记录被移除，引用它的回顾也算一次修改", () => {
  const prev = migrated();
  const next = clone(prev);
  removeEntry(next, "a");
  next.vaccinations = [];
  stampChanges(prev, next, "dev-b", LATER);

  assert.equal(next.entries.some((item) => item.id === "a"), false, "界面读取的列表里没有已删除的记录");
  assert.deepEqual(next.tombstones, [
    { kind: "entry", id: "a", deletedAt: LATER, deviceId: "dev-b" },
    { kind: "vaccination", id: "v", deletedAt: LATER, deviceId: "dev-b" },
  ]);
  assert.equal(next.recaps[0]!.updatedAt, LATER);
});

test("里程碑随档案整体同步：取消勾选记一次档案修改，不再写里程碑墓碑", () => {
  const prev = migrated();
  const unchecked = clone(prev);
  unchecked.profiles[0]!.milestones = {};
  stampChanges(prev, unchecked, "dev-a", LATER);
  assert.deepEqual(unchecked.tombstones, []);
  assert.equal(unchecked.profilesUpdatedAt, LATER);
  assert.deepEqual(unchecked.syncDirty, ["profiles"]);

  const rechecked = clone(unchecked);
  rechecked.profiles[0]!.milestones = { "m2:0": "2026-11-05" };
  stampChanges(unchecked, rechecked, "dev-a", LATER);
  assert.equal(rechecked.profilesUpdatedAt, LATER);
});

test("示例数据删除不写墓碑；档案资料与疫苗计划变化记档案修改时间", () => {
  const prev = migrated();
  addDemo(prev);
  const next = clone(prev);
  next.entries = next.entries.filter((item) => !item.demo);
  next.media = next.media.filter((item) => !item.demo);
  next.profiles[0]!.name = "小米";
  next.profiles[0]!.vaccinePlan = { specialProgram: true, choices: {} };
  stampChanges(prev, next, "dev-a", LATER);

  assert.deepEqual(next.tombstones, []);
  assert.equal(next.profilesUpdatedAt, LATER);
});

test("备份：旧备份照常导入，带同步字段的新备份能往返，坏墓碑被拒绝", () => {
  assert.doesNotThrow(() => parseBackup(JSON.stringify(legacyWorkspace())));
  assert.doesNotThrow(() => parseBackup(JSON.stringify(demoWorkspace())));

  const prev = migrated();
  const next = clone(prev);
  removeEntry(next, "b");
  stampChanges(prev, next, "dev-a", LATER);
  assert.deepEqual(
    parseBackup(JSON.stringify(next)),
    migrateMediaIds(JSON.parse(JSON.stringify(next))),
  );

  for (const broken of [
    { ...next, tombstones: [{ kind: "entry", id: "x" }] },
    { ...next, tombstones: [{ kind: "candidate", id: "x", deletedAt: LATER, deviceId: "d" }] },
    { ...next, tombstones: "x" },
    { ...next, profilesUpdatedAt: 1 },
    { ...next, entries: [{ ...next.entries[0]!, updatedAt: 1 }] },
    { ...next, profiles: [{ ...next.profiles[0]!, id: 1 }] },
    { ...next, activeProfileId: "missing" },
  ])
    assert.throws(() => parseBackup(JSON.stringify(broken)), /字段|不兼容/, JSON.stringify(broken));
});
