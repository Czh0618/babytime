import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHandler, openStore, type Store } from "../server/sync.ts";
import { runSync, type Transport } from "../src/domain/sync.ts";
import { migrateSyncMeta, stampChanges } from "../src/domain/sync-meta.ts";
import { addDemo } from "../src/domain/records.ts";
import { emptyWorkspace } from "../src/domain/seed.ts";
import type { GrowthEntry, Workspace } from "../src/types.ts";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** 模拟一台设备：本机写入会盖章，同步合并不盖章，线路经过一次 JSON 序列化。 */
function device(store: Store, deviceId: string, initial = emptyWorkspace()) {
  let workspace = initial;
  let since: number | null = null;
  const transport: Transport = async (path, body) => {
    const wire = clone(body) as Record<string, unknown>;
    return clone(
      path === "/sync/pull"
        ? store.pull(wire.since as number | undefined, wire.deviceId as string)
        : store.push(wire as never),
    );
  };
  return {
    get ws() {
      return workspace;
    },
    write(change: (next: Workspace) => void) {
      const next = clone(workspace);
      change(next);
      stampChanges(workspace, next, deviceId);
      workspace = next;
    },
    async sync() {
      const outcome = await runSync({
        since,
        deviceId,
        transport,
        read: () => workspace,
        merge: async (change) => {
          const next = clone(workspace);
          change(next);
          workspace = next;
        },
      });
      since = outcome.now;
      return outcome;
    },
    resetSince() {
      since = null;
    },
  };
}

function entry(id: string, note = ""): GrowthEntry {
  return {
    id, title: "喂奶", note, capturedAt: "2026-11-07T10:00", tag: "喂奶",
    milestone: false, favorite: false,
    care: { kind: "feeding", sourceText: "喂奶", amountMl: 90 },
  };
}
const notes = (ws: Workspace) => ws.entries.map((item) => `${item.id}:${item.note}`).sort();

test("新记录推上去，另一台设备能拉到；再同步一轮两边都没有多余流量", async () => {
  const store = openStore();
  const a = device(store, "A");
  const b = device(store, "B");
  a.write((ws) => ws.entries.push(entry("e1")));
  await a.sync();
  await b.sync();
  assert.deepEqual(notes(b.ws), ["e1:"]);
  assert.deepEqual(b.ws.syncDirty ?? [], []);

  const again = [await a.sync(), await b.sync()];
  assert.deepEqual(again.map((item) => [item.pulled, item.pushed]), [[0, 0], [0, 0]], "合并不会被当成修改推回去");
});

test("两台设备改同一条：后推送者胜，先推者下次拉到较新版本", async () => {
  const store = openStore();
  const a = device(store, "A");
  const b = device(store, "B");
  a.write((ws) => ws.entries.push(entry("e1")));
  await a.sync();
  await b.sync();

  a.write((ws) => (ws.entries[0]!.note = "A 改的"));
  b.write((ws) => (ws.entries[0]!.note = "B 改的"));
  await a.sync();
  const outcome = await b.sync();
  assert.equal(outcome.kept, 1, "B 本机有未推送修改，保留本机并提示一次");
  await a.sync();
  assert.deepEqual(notes(a.ws), ["e1:B 改的"]);
  assert.deepEqual(notes(b.ws), ["e1:B 改的"]);
});

test("A 删除、B 修改：删除胜出，记录不复活（两种先后顺序）", async () => {
  for (const deleteFirst of [true, false]) {
    const store = openStore();
    const a = device(store, "A");
    const b = device(store, "B");
    a.write((ws) => ws.entries.push(entry("e1"), entry("e2")));
    await a.sync();
    await b.sync();

    a.write((ws) => (ws.entries = ws.entries.filter((item) => item.id !== "e1")));
    b.write((ws) => (ws.entries.find((item) => item.id === "e1")!.note = "B 改的"));
    if (deleteFirst) {
      await a.sync();
      const outcome = await b.sync();
      assert.equal(outcome.removed, 1, "B 的未推送修改被远端删除覆盖并提示");
    } else {
      await b.sync();
      await a.sync();
      await b.sync();
    }
    await a.sync();
    assert.deepEqual(notes(a.ws), ["e2:"], `deleteFirst=${deleteFirst}`);
    assert.deepEqual(notes(b.ws), ["e2:"], `deleteFirst=${deleteFirst}`);
    assert.deepEqual(a.ws.tombstones, [], "推送成功后墓碑清理");
  }
});

