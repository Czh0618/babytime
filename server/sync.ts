// BabyTime 家庭同步服务（P4.3 / P7.2）：单文件、只用 Node 标准库（需 Node ≥ 22.18：node:sqlite + 直接运行 .ts）。
// 结构化 JSON 存 SQLite；照片原片与缩略图存本机磁盘目录。冲突以服务端时间为准，后写者胜。
// 设计见 docs/SYNC.md 与 docs/PLAN-P7-multi-photo-media-sync.md。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const VERSION = "2";
export const MAX_BODY = 1024 * 1024;
/** P7.2：单个原片 / 缩略图上限 20 MB，视频暂不同步。 */
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
/** 墓碑保留 90 天，随拉取顺带清理（docs/SYNC.md 3.2 / 12）。 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MEDIA_VARIANTS = ["original", "thumb"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];
/** 只允许 UUID，防止路径穿越，也把示例 / 旧版素材排除在外。 */
export const MEDIA_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEFAULT_MEDIA_DIR = "/var/lib/babytime/media";

export function mediaFileName(id: string, variant: MediaVariant): string {
  return variant === "thumb" ? `${id}.thumb` : id;
}

const KINDS = new Set(["entry", "vaccination", "recap", "media"]);
const SINGLETONS = new Set(["profiles"]);

type Row = Record<string, unknown>;
export interface PushBody {
  deviceId: string;
  records?: Array<{ kind: string; id: string; deleted?: boolean; payload?: Row | null }>;
  /** `profiles` 是数组；结构校验单独处理。 */
  singletons?: Record<string, Row | Row[]>;
}
export interface BlobRow {
  id: string;
  variant: string;
  size: number;
  sha256: string;
  updated_ms: number;
}
export type Store = ReturnType<typeof openStore>;

/**
 * onPurge：90 天前的 media 墓碑被清掉时回调，让调用方删除磁盘文件。
 * 客户端 onPurge 为空时（单测）行为与 P7 之前一致。
 */
