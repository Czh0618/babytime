import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BabyProfile, Workspace } from "../src/types.ts";
import { emptyWorkspace } from "../src/domain/seed.ts";
import {
  isWorkspace,
  parseBackup,
  parseBackupContent,
} from "../src/domain/workspace-schema.ts";
import { toLegacyBackup } from "../src/lib/backup.ts";
import { legacyWorkspaceOf, migrateProfiles } from "../src/domain/profiles.ts";
import {
  applyPull,
  mergeProfiles,
} from "../src/domain/sync.ts";
import { stampChanges } from "../src/domain/sync-meta.ts";
import {
  REGRESSION_KEY,
  REGRESSION_LABEL,
  WARNING_SIGNS_COPY,
  WARNING_SIGNS_SOURCE,
  WARNING_SIGN_CHECKPOINTS,
} from "../src/data/warning-signs-cn.ts";
import {
  hasObservedWarning,
  nearestWarningCheckpoint,
  toggleWarningSign,
} from "../src/domain/warning-signs.ts";

const baby = (over: Partial<BabyProfile> = {}): BabyProfile => ({
  id: "p1", name: "小满", birthDate: "2026-01-31", ...over,
});

function workspaceWith(profile: BabyProfile): Workspace {
  const workspace = emptyWorkspace();
  workspace.activeProfileId = "p1";
  workspace.profiles = [profile];
  return workspace;
}

const healthCheck = (id: string) => ({
  [id]: { date: "2026-08-01", place: "社区卫生服务中心", teethCount: 2 },
});

test("P8.1.3 / P8.4 旧备份没有新字段时仍可导入，新字段可选不升备份版本", () => {
  const old = workspaceWith(baby({ milestones: { "m1:0": "2026-11-01" } }));
  const restored = parseBackup(JSON.stringify(old));
  assert.deepEqual(restored, JSON.parse(JSON.stringify(old)));
  assert.equal((restored as Workspace).profiles[0]!.healthChecks, undefined);
  assert.equal(isWorkspace(old), true);

  const next = workspaceWith(
    baby({
      healthChecks: healthCheck("m6"),
      warningSigns: { "3m:0": "2026-11-02", [REGRESSION_KEY]: "2026-11-03" },
    }),
  );
  const roundTrip = parseBackup(JSON.stringify(next));
  assert.deepEqual(roundTrip, JSON.parse(JSON.stringify(next)));
  const wrapped = parseBackupContent(
    JSON.stringify({ backupVersion: 2, workspace: next, mediaFiles: [] }),
  );
  assert.equal(wrapped.backupVersion, 2, "P8 新字段不升备份版本号");
  assert.deepEqual(wrapped.workspace, JSON.parse(JSON.stringify(next)));
});

test("P8.1.3 schema 拒绝坏的体检记录、发育观察与取消标记", () => {
  const badProfiles: Array<Partial<BabyProfile>> = [
    { healthChecks: { m6: { place: "没写日期" } } as never },
    { healthChecks: { m6: { date: "2026-08-01", teethCount: 2.5 } } as never },
    { healthChecks: { m6: { date: "2026-08-01", teethCount: -1 } } as never },
    { healthChecks: [] as never },
    { warningSigns: { "3m:0": 42 } as never },
    { deletedHealthChecks: [42] as never },
    { deletedWarningSigns: "m6" as never },
  ];
  for (const fields of badProfiles) {
    const workspace = workspaceWith(baby({ ...fields }));
    assert.throws(
      () => parseBackup(JSON.stringify(workspace)),
      /不兼容|字段/,
      JSON.stringify(fields),
    );
  }
  const good = workspaceWith(
    baby({ healthChecks: healthCheck("m6"), warningSigns: { "3m:0": "2026-11-02" } }),
  );
  assert.doesNotThrow(() => parseBackup(JSON.stringify(good)));
});

