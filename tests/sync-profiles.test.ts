import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPull, mergeProfiles } from "../src/domain/sync.ts";
import { stampChanges } from "../src/domain/sync-meta.ts";
import { emptyWorkspace } from "../src/domain/seed.ts";
import { isWorkspace } from "../src/domain/workspace-schema.ts";
import type { BabyProfile, Workspace } from "../src/types.ts";

const baby = (over: Partial<BabyProfile> = {}): BabyProfile => ({
  id: "p1",
  name: "宝宝",
  birthDate: "2026-01-01",
  ...over,
});

test("两台设备同时勾选不同里程碑：按 key 求并集，资料按后写者胜", () => {
  const local = [baby({ name: "本机名字", milestones: { "m1:0": "2026-11-01" } })];
  const remote = [baby({ name: "远端名字", milestones: { "m2:0": "2026-11-02" } })];

  const pulled = mergeProfiles(local, remote, false);
  assert.equal(pulled[0]!.name, "远端名字");
  assert.deepEqual(pulled[0]!.milestones, {
    "m1:0": "2026-11-01",
    "m2:0": "2026-11-02",
  });

  const kept = mergeProfiles(local, remote, true);
  assert.equal(kept[0]!.name, "本机名字", "本机有未推送修改时保留本机资料");
  assert.deepEqual(kept[0]!.milestones, {
    "m1:0": "2026-11-01",
    "m2:0": "2026-11-02",
  });
});

test("取消勾选的标记优先于本机旧键；重新勾选会清掉标记", () => {
  const local = [baby({ milestones: { "m1:0": "2026-11-01" } })];
  const cancelled = [baby({ deletedMilestones: ["m1:0"] })];
  const merged = mergeProfiles(local, cancelled, false);
  assert.deepEqual(merged[0]!.milestones, {});
  assert.deepEqual(merged[0]!.deletedMilestones, ["m1:0"]);

  const rechecked = mergeProfiles(
    [baby({ deletedMilestones: ["m1:0"] })],
    [baby({ milestones: { "m1:0": "2026-11-06" } })],
    false,
  );
  assert.deepEqual(rechecked[0]!.milestones, { "m1:0": "2026-11-06" });
  assert.equal(rechecked[0]!.deletedMilestones, undefined);
  assert.equal(
    mergeProfiles([baby()], [baby()], false)[0]!.milestones,
    undefined,
    "两端都没勾过里程碑时不产生多余字段",
  );
});

test("本机有未推送修改时，远端新增的宝宝也会补进来", () => {
  const local = [baby({ name: "本机改名", milestones: { "m1:0": "2026-11-01" } })];
  const remote = [baby({ name: "远端名字" }), baby({ id: "p2", name: "弟弟", birthDate: "2026-06-01" })];
  const merged = mergeProfiles(local, remote, true);
  assert.deepEqual(merged.map((item) => item.id), ["p1", "p2"]);
  assert.equal(merged[0]!.name, "本机改名");
  assert.deepEqual(merged[0]!.milestones, { "m1:0": "2026-11-01" });
});

test("删除里程碑键由 stampChanges 记入 deletedMilestones，旧档案没有该字段也能合并", () => {
  const prev = emptyWorkspace();
  prev.profiles = [baby({ milestones: { "m1:0": "2026-11-01" } })];
  prev.activeProfileId = "p1";
  const next: Workspace = JSON.parse(JSON.stringify(prev));
  delete next.profiles[0]!.milestones!["m1:0"];
  stampChanges(prev, next, "device-A");
  assert.deepEqual(next.profiles[0]!.deletedMilestones, ["m1:0"]);
  assert.ok(next.syncDirty?.includes("profiles"));

  const old = emptyWorkspace();
  old.activeProfileId = "p1";
  assert.equal(old.profiles[0]!.deletedMilestones, undefined);
  assert.equal(isWorkspace(old), true, "旧档案仍可加载");
  assert.equal(isWorkspace(next), true, "带删除标记的新档案也可加载");
  const broken: Workspace = JSON.parse(JSON.stringify(next));
  broken.profiles[0]!.deletedMilestones = [42] as unknown as string[];
  assert.equal(isWorkspace(broken), false, "非法删除标记被拒绝");
});

test("applyPull 在本机 profiles 未推送时也合并里程碑，并把合并结果留给本轮推送", () => {
  const workspace = emptyWorkspace();
  workspace.activeProfileId = "p1";
  workspace.profiles = [baby({ milestones: { "m1:0": "2026-11-01" } })];
  workspace.syncDirty = ["profiles"];
  const stats = applyPull(workspace, {
    now: 1,
    records: [],
    singletons: {
      profiles: [baby({ milestones: { "m2:0": "2026-11-02" } })],
    },
  });
  assert.deepEqual(workspace.profiles[0]!.milestones, {
    "m1:0": "2026-11-01",
    "m2:0": "2026-11-02",
  });
  assert.ok(workspace.syncDirty?.includes("profiles"), "合并结果仍待推送");
  assert.equal(stats.changed, 1);
});
