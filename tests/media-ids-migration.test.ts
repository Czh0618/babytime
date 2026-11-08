import { test } from "node:test";
import assert from "node:assert/strict";
import { demoWorkspace, emptyWorkspace } from "../src/domain/seed.ts";
import {
  migrateMediaIds,
  normalizeMediaIds,
  parseBackup,
  parseBackupContent,
} from "../src/domain/workspace-schema.ts";
import { applyPull } from "../src/domain/sync.ts";
import { dedupeBackupMediaFiles, toLegacyBackup } from "../src/lib/backup.ts";
import { MAX_ENTRY_MEDIA, type StoredWorkspace } from "../src/types.ts";

/** P7 之前的真实结构：Entry / Candidate 用单个 mediaId。 */
function legacyWorkspace(): Record<string, unknown> {
  const workspace = demoWorkspace() as unknown as Record<string, unknown>;
  const convert = (items: Array<Record<string, unknown>>) =>
    items.map(({ mediaIds, ...rest }) => ({
      ...rest,
      mediaId: (mediaIds as string[])[0],
    }));
  workspace.entries = convert(workspace.entries as Array<Record<string, unknown>>);
  workspace.candidates = convert(workspace.candidates as Array<Record<string, unknown>>);
  return workspace;
}

test("P7.1.1 旧本机工作区：mediaId 迁成单元素 mediaIds，旧字段删除", () => {
  const old = legacyWorkspace();
  const migrated = migrateMediaIds(old as unknown as StoredWorkspace);
  assert.deepEqual(migrated.entries.map((item) => item.mediaIds), [
    ["demo-media-0"],
    ["demo-media-1"],
    ["demo-media-2"],
  ]);
  assert.deepEqual(migrated.candidates.map((item) => item.mediaIds), [
    ["demo-video-smile"],
    ["demo-video-tummy"],
  ]);
  assert.equal("mediaId" in migrated.entries[0]!, false);
  assert.equal("mediaId" in migrated.candidates[0]!, false);
  // 幂等：再迁移一次不会改变内容。
  assert.deepEqual(migrateMediaIds(migrated), migrated);
});

test("P7.1.1 旧备份 JSON：版本 1 可读、输出版本 2，多图上限与去重生效", () => {
  const old = legacyWorkspace();
  const backup = parseBackupContent(
    JSON.stringify({ backupVersion: 1, workspace: old, mediaFiles: [] }),
  );
  assert.equal(backup.backupVersion, 2);
  assert.deepEqual(backup.workspace.entries[0]!.mediaIds, ["demo-media-0"]);
  assert.equal("mediaId" in backup.workspace.entries[0]!, false);
  assert.deepEqual(backup.workspace.candidates[0]!.mediaIds, ["demo-video-smile"]);

  // 不带封装的旧纯文字备份也走同一个归一化入口。
  const plain = parseBackup(JSON.stringify(old));
  assert.deepEqual(plain.entries[0]!.mediaIds, ["demo-media-0"]);

  const ids = Array.from({ length: 12 }, (_, i) => `m${i}`);
  assert.equal(normalizeMediaIds([...ids, "m0"]).length, MAX_ENTRY_MEDIA);
  assert.deepEqual(normalizeMediaIds(["a", "a", 1, "", "b"]), ["a", "b"]);
});

test("P7.1.1 类型异常的 mediaIds 在恢复前被拒绝，不悄悄清空", () => {
  const old = legacyWorkspace();
  const entries = old.entries as Array<Record<string, unknown>>;
  entries[0] = { ...entries[0]!, mediaIds: "demo-media-0" };
  delete entries[0]!.mediaId;
  assert.throws(
    () => parseBackup(JSON.stringify(old)),
    /字段|不兼容/,
  );
});

test("P7.1.1 旧设备推上来的同步 payload 合入时迁移", () => {
  const workspace = emptyWorkspace();
  const result = applyPull(workspace, {
    now: 100,
    singletons: {},
    records: [
      {
        kind: "entry",
        id: "remote-entry",
        deleted: false,
        payload: {
          id: "remote-entry",
          title: "旧设备的一条记录",
          mediaId: "old-media",
        },
      },
    ],
  });
  assert.equal(result.changed, 1);
  const entry = workspace.entries.find((item) => item.id === "remote-entry")!;
  assert.deepEqual(entry.mediaIds, ["old-media"]);
  assert.equal("mediaId" in entry, false);
});

test("P7.1.3 备份往返：版本 2 与旧格式回滚互转，内嵌原片按 id 去重", () => {
  const workspace = demoWorkspace();
  workspace.entries[0]!.mediaIds = ["demo-media-0", "demo-media-1"];
  const backup = parseBackupContent(JSON.stringify(workspace));
  assert.equal(backup.backupVersion, 2);
  assert.deepEqual(backup.workspace.entries[0]!.mediaIds, [
    "demo-media-0",
    "demo-media-1",
  ]);

  const legacy = toLegacyBackup(backup) as unknown as {
    backupVersion: number;
    workspace: { entries: Array<{ mediaId?: string; mediaIds?: string[] }> };
  };
  assert.equal(legacy.backupVersion, 1);
  assert.equal(legacy.workspace.entries[0]!.mediaId, "demo-media-0");
  assert.equal(legacy.workspace.entries[0]!.mediaIds, undefined);
  // 新版前端仍能读回旧格式（只保留第一张，符合旧版能力）。
  const restored = parseBackup(JSON.stringify(legacy));
  assert.deepEqual(restored.entries[0]!.mediaIds, ["demo-media-0"]);

  assert.deepEqual(
    dedupeBackupMediaFiles([
      { id: "a", dataUrl: "first" },
      { id: "b", dataUrl: "second" },
      { id: "a", dataUrl: "last" },
    ]).map((item) => item.dataUrl),
    ["last", "second"],
  );
});