test("P8.1.3 导出旧格式时剔除 P8 字段（备份版本 1 与旧结构都是干净的）", () => {
  const workspace = workspaceWith(
    baby({
      milestones: { "m1:0": "2026-11-01" },
      healthChecks: healthCheck("m6"),
      warningSigns: { "3m:0": "2026-11-02" },
      deletedHealthChecks: ["m8"],
      deletedWarningSigns: ["3m:1"],
    }),
  );
  const legacyOut = legacyWorkspaceOf(workspace);
  assert.equal("healthChecks" in legacyOut.baby, false);
  assert.equal("warningSigns" in legacyOut.baby, false);
  assert.equal("deletedHealthChecks" in legacyOut.baby, false);
  assert.equal("deletedMilestones" in legacyOut.baby, false);
  assert.deepEqual(legacyOut.milestones, { "m1:0": "2026-11-01" });
  assert.doesNotThrow(() => parseBackup(JSON.stringify(legacyOut)));

  const backup = parseBackupContent(
    JSON.stringify({ backupVersion: 2, workspace, mediaFiles: [] }),
  );
  const legacyBackup = toLegacyBackup(backup) as unknown as {
    backupVersion: number;
    workspace: { profiles: Array<Record<string, unknown>> };
  };
  assert.equal(legacyBackup.backupVersion, 1);
  for (const key of ["healthChecks", "deletedHealthChecks", "warningSigns", "deletedWarningSigns"])
    assert.equal(key in legacyBackup.workspace.profiles[0]!, false);
  assert.deepEqual(legacyBackup.workspace.profiles[0]!.milestones, { "m1:0": "2026-11-01" });
});

test("P8.1.3 / P8.4 三组按键记录都按 key 并集，取消标记可传播与复活", () => {
  const local = [baby({
    milestones: { "m1:0": "2026-11-01" },
    healthChecks: healthCheck("m6"),
    warningSigns: { "3m:0": "2026-11-02" },
  })];
  const remote = [baby({
    milestones: { "m2:0": "2026-11-03" },
    healthChecks: { m8: { date: "2026-10-01", note: "出牙 4 颗" } },
    warningSigns: { "3m:1": "2026-11-04" },
  })];
  const merged = mergeProfiles(local, remote, false)[0]!;
  assert.deepEqual(Object.keys(merged.milestones ?? {}), ["m1:0", "m2:0"]);
  assert.deepEqual(Object.keys(merged.healthChecks ?? {}), ["m6", "m8"]);
  assert.deepEqual(Object.keys(merged.warningSigns ?? {}), ["3m:0", "3m:1"]);
  assert.equal(merged.healthChecks!.m6!.teethCount, 2, "对象值不丢字段");

  const cancelled = [baby({
    deletedHealthChecks: ["m6"],
    deletedWarningSigns: ["3m:0"],
    deletedMilestones: ["m1:0"],
  })];
  const afterCancel = mergeProfiles(local, cancelled, false)[0]!;
  assert.equal(afterCancel.healthChecks!.m6, undefined);
  assert.equal(afterCancel.warningSigns!["3m:0"], undefined);
  assert.equal(afterCancel.milestones!["m1:0"], undefined);
  assert.deepEqual(afterCancel.deletedHealthChecks, ["m6"]);
  assert.deepEqual(afterCancel.deletedWarningSigns, ["3m:0"]);

  const rechecked = mergeProfiles(
    [{ ...cancelled[0]! }],
    [baby({ healthChecks: healthCheck("m6"), warningSigns: { "3m:0": "2026-11-06" } })],
    false,
  )[0]!;
  assert.equal(rechecked.deletedHealthChecks, undefined, "重新完成会清掉取消标记");
  assert.equal(rechecked.deletedWarningSigns, undefined);
  assert.deepEqual(rechecked.healthChecks, healthCheck("m6"));
  assert.equal(
    mergeProfiles([baby()], [baby()], false)[0]!.healthChecks,
    undefined,
    "两端都没记过时不产生多余字段",
  );
});

