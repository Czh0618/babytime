import { test } from "node:test";
import assert from "node:assert/strict";
import { orphanMediaIds, pruneOrphanMedia } from "../src/lib/storage.ts";
import { referencedMediaIds } from "../src/domain/media-refs.ts";
import { emptyWorkspace } from "../src/domain/seed.ts";

test("孤儿判定：去重、只删白名单外的 id", () => {
  assert.deepEqual(
    orphanMediaIds(["a", "b", "orphan", "orphan"], ["a", "b"]),
    ["orphan"],
  );
  assert.deepEqual(orphanMediaIds(["a"], ["a"]), []);
  assert.deepEqual(orphanMediaIds(["a"], []), ["a"]);
});

test("白名单包含素材元信息、记录与候选的引用，以及刚写入还没登记的 id", () => {
  const workspace = emptyWorkspace();
  workspace.media = [
    { id: "m1", kind: "image", name: "a.jpg", mime: "image/jpeg", size: 10, capturedAt: "2026-11-07T09:00", theme: "sand" },
  ];
  workspace.entries = [
    {
      id: "e1", title: "记录", note: "", capturedAt: "2026-11-07T09:00",
      tag: "日常备注", milestone: false, favorite: false, mediaIds: ["m2"],
    },
  ];
  workspace.candidates = [
    {
      id: "c1", mediaIds: ["m3"], title: "待整理", note: "",
      capturedAt: "2026-11-07T09:00", origin: "upload", status: "pending",
    },
  ];
  assert.deepEqual(referencedMediaIds(workspace, ["m0"]), ["m0", "m1", "m2", "m3"]);
  assert.deepEqual(referencedMediaIds(workspace), ["m1", "m2", "m3"]);
});

test("P7.1：多图记录删掉一张，只回收那一张的原片", () => {
  const workspace = emptyWorkspace();
  workspace.media = ["m1", "m2", "m3"].map((id) => ({
    id, kind: "image" as const, name: `${id}.jpg`, mime: "image/jpeg", size: 10,
    capturedAt: "2026-11-08T09:00", theme: "sand" as const,
  }));
  workspace.entries = [{
    id: "e1", title: "三张照片", note: "", capturedAt: "2026-11-08T09:00",
    tag: "日常片刻", milestone: false, favorite: false,
    mediaIds: ["m1", "m2", "m3"],
  }];
  // 用户把第二张移出记录：引用与素材元信息一起去掉，GC 只应删 m2。
  workspace.entries[0]!.mediaIds = ["m1", "m3"];
  workspace.media = workspace.media.filter((item) => item.id !== "m2");
  assert.deepEqual(
    orphanMediaIds(["m1", "m2", "m3"], referencedMediaIds(workspace)),
    ["m2"],
  );
});

/** 极简 IndexedDB 替身：只需覆盖 getAllKeys / delete / 事务完成事件。 */
function installFakeIndexedDB(rows: Map<string, unknown>) {
  class FakeRequest<T> {
    result!: T;
    error = null;
    onsuccess: (() => void) | null = null;
    onerror: (() => void) | null = null;
  }
  class FakeStore {
    getAllKeys() {
      const request = new FakeRequest<string[]>();
      request.result = [...rows.keys()];
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
    delete(key: string) {
      rows.delete(key);
      const request = new FakeRequest<undefined>();
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  }
  class FakeTransaction {
    error = null;
    oncomplete: (() => void) | null = null;
    onabort: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private store = new FakeStore();
    constructor() {
      // 所有请求的 microtask 跑完后再提交，模拟 IDB 事务完成时机。
      setTimeout(() => this.oncomplete?.(), 0);
    }
    objectStore() {
      return this.store;
    }
  }
  const database = {
    objectStoreNames: { contains: () => true },
    transaction: () => new FakeTransaction(),
    close: () => {},
    onversionchange: null,
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        const request = new FakeRequest<typeof database>();
        request.result = database;
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  });
}

test("恢复备份后的孤儿原片回收：只删不再被引用的原片", async () => {
  const rows = new Map<string, unknown>([
    ["keep-a", { file: "a" }],
    ["keep-b", { file: "b" }],
    ["orphan-1", { file: "c" }],
  ]);
  installFakeIndexedDB(rows);
  assert.equal(await pruneOrphanMedia(["keep-a", "keep-b"]), 1);
  assert.deepEqual([...rows.keys()], ["keep-a", "keep-b"]);
  assert.equal(await pruneOrphanMedia(["keep-a", "keep-b"]), 0, "重复回收不会误删");
  assert.equal(await pruneOrphanMedia([]), 2, "白名单为空时全部清掉");
  assert.equal(rows.size, 0);
});
