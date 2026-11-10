import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createHandler,
  MAX_MEDIA_BYTES,
  TOMBSTONE_TTL_MS,
  openStore,
} from "../server/sync.ts";

const KEY = "k".repeat(40);
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

async function harness(clock: () => number = Date.now) {
  const dir = await mkdtemp(join(tmpdir(), "babytime-media-"));
  const purged: string[] = [];
  const store = openStore(":memory:", clock, (ids) => {
    purged.push(...ids);
    for (const id of ids)
      for (const name of [id, `${id}.thumb`]) {
        try {
          unlinkSync(join(dir, name));
        } catch {
          /* 文件不存在 */
        }
      }
  });
  const server = createServer(
    createHandler({ store, key: KEY, allowHttp: true, mediaDir: dir }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}, withKey = true) =>
    fetch(base + path, {
      ...init,
      headers: {
        ...(withKey ? { authorization: `Bearer ${KEY}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  return {
    dir,
    store,
    purged,
    call,
    async close() {
      server.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("P7.2.1 上传 / 下载往返：ETag、Content-Type、HEAD、304、exists", async () => {
  const h = await harness();
  try {
    const bytes = Buffer.from("宝宝的第一张原片");
    const sha = createHash("sha256").update(bytes).digest("hex");
    h.store.push({
      deviceId: "A",
      records: [{ kind: "media", id: ID, payload: { id: ID, mime: "image/jpeg" } }],
    });
    const put = await h.call(`/sync/media/${ID}?variant=original`, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: bytes,
    });
    assert.equal(put.status, 200);
    assert.deepEqual(await put.json(), { ok: true, size: bytes.length, sha256: sha });

    const get = await h.call(`/sync/media/${ID}?variant=original`);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), "image/jpeg");
    assert.equal(get.headers.get("etag"), `"${sha}"`);
    assert.match(get.headers.get("cache-control") ?? "", /private, max-age=31536000, immutable/);
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), bytes);

    const head = await h.call(`/sync/media/${ID}?variant=original`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(bytes.length));

    assert.equal(
      (await h.call(`/sync/media/${ID}?variant=original`, {
        headers: { "if-none-match": `"${sha}"` },
      })).status,
      304,
    );

    const thumb = Buffer.from("缩略图");
    assert.equal(
      (await h.call(`/sync/media/${ID}?variant=thumb`, { method: "PUT", body: thumb })).status,
      200,
    );
    const exists = await h.call("/sync/media/exists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [ID, OTHER_ID], variant: "original" }),
    });
    assert.equal(exists.status, 200);
    assert.deepEqual((await exists.json()).ids, [ID]);
    const thumbExists = await h.call("/sync/media/exists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [ID], variant: "thumb" }),
    });
    assert.deepEqual((await thumbExists.json()).ids, [ID]);

    assert.equal((await h.call(`/sync/media/${OTHER_ID}?variant=original`)).status, 404);
  } finally {
    await h.close();
  }
});

test("P7.2.4 客户端 mime 不能变成任意 Content-Type，响应带 nosniff", async () => {
  const h = await harness();
  try {
    h.store.push({
      deviceId: "A",
      records: [{ kind: "media", id: ID, payload: { id: ID, mime: "text/html" } }],
    });
    const path = `/sync/media/${ID}?variant=original`;
    assert.equal((await h.call(path, { method: "PUT", body: "x" })).status, 200);
    const get = await h.call(path);
    assert.equal(get.headers.get("content-type"), "application/octet-stream");
    assert.equal(get.headers.get("x-content-type-options"), "nosniff");
    const json = await h.call("/sync/health");
    assert.equal(json.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await h.close();
  }
});

test("P7.2.1 幂等重复上传不改动文件，超限 413、非法 id 400、无密钥 401", async () => {
  const h = await harness();
  try {
    const bytes = Buffer.from("同一张照片");
    const path = `/sync/media/${ID}?variant=original`;
    assert.equal((await h.call(path, { method: "PUT", body: bytes })).status, 200);
    const again = await h.call(path, { method: "PUT", body: bytes });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).dedup, true);

    assert.equal(
      (await h.call(path, { method: "PUT", body: Buffer.alloc(MAX_MEDIA_BYTES + 1) })).status,
      413,
    );
    // 超限后原本的文件仍然可读。
    const get = await h.call(path);
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), bytes);

    assert.equal(
      (await h.call("/sync/media/not-a-uuid?variant=original", { method: "PUT", body: "x" })).status,
      400,
    );
    assert.equal(
      (await h.call(`/sync/media/${ID}?variant=wrong`, { method: "GET" })).status,
      400,
    );
    assert.equal(
      (await h.call("/sync/media/exists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ["../etc/passwd"] }),
      })).status,
      400,
    );
    assert.equal((await h.call(path, {}, false)).status, 401);
    assert.equal((await h.call("/sync/health", {}, false)).status, 200, "健康检查无需密钥");
  } finally {
    await h.close();
  }
});

test("P7.2.1 墓碑超期后随拉取删除磁盘文件；reset 也清掉素材文件", async () => {
  let now = 1_800_000_000_000;
  const h = await harness(() => now);
  try {
    const path = `/sync/media/${ID}?variant=original`;
    assert.equal((await h.call(path, { method: "PUT", body: "photo" })).status, 200);
    assert.equal(existsSync(join(h.dir, ID)), true);
    h.store.push({ deviceId: "A", records: [{ kind: "media", id: ID, payload: { id: ID } }] });
    h.store.push({ deviceId: "A", records: [{ kind: "media", id: ID, deleted: true }] });
    h.store.pull(undefined, "B");
    assert.equal(existsSync(join(h.dir, ID)), true, "未超期时文件保留");

    // tick() 会让同一毫秒内的写入严格递增，留一点余量确保墓碑真的超期。
    now += TOMBSTONE_TTL_MS + 10_000;
    h.store.pull(undefined, "B");
    assert.deepEqual(h.purged, [ID]);
    assert.equal(existsSync(join(h.dir, ID)), false, "超期墓碑随清理删掉磁盘文件");
    assert.equal(h.store.blob(ID, "original"), undefined, "blobs 行一并清理");

    assert.equal((await h.call(path, { method: "PUT", body: "again" })).status, 200);
    const reset = await h.call("/sync/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "清空同步数据" }),
    });
    assert.equal(reset.status, 200);
    assert.equal(existsSync(join(h.dir, ID)), false);
  } finally {
    await h.close();
  }
});