export function openStore(
  file = ":memory:",
  clock: () => number = Date.now,
  onPurge?: (ids: string[]) => void,
) {
  const db = new DatabaseSync(file);
  db.exec(`
    pragma journal_mode = wal;
    create table if not exists records (
      kind text not null, id text not null, payload text,
      updated_ms integer not null, deleted integer not null default 0, device text,
      primary key (kind, id));
    create index if not exists records_updated on records (updated_ms);
    create table if not exists singletons (
      key text primary key, payload text not null, updated_ms integer not null, device text);
    create table if not exists blobs (
      id text not null, variant text not null, size integer not null,
      sha256 text not null, updated_ms integer not null,
      primary key (id, variant));
  `);
  const q = {
    record: db.prepare("select payload, deleted from records where kind = ? and id = ?"),
    putRecord: db.prepare(`insert into records (kind, id, payload, updated_ms, deleted, device)
      values (?, ?, ?, ?, ?, ?) on conflict (kind, id) do update set
      payload = excluded.payload, updated_ms = excluded.updated_ms,
      deleted = excluded.deleted, device = excluded.device`),
    singleton: db.prepare("select payload from singletons where key = ?"),
    putSingleton: db.prepare(`insert into singletons (key, payload, updated_ms, device) values (?, ?, ?, ?)
      on conflict (key) do update set payload = excluded.payload,
      updated_ms = excluded.updated_ms, device = excluded.device`),
    purge: db.prepare("delete from records where deleted = 1 and updated_ms < ?"),
    expiredMedia: db.prepare(
      "select id from records where kind = 'media' and deleted = 1 and updated_ms < ?",
    ),
    maxMs: db.prepare(`select max(m) as m from (select max(updated_ms) as m from records
      union all select max(updated_ms) from singletons)`),
    blob: db.prepare("select * from blobs where id = ? and variant = ?"),
    allBlobIds: db.prepare("select distinct id from blobs"),
    putBlob: db.prepare(`insert into blobs (id, variant, size, sha256, updated_ms)
      values (?, ?, ?, ?, ?) on conflict (id, variant) do update set
      size = excluded.size, sha256 = excluded.sha256, updated_ms = excluded.updated_ms`),
    deleteBlobs: db.prepare("delete from blobs where id = ?"),
    mediaPayload: db.prepare(
      "select payload from records where kind = 'media' and id = ? and deleted = 0",
    ),
  };
  // 服务端时钟严格递增：同一毫秒内的多次写入也能被 since 区分开。
  let last = Number((q.maxMs.get() as Row | undefined)?.m ?? 0);
  const tick = () => (last = Math.max(clock(), last + 1));

  /** 拉取 since 之后的变化；增量拉取时跳过本设备自己写的内容。 */
  function pull(since: number | undefined, deviceId: string) {
    const cutoff = clock() - TOMBSTONE_TTL_MS;
    const expired = [...new Set(
      (q.expiredMedia.all(cutoff) as Row[]).map((row) => String(row.id)),
    )];
    q.purge.run(cutoff);
    for (const id of expired) q.deleteBlobs.run(id);
    if (expired.length && onPurge) {
      try {
        onPurge(expired);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
      }
    }
    const now = tick();
    const after = since !== undefined && Number.isFinite(since) ? since : -1;
    const mine = after >= 0 && deviceId ? deviceId : "";
    const records = db
      .prepare(`select kind, id, payload, deleted from records
        where updated_ms > ? and updated_ms <= ? and coalesce(device, '') != ? order by updated_ms`)
      .all(after, now, mine)
      .map((row: Row) => ({
        kind: row.kind as string, id: row.id as string, deleted: Boolean(row.deleted),
        payload: row.deleted ? null : (JSON.parse(row.payload as string) as Row),
      }));
    const singletons: Record<string, Row | Row[]> = {};
    for (const row of db
      .prepare(`select key, payload from singletons
        where updated_ms > ? and updated_ms <= ? and coalesce(device, '') != ?`)
      .all(after, now, mine) as Row[])
      singletons[row.key as string] = JSON.parse(row.payload as string) as Row | Row[];
    return { now, records, singletons };
  }

  /** 写入一批变化：内容不变的跳过，已删除的不复活（列入 rejected，客户端据此删掉本地副本）。 */
  function push({ deviceId, records = [], singletons = {} }: PushBody) {
    const rejected: Array<{ kind: string; id: string }> = [];
    let applied = 0;
    db.exec("begin");
    try {
      for (const item of records) {
        const payload = item.deleted ? null : JSON.stringify(item.payload);
        const current = q.record.get(item.kind, item.id) as Row | undefined;
        if (current?.deleted) {
          if (!item.deleted) rejected.push({ kind: item.kind, id: item.id });
          continue;
        }
        if (current && !item.deleted && current.payload === payload) continue;
        q.putRecord.run(item.kind, item.id, payload, tick(), item.deleted ? 1 : 0, deviceId);
        applied++;
      }
      for (const [key, value] of Object.entries(singletons)) {
        const payload = JSON.stringify(value);
        if ((q.singleton.get(key) as Row | undefined)?.payload === payload) continue;
        q.putSingleton.run(key, payload, tick(), deviceId);
        applied++;
      }
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
    return { now: last, applied, rejected };
  }

  function reset(): string[] {
    const ids = (q.allBlobIds.all() as Row[]).map((row) => String(row.id));
    db.exec("delete from records; delete from singletons; delete from blobs;");
    return ids;
  }

  function blob(id: string, variant: MediaVariant): BlobRow | undefined {
    return q.blob.get(id, variant) as BlobRow | undefined;
  }

  function putBlob(id: string, variant: MediaVariant, size: number, sha256: string) {
    q.putBlob.run(id, variant, size, sha256, clock());
  }

  /** 素材元信息里的 mime 由客户端随结构化记录同步上来，用于 GET 的 Content-Type。 */
  function mediaMime(id: string): string | undefined {
    const row = q.mediaPayload.get(id) as Row | undefined;
    if (!row?.payload) return undefined;
    try {
      const payload = JSON.parse(row.payload as string) as Row;
      return typeof payload.mime === "string" && payload.mime
        ? payload.mime
        : undefined;
    } catch {
      return undefined;
    }
  }

  return { pull, push, reset, blob, putBlob, mediaMime, close: () => db.close() };
}

const isObject = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const shortString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

/** 只做结构校验；业务规则（体温范围等）留在前端领域层，避免两份规则漂移。 */
export function validPush(body: unknown): body is PushBody {
  if (!isObject(body) || !shortString(body.deviceId)) return false;
  const { records = [], singletons = {} } = body as Row;
  return (
    Array.isArray(records) && records.length <= 500 &&
    records.every((item: unknown) =>
      isObject(item) && KINDS.has(item.kind as string) && shortString(item.id) &&
      (item.deleted === true || (isObject(item.payload) && item.payload.id === item.id))) &&
    isObject(singletons) &&
    Object.entries(singletons).every(([key, value]) =>
      SINGLETONS.has(key) &&
      (key === "profiles"
        ? Array.isArray(value) && value.every((item) => isObject(item) && shortString(item.id))
        : isObject(value)),
    )
  );
}

function sameKey(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface BodyResult {
  status?: number;
  error?: string;
  body?: Row;
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<BodyResult> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit)
      return { status: 413, error: `请求超过 ${Math.round(limit / 1024 / 1024)} MB，请分批同步。` };
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    return { body: isObject(parsed) ? parsed : {} };
  } catch {
    return { status: 400, error: "请求不是有效的 JSON。" };
  }
}

