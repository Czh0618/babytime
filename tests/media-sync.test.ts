import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MEDIA_BYTES,
  MEDIA_ID_RE,
  clearMediaProgress,
  downloadMedia,
  isOversizedMedia,
  isSyncableMedia,
  mediaExists,
  mediaSyncState,
  planMediaUploads,
  planThumbBackfill,
  readMediaProgress,
  uploadMedia,
  writeMediaProgress,
} from "../src/lib/media-sync.ts";
import type { MediaAsset } from "../src/types.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "k".repeat(40);

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
  id: ID,
  kind: "image",
  name: "a.jpg",
  mime: "image/jpeg",
  size: 1024,
  capturedAt: "2026-11-08T09:00",
  theme: "sand",
  ...overrides,
});

test("P7.2.3 只有 UUID 命名的照片参与同步，视频与超限素材留在本机", () => {
  assert.equal(MEDIA_ID_RE.test(ID), true);
  assert.equal(isSyncableMedia(asset()), true);
  assert.equal(isSyncableMedia(asset({ kind: "video" })), false);
  assert.equal(isSyncableMedia(asset({ demo: true })), false);
  assert.equal(isSyncableMedia(asset({ id: "demo-media-1" })), false);
  assert.equal(isSyncableMedia(asset({ size: 0 })), false);
  assert.equal(isSyncableMedia(asset({ size: MAX_MEDIA_BYTES + 1 })), false);
  // 超限照片不再静默消失：单独计数，家庭页会说明只留在本机。
  assert.equal(isOversizedMedia(asset({ size: MAX_MEDIA_BYTES + 1 })), true);
  assert.equal(isOversizedMedia(asset({ size: MAX_MEDIA_BYTES })), false);
});

test("P7.2.3 上传队列去重、跳过已有、失败下次重试", () => {
  const local = ["a", "b", "a", "c"];
  assert.deepEqual(planMediaUploads(local, ["b"]), ["a", "c"]);
  assert.deepEqual(planMediaUploads(local, ["a", "b", "c"]), []);
  // exists 结果里仍缺席 = 上次上传失败，下一轮自然重新入队。
  assert.deepEqual(planMediaUploads(local, []), ["a", "b", "c"]);
  assert.deepEqual(planMediaUploads([], ["a"]), []);
  // 历史照片：原片已在服务器但缺缩略图，仍要补传一次，家人设备才有网格预览。
  assert.deepEqual(planThumbBackfill(["a", "b", "c"], ["a"]), ["b", "c"]);
  assert.deepEqual(planThumbBackfill(["a", "a"], ["a"]), []);
});

test("P7.2.3 进度存 localStorage：坏数据回退、写入后界面状态同步", () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  try {
    clearMediaProgress();
    assert.deepEqual(readMediaProgress().pending, []);
    store.set("babytime.mediaSync", "broken json");
    assert.deepEqual(readMediaProgress().pending, []);
    writeMediaProgress({
      pending: ["a", "b"],
      lastAt: "2026-11-08T10:00:00Z",
      error: "网络断了",
      uploaded: 1,
      downloaded: 2,
      oversized: 3,
    });
    assert.deepEqual(readMediaProgress().pending, ["a", "b"]);
    assert.equal(readMediaProgress().oversized, 3);
    assert.equal(mediaSyncState.value.pending.length, 2);
    clearMediaProgress();
    assert.equal(mediaSyncState.value.pending.length, 0);
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("P7.2.3 客户端请求带家庭密钥，路径与 variant 符合服务端契约", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/sync/media/exists"))
      return new Response(JSON.stringify({ ids: [ID], variant: "original" }), { status: 200 });
    if (init.method === "GET")
      return new Response(new Blob(["photo"], { type: "image/jpeg" }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await mediaExists(KEY, [ID]), [ID]);
    await uploadMedia(KEY, ID, "thumb", new Blob(["thumb"], { type: "image/jpeg" }));
    const blob = await downloadMedia(KEY, ID, "original");
    assert.equal(blob.type, "image/jpeg");
    assert.equal(calls.length, 3);
    for (const call of calls)
      assert.equal((call.init.headers as Record<string, string>).authorization, `Bearer ${KEY}`);
    assert.equal(calls[0]!.url, "/sync/media/exists");
    assert.equal(calls[1]!.init.method, "PUT");
    assert.equal(calls[1]!.url, `/sync/media/${ID}?variant=thumb`);
    assert.equal(calls[2]!.url, `/sync/media/${ID}?variant=original`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("P7.2.4 exists 超过服务端 500 条上限时自动分批，不再整轮 400", async () => {
  const lengths: number[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body ?? "{}")) as { ids: string[] };
    lengths.push(body.ids.length);
    return new Response(JSON.stringify({ ids: body.ids }), { status: 200 });
  }) as typeof fetch;
  try {
    const ids = Array.from({ length: 1201 }, (_, index) => `id-${index}`);
    const found = await mediaExists(KEY, ids);
    assert.equal(found.length, 1201);
    assert.deepEqual(lengths, [500, 500, 201]);
    // 已有重复 id 时先去重，不足一批只发一次。
    assert.deepEqual(await mediaExists(KEY, [ID, ID]), [ID]);
    assert.deepEqual(lengths, [500, 500, 201, 1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exists 404 提示服务器还没开启照片同步；原片 GET 404 仍是素材缺失", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  try {
    await assert.rejects(() => mediaExists(KEY, [ID]), /还没有开启照片同步/);
    await assert.rejects(() => downloadMedia(KEY, ID, "original"), /原片同步失败（404）/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