test("P8.1.3 / P8.4 stampChanges 为三组字段写取消标记，applyPull 同步往返", () => {
  const prev = workspaceWith(baby({
    milestones: { "m1:0": "2026-11-01" },
    healthChecks: healthCheck("m6"),
    warningSigns: { "3m:0": "2026-11-02" },
  }));
  const next: Workspace = JSON.parse(JSON.stringify(prev));
  delete next.profiles[0]!.healthChecks!.m6;
  delete next.profiles[0]!.warningSigns!["3m:0"];
  delete next.profiles[0]!.milestones!["m1:0"];
  stampChanges(prev, next, "device-A");
  assert.deepEqual(next.profiles[0]!.deletedHealthChecks, ["m6"]);
  assert.deepEqual(next.profiles[0]!.deletedWarningSigns, ["3m:0"]);
  assert.deepEqual(next.profiles[0]!.deletedMilestones, ["m1:0"]);
  assert.ok(next.syncDirty?.includes("profiles"));
  assert.equal(isWorkspace(next), true);

  const pulled = workspaceWith(baby({
    healthChecks: { m8: { date: "2026-10-01" } },
    warningSigns: { "3m:1": "2026-11-04" },
  }));
  pulled.syncDirty = ["profiles"];
  const stats = applyPull(pulled, {
    now: 1,
    records: [],
    singletons: {
      profiles: [baby({
        healthChecks: { m12: { date: "2026-12-01" } },
        warningSigns: { "3m:2": "2026-11-05" },
      })],
    },
  });
  assert.deepEqual(Object.keys(pulled.profiles[0]!.healthChecks ?? {}), ["m8", "m12"]);
  assert.deepEqual(Object.keys(pulled.profiles[0]!.warningSigns ?? {}), ["3m:1", "3m:2"]);
  assert.ok(pulled.syncDirty?.includes("profiles"));
  assert.equal(stats.changed, 1);
});

test("P8.4.2 按最近的小月龄检查点取观察条目，倒退项任何月龄可勾选", () => {
  assert.equal(WARNING_SIGN_CHECKPOINTS.length, 11);
  assert.equal(
    WARNING_SIGN_CHECKPOINTS.reduce((sum, item) => sum + item.signs.length, 0),
    44,
  );
  assert.equal(nearestWarningCheckpoint(2), undefined);
  assert.equal(nearestWarningCheckpoint(3)!.id, "3m");
  assert.equal(nearestWarningCheckpoint(5)!.id, "3m");
  assert.equal(nearestWarningCheckpoint(7)!.id, "6m");
  assert.equal(nearestWarningCheckpoint(11)!.id, "8m");
  assert.equal(nearestWarningCheckpoint(12)!.id, "12m");
  assert.equal(nearestWarningCheckpoint(47)!.id, "36m");
  assert.equal(nearestWarningCheckpoint(48)!.id, "4y");
  assert.equal(nearestWarningCheckpoint(80)!.id, "6y");
  const signs = toggleWarningSign({}, "3m:0", "2026-11-02");
  const both = toggleWarningSign(signs, REGRESSION_KEY, "2026-11-03");
  assert.equal(hasObservedWarning(both), true);
  assert.equal(toggleWarningSign(both, "3m:0")["3m:0"], undefined);
  assert.equal(hasObservedWarning({}), false);
});

test("P8.4.4 文案守门：界面文案不含孤独症 / 阳性 / 异常 / 确诊", () => {
  const text = [
    ...Object.values(WARNING_SIGNS_COPY),
    REGRESSION_LABEL,
    WARNING_SIGNS_SOURCE,
    ...WARNING_SIGN_CHECKPOINTS.flatMap((item) => item.signs),
  ].join("\n");
  assert.match(text, /以医生为准/);
  assert.match(text, /社区卫生服务中心或儿童保健科/);
  assert.doesNotMatch(text, /孤独症|阳性|异常|确诊/);
  const card = readFileSync(
    new URL("../src/components/WarningSignsCard.vue", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(card, /孤独症|阳性|异常|确诊/);
  assert.match(card, /WARNING_SIGNS_COPY.advice|adviceVisible/);
  const healthView = readFileSync(
    new URL("../src/views/HealthView.vue", import.meta.url),
    "utf8",
  );
  assert.match(healthView, /WarningSignsCard/);
  assert.match(healthView, /里程碑/, "CDC 里程碑卡仍在，两张卡并列");
});

test("P8.1.3 迁移旧结构时补 id 但不凭空造 P8 字段", () => {
  const legacy = {
    schemaVersion: 1,
    baby: { name: "小满", birthDate: "2026-01-31" },
    media: [], candidates: [], entries: [], recaps: [],
  } as unknown as Workspace;
  const migrated = migrateProfiles(legacy, () => "new-id");
  assert.equal(migrated.profiles[0]!.healthChecks, undefined);
  assert.equal(migrated.profiles[0]!.warningSigns, undefined);
  assert.equal(isWorkspace(migrated), true);
});