export function createHandler({
  store,
  key,
  allowHttp = false,
  mediaDir = process.env.BABYTIME_MEDIA_DIR ?? DEFAULT_MEDIA_DIR,
}: {
  store: Store;
  key: string;
  allowHttp?: boolean;
  mediaDir?: string;
}) {
  if (!key || key.length < 32) throw new Error("BABYTIME_SYNC_KEY 至少 32 个字符。");
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const filePath = (id: string, variant: MediaVariant) =>
    join(mediaDir, mediaFileName(id, variant));

  function deleteMediaFiles(ids: string[]) {
    for (const id of ids)
      for (const variant of MEDIA_VARIANTS) {
        try {
          unlinkSync(filePath(id, variant));
        } catch {
          // 文件本来就不在（或已经删过），不算错误。
        }
      }
  }

  /** 批量查询：只返回 blobs 表有记录且磁盘文件确实存在的 id。 */
  async function existsRoute(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== "POST") return send(res, 405, { error: "不支持的请求方法。" });
    const parsed = await readJsonBody(req, MAX_BODY);
    if (parsed.status) return send(res, parsed.status, { error: parsed.error });
    const body = parsed.body!;
    const variant = (body.variant ?? "original") as MediaVariant;
    if (!MEDIA_VARIANTS.includes(variant) || !Array.isArray(body.ids) ||
      body.ids.length > 500 ||
      !body.ids.every((id: unknown) => typeof id === "string" && MEDIA_ID_RE.test(id)))
      return send(res, 400, { error: "素材标识或类型不正确。" });
    const ids = (body.ids as string[]).filter(
      (id) => store.blob(id, variant) && existsSync(filePath(id, variant)),
    );
    return send(res, 200, { ids: [...new Set(ids)], variant });
  }

  async function putRoute(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    variant: MediaVariant,
  ) {
    mkdirSync(mediaDir, { recursive: true });
    const target = filePath(id, variant);
    const tmp = join(mediaDir, `.${id}.${variant}.${randomUUID()}.tmp`);
    const hash = createHash("sha256");
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > MAX_MEDIA_BYTES) {
          callback(new Error("MEDIA_TOO_LARGE"));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      // 流式写临时文件，完成后同目录 rename：要么完整可见，要么完全不存在。
      await pipeline(req, counter, createWriteStream(tmp, { flags: "wx" }));
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        /* 临时文件可能尚未创建 */
      }
      if (size > MAX_MEDIA_BYTES)
        return send(res, 413, { error: "单个素材不能超过 20 MB。" });
      return send(res, 500, { error: "写入素材失败。" });
    }
    const sha256 = hash.digest("hex");
    const current = store.blob(id, variant);
    if (current && current.sha256 === sha256 && current.size === size && existsSync(target)) {
      try {
        unlinkSync(tmp);
      } catch {
        /* 忽略 */
      }
      return send(res, 200, { ok: true, size, sha256, dedup: true });
    }
    try {
      renameSync(tmp, target);
      store.putBlob(id, variant, size, sha256);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      try {
        unlinkSync(tmp);
      } catch {
        /* 忽略 */
      }
      return send(res, 500, { error: "保存素材失败。" });
    }
    return send(res, 200, { ok: true, size, sha256 });
  }

  function getRoute(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    variant: MediaVariant,
  ) {
    const row = store.blob(id, variant);
    const target = filePath(id, variant);
    if (!row || !existsSync(target)) return send(res, 404, { error: "素材不存在。" });
    const etag = `"${row.sha256}"`;
    const headers: Record<string, string> = {
      "content-type":
        variant === "thumb" ? "image/jpeg" : store.mediaMime(id) ?? "application/octet-stream",
      "content-length": String(row.size),
      etag,
      "cache-control": "private, max-age=31536000, immutable",
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(target).on("error", () => res.destroy()).pipe(res);
  }

  async function mediaRoute(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    params: URLSearchParams,
  ) {
    if (path === "/sync/media/exists") return existsRoute(req, res);
    const id = path.slice("/sync/media/".length);
    if (!MEDIA_ID_RE.test(id))
      return send(res, 400, { error: "素材标识格式不正确。" });
    const variant = (params.get("variant") ?? "original") as MediaVariant;
    if (!MEDIA_VARIANTS.includes(variant))
      return send(res, 400, { error: "素材类型只能是 original 或 thumb。" });
    if (req.method === "PUT") return putRoute(req, res, id, variant);
    if (req.method === "GET" || req.method === "HEAD")
      return getRoute(req, res, id, variant);
    return send(res, 405, { error: "不支持的请求方法。" });
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    if (req.method === "GET" && path === "/sync/health") return send(res, 200, { ok: true, version: VERSION });
    // Nginx 负责 TLS 并带上 X-Forwarded-Proto；直接走 http 的请求一律拒绝，密钥不能明文上网。
    if (!allowHttp && req.headers["x-forwarded-proto"] !== "https")
      return send(res, 400, { error: "只接受 HTTPS 请求。" });
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !sameKey(auth.slice(7), key))
      return send(res, 401, { error: "家庭密钥不正确。" });

    try {
      if (path.startsWith("/sync/media/"))
        return await mediaRoute(req, res, path, url.searchParams);
      if (req.method !== "POST") return send(res, 405, { error: "不支持的请求方法。" });
      const parsed = await readJsonBody(req, MAX_BODY);
      if (parsed.status) return send(res, parsed.status, { error: parsed.error });
      const body = parsed.body!;
      if (path === "/sync/pull") {
        const since = body.since === undefined || body.since === null ? undefined : Number(body.since);
        return send(res, 200, store.pull(since, typeof body.deviceId === "string" ? body.deviceId : ""));
      }
      if (path === "/sync/push") {
        if (!validPush(body)) return send(res, 400, { error: "同步数据结构不正确。" });
        return send(res, 200, store.push(body));
      }
      if (path === "/sync/reset") {
        if (body.confirm !== "清空同步数据") return send(res, 400, { error: "缺少确认口令。" });
        deleteMediaFiles(store.reset());
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: "没有这个接口。" });
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return send(res, 500, { error: "同步服务内部错误。" });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mediaDir = process.env.BABYTIME_MEDIA_DIR ?? DEFAULT_MEDIA_DIR;
  const store = openStore(
    process.env.BABYTIME_SYNC_DB ?? "/var/lib/babytime/sync.db",
    Date.now,
    (ids) => {
      for (const id of ids)
        for (const variant of MEDIA_VARIANTS) {
          try {
            unlinkSync(join(mediaDir, mediaFileName(id, variant)));
          } catch {
            /* 文件不存在时忽略 */
          }
        }
    },
  );
  const handler = createHandler({
    store,
    key: process.env.BABYTIME_SYNC_KEY ?? "",
    allowHttp: process.env.BABYTIME_SYNC_ALLOW_HTTP === "1",
    mediaDir,
  });
  const port = Number(process.env.BABYTIME_SYNC_PORT ?? 8787);
  createServer(handler).listen(port, "127.0.0.1", () =>
    console.log(`babytime-sync ${VERSION} listening on 127.0.0.1:${port}`),
  );
}
