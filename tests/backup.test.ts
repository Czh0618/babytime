import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace } from "../src/domain/seed.ts";
import { decodeBackup } from "../src/lib/backup.ts";

function backup() {
  const workspace = emptyWorkspace();
  workspace.media.push({
    id: "photo", kind: "image", name: "photo.png", mime: "image/png",
    size: 3, capturedAt: "2026-11-06T10:00", theme: "sand",
  });
  return {
    backupVersion: 1, workspace,
    mediaFiles: [{ id: "photo", dataUrl: "data:image/png;base64,AQID",
      thumbnailDataUrl: "data:image/jpeg;base64,BAUG" }],
  };
}

test("完整备份解码原片和缩略图，保留原始字节", async () => {
  const restored = decodeBackup(JSON.stringify(backup()));
  assert.equal(restored.workspace.media[0]?.id, "photo");
  assert.deepEqual([...new Uint8Array(await restored.mediaFiles[0]!.file.arrayBuffer())], [1, 2, 3]);
  assert.equal(restored.mediaFiles[0]!.file.type, "image/png");
  assert.deepEqual([...new Uint8Array(await restored.mediaFiles[0]!.thumbnail!.arrayBuffer())], [4, 5, 6]);
});

test("旧版纯文字 JSON 仍可恢复，过期对象 URL 不进入工作区", () => {
  const workspace = backup().workspace;
  workspace.media[0]!.url = "blob:previous-origin";
  workspace.media[0]!.thumbnailUrl = "https://invalid.example/photo";
  const restored = decodeBackup(JSON.stringify(workspace));
  assert.equal(restored.mediaFiles.length, 0);
  assert.equal(restored.workspace.media[0]!.url, undefined);
  assert.equal(restored.workspace.media[0]!.thumbnailUrl, undefined);
});

test("不存在本机原片的记录可以备份文字，缺失文件不伪造", () => {
  const value = backup();
  value.mediaFiles = [];
  const restored = decodeBackup(JSON.stringify(value));
  assert.equal(restored.workspace.media.length, 1);
  assert.equal(restored.mediaFiles.length, 0);
});

test("无 MIME 和带参数 MIME 的合法原片可以往返", () => {
  for (const mime of ["", "image/png; charset=binary", "application/ogg"]) {
    const value = backup();
    value.workspace.media[0]!.mime = mime;
    value.mediaFiles[0]!.dataUrl = `data:${mime || "application/octet-stream"};base64,AQID`;
    const restored = decodeBackup(JSON.stringify(value));
    assert.equal(restored.mediaFiles[0]!.file.type, mime || "application/octet-stream");
  }
});

test("损坏、重复或无引用的媒体以及未知备份版本在恢复前被拒绝", () => {
  const bad = [
    { ...backup(), backupVersion: 3 },
    { ...backup(), mediaFiles: null },
    { ...backup(), mediaFiles: [...backup().mediaFiles, ...backup().mediaFiles] },
    { ...backup(), mediaFiles: [{ ...backup().mediaFiles[0], id: "unknown" }] },
    { ...backup(), mediaFiles: [{ ...backup().mediaFiles[0], dataUrl: "https://invalid.example/photo" }] },
    { ...backup(), mediaFiles: [{ ...backup().mediaFiles[0], dataUrl: "data:image/png;base64,###" }] },
    { ...backup(), mediaFiles: [{ ...backup().mediaFiles[0], dataUrl: "data:image/png;base64,AQ==" }] },
    { ...backup(), mediaFiles: [{ ...backup().mediaFiles[0], thumbnailDataUrl: "broken" }] },
  ];
  for (const value of bad) assert.throws(() => decodeBackup(JSON.stringify(value)), /备份|原片|素材/);
});
