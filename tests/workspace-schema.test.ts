import { test } from "node:test";
import assert from "node:assert/strict";
import { addDemo } from "../src/domain/records.ts";
import { demoWorkspace, emptyWorkspace } from "../src/domain/seed.ts";
import { isWorkspace, parseBackup, parseBackupContent } from "../src/domain/workspace-schema.ts";

function workspaceWithRecap() {
  const workspace = demoWorkspace();
  workspace.recaps.push({
    id: "recap", title: "第一份回顾", entryIds: [workspace.entries[0]!.id],
    dateFrom: "2026-01-01", dateTo: "2026-12-31", createdAt: "2026-11-06T10:00:00Z",
  });
  return workspace;
}

test("导出的 JSON 可以原样解析回工作区", () => {
  const workspace = demoWorkspace();
  const restored = parseBackup(JSON.stringify(workspace));
  assert.deepEqual(restored, JSON.parse(JSON.stringify(workspace)));
});

test("旧工作区仍兼容，带示例资料恢复点的工作区也能往返", () => {
  const oldWorkspace = emptyWorkspace();
  assert.equal(isWorkspace(oldWorkspace), true);

  const workspace = emptyWorkspace();
  addDemo(workspace);
  const restored = parseBackup(JSON.stringify(workspace));
  assert.deepEqual(restored, JSON.parse(JSON.stringify(workspace)));
});

test("非 JSON、版本不符、结构缺失的备份都会被拒绝", () => {
  assert.throws(() => parseBackup("not json"), /不是有效的备份文件/);
  const bad = [
    { ...demoWorkspace(), schemaVersion: 2 },
    { ...demoWorkspace(), profiles: undefined },
    { ...demoWorkspace(), activeProfileId: undefined },
    { ...demoWorkspace(), entries: "x" },
    { ...demoWorkspace(), media: [{ name: "无 id" }] },
    {
      ...demoWorkspace(),
      demoProfileRestorePoint: { previousBaby: {}, demoBaby: {} },
    },
    null,
    [],
  ];
  for (const value of bad) {
    assert.equal(isWorkspace(value), false);
    assert.throws(() => parseBackup(JSON.stringify(value)), /不兼容/);
  }
});

test("只有 ID、缺少界面必需字段的各类列表项在恢复前被拒绝", () => {
  for (const list of ["entries", "candidates", "media", "recaps"] as const) {
    const workspace = { ...workspaceWithRecap(), [list]: [{ id: "broken" }] };
    assert.equal(isWorkspace(workspace), true, "本机读取继续沿用浅层兼容校验");
    assert.throws(() => parseBackup(JSON.stringify(workspace)), /不兼容|字段/);
  }
});

test("记录、候选、媒体和回顾的错误字段类型及非有限数值被拒绝", () => {
  const badFields = {
    entries: [
      { title: null }, { note: {} }, { capturedAt: undefined }, { tag: 1 },
      { favorite: "false" }, { milestone: 1 }, { start: Infinity }, { mediaId: 1 },
      { care: { kind: "feeding", sourceText: 1 } },
      { care: { kind: "unknown", sourceText: "原话" } },
      { care: { kind: "feeding", sourceText: "原话", amountMl: "80" } },
      { care: { kind: "sleep", sourceText: "原话", durationMinutes: NaN } },
      { care: { kind: "feeding", sourceText: "原话", inputId: 1 } },
      { care: { kind: "sleep", sourceText: "原话", sleepState: "invalid" } },
      { care: { kind: "diaper", sourceText: "原话", diaper: "invalid" } },
    ],
    candidates: [
      { mediaId: undefined }, { title: [] }, { note: false }, { capturedAt: 1 },
      { origin: "unknown" }, { status: "unknown" }, { end: Infinity }, { suggestion: {} },
    ],
    media: [
      { kind: "audio" }, { name: null }, { mime: false }, { size: "100" },
      { size: -1 }, { capturedAt: undefined }, { theme: "unknown" },
      { duration: Infinity }, { previewable: "true" }, { demo: 1 },
    ],
    recaps: [
      { title: null }, { entryIds: "entry" }, { entryIds: [1] },
      { dateFrom: false }, { dateTo: undefined }, { createdAt: 1 },
    ],
  };
  for (const list of ["entries", "candidates", "media", "recaps"] as const) {
    for (const fields of badFields[list]) {
      const workspace = workspaceWithRecap();
      Object.assign(workspace[list][0]!, fields);
      assert.throws(() => parseBackup(JSON.stringify(workspace)), /不兼容|字段/,
        `${list}: ${JSON.stringify(fields)}`);
    }
  }
});

test("每个列表的空 ID 和重复 ID 均被拒绝", () => {
  for (const list of ["entries", "candidates", "media", "recaps"] as const) {
    const workspace = workspaceWithRecap();
    const first = workspace[list][0]!;
    for (const id of ["", "   "]) {
      const value = { ...workspace, [list]: [{ ...first, id }] };
      assert.throws(() => parseBackup(JSON.stringify(value)), /不兼容|字段/);
    }
    const duplicate = { ...workspace, [list]: [first, { ...first }] };
    assert.throws(() => parseBackup(JSON.stringify(duplicate)), /不兼容|字段/);
  }
});

test("合法旧 JSON 保留可选照护字段，并允许缺失媒体引用稍后补回", () => {
  const workspace = workspaceWithRecap();
  workspace.entries[0]!.mediaId = "missing-original";
  workspace.entries[0]!.care = { kind: "feeding", sourceText: "喝了 80 毫升", amountMl: 80 };
  const restored = parseBackup(JSON.stringify(workspace));
  assert.deepEqual(restored, JSON.parse(JSON.stringify(workspace)));
  assert.equal(restored.entries[0]!.care!.inputId, undefined);
});

test("带原片的新备份封装通过严格工作区校验", () => {
  const workspace = workspaceWithRecap();
  workspace.media[0]!.demo = false;
  workspace.media[0]!.size = 3;
  const mediaFiles = [{ id: workspace.media[0]!.id, dataUrl: "data:image/jpeg;base64,AQID" }];
  const backup = parseBackupContent(JSON.stringify({ backupVersion: 1, workspace, mediaFiles }));
  assert.deepEqual(backup.workspace, JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(backup.mediaFiles, mediaFiles);
});