test("里程碑两端各勾不同项取并集，取消勾选能同步", async () => {
  const store = openStore();
  const a = device(store, "A");
  const b = device(store, "B");
  a.write((ws) => (ws.milestones = { "m2:0": "2026-11-01" }));
  b.write((ws) => (ws.milestones = { "m4:1": "2026-11-02" }));
  await a.sync();
  await b.sync();
  await a.sync();
  assert.deepEqual(a.ws.milestones, { "m2:0": "2026-11-01", "m4:1": "2026-11-02" });
  assert.deepEqual(b.ws.milestones, a.ws.milestones);

  a.write((ws) => delete ws.milestones!["m2:0"]);
  await a.sync();
  await b.sync();
  assert.deepEqual(b.ws.milestones, { "m4:1": "2026-11-02" });
});

test("旧备份迁移后全量同步；资料、接种、素材元信息都过去，原片地址和示例不上传", async () => {
  const store = openStore();
  const old = emptyWorkspace();
  old.baby = { name: "小米", birthDate: "2026-05-01" };
  old.entries.push(entry("old"));
  old.media.push({
    id: "m1", kind: "image", name: "a.jpg", mime: "image/jpeg", size: 10,
    capturedAt: "2026-11-01T08:00", theme: "sand", url: "blob:local",
  });
  old.vaccinations = [{ id: "v1", code: "HepB", dose: 1, date: "2026-05-01", createdAt: "2026-05-01T00:00:00Z" }];
  addDemo(old);
  migrateSyncMeta(old, "A");
  const a = device(store, "A", old);
  const b = device(store, "B");
  await a.sync();
  await b.sync();

  assert.equal(b.ws.baby.name, "小米");
  assert.deepEqual(notes(b.ws), ["old:"]);
  assert.equal(b.ws.vaccinations?.[0]?.code, "HepB");
  assert.equal(b.ws.media.length, 1);
  assert.equal(b.ws.media[0]!.url, undefined, "对象 URL 不跨设备");
  assert.equal(a.ws.media.find((item) => item.id === "m1")!.url, "blob:local", "本机预览地址保留");
});

test("新设备空资料不会盖掉已有资料；恢复备份后全量重同步", async () => {
  const store = openStore();
  const a = device(store, "A");
  a.write((ws) => (ws.baby = { name: "小米", birthDate: "2026-05-01" }));
  await a.sync();
  const b = device(store, "B");
  await b.sync();
  assert.equal(b.ws.baby.name, "小米");
  assert.equal(a.ws.baby.name, "小米");

  a.resetSince();
  const full = await a.sync();
  assert.equal(full.pushed, 0, "内容未变，服务端不计写入");
});

test("服务端：鉴权、HTTPS、体积上限与结构校验", async () => {
  const key = "k".repeat(40);
  const server = createServer(createHandler({ store: openStore(), key }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "x-forwarded-proto": "https", authorization: `Bearer ${key}`, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }).then((res) => res.status);
  try {
    assert.equal((await fetch(`${base}/sync/health`)).status, 200);
    assert.equal(await post("/sync/pull", {}, { "x-forwarded-proto": "http" }), 400);
    assert.equal(await post("/sync/pull", {}, { authorization: "Bearer wrong" }), 401);
    assert.equal(await post("/sync/push", "x".repeat(1024 * 1024 + 1)), 413);
    assert.equal(await post("/sync/push", { deviceId: "A", records: [{ kind: "candidate", id: "x", payload: { id: "x" } }] }), 400);
    assert.equal(await post("/sync/push", { deviceId: "A", records: [{ kind: "entry", id: "x", payload: { id: "y" } }] }), 400);
    assert.equal(await post("/sync/push", { deviceId: "A", records: [{ kind: "entry", id: "x", payload: { id: "x" } }] }), 200);
    assert.equal(await post("/sync/reset", {}), 400, "清空需要确认口令");
    assert.equal(await post("/sync/reset", { confirm: "清空同步数据" }), 200);
  } finally {
    server.close();
  }
});

test("服务端：90 天前的墓碑随拉取清理，新墓碑照常下发", () => {
  let now = 1_800_000_000_000;
  const store = openStore(":memory:", () => now);
  store.push({ deviceId: "A", records: [{ kind: "entry", id: "old", payload: { id: "old" } }] });
  store.push({ deviceId: "A", records: [{ kind: "entry", id: "old", deleted: true }] });
  store.push({ deviceId: "A", records: [{ kind: "entry", id: "fresh", payload: { id: "fresh" } }] });
  store.push({ deviceId: "A", records: [{ kind: "entry", id: "fresh", deleted: true }] });
  assert.deepEqual(
    store.pull(undefined, "B").records.map((row) => `${row.id}:${row.deleted}`),
    ["old:true", "fresh:true"],
  );
  now += 91 * 24 * 60 * 60 * 1000;
  store.push({ deviceId: "A", records: [{ kind: "entry", id: "later", deleted: true }] });
  assert.deepEqual(
    store.pull(undefined, "B").records.map((row) => `${row.id}:${row.deleted}`),
    ["later:true"],
    "超期墓碑随拉取清掉，新墓碑照常下发",
  );
});
