// BabyTime 家庭同步服务（P4.3）：单文件、只用 Node 标准库（需 Node ≥ 22.18：node:sqlite + 直接运行 .ts）。
// 只存结构化 JSON，不存原片。冲突以服务端时间为准，后写者胜；已删除的条目不会被复活。
// 设计见 docs/SYNC.md。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const VERSION = "1";
export const MAX_BODY = 1024 * 1024;
/** 墓碑保留 90 天，随拉取顺带清理（docs/SYNC.md 3.2 / 12）。 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const KINDS = new Set(["entry", "vaccination", "recap", "media"]);
const SINGLETONS = new Set(["profiles"]);

type Row = Record<string, unknown>;
export interface PushBody {
  deviceId: string;
  records?: Array<{ kind: string; id: string; deleted?: boolean; payload?: Row | null }>;
  /** `profiles` 是数组；结构校验单独处理。 */
  singletons?: Record<string, Row | Row[]>;
}
export type Store = ReturnType<typeof openStore>;

export function openStore(file = ":memory:", clock: () => number = Date.now) {
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
    maxMs: db.prepare(`select max(m) as m from (select max(updated_ms) as m from records
      union all select max(updated_ms) from singletons)`),
  };
  // 服务端时钟严格递增：同一毫秒内的多次写入也能被 since 区分开。
  let last = Number((q.maxMs.get() as Row | undefined)?.m ?? 0);
  const tick = () => (last = Math.max(clock(), last + 1));

  /** 拉取 since 之后的变化；增量拉取时跳过本设备自己写的内容。 */
  function pull(since: number | undefined, deviceId: string) {
    q.purge.run(clock() - TOMBSTONE_TTL_MS);
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

  function reset() {
    db.exec("delete from records; delete from singletons;");
  }

  return { pull, push, reset, close: () => db.close() };
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

export function createHandler({ store, key, allowHttp = false }: { store: Store; key: string; allowHttp?: boolean }) {
  if (!key || key.length < 32) throw new Error("BABYTIME_SYNC_KEY 至少 32 个字符。");
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/sync/health") return send(res, 200, { ok: true, version: VERSION });
    // Nginx 负责 TLS 并带上 X-Forwarded-Proto；直接走 http 的请求一律拒绝，密钥不能明文上网。
    if (!allowHttp && req.headers["x-forwarded-proto"] !== "https")
      return send(res, 400, { error: "只接受 HTTPS 请求。" });
    if (req.method !== "POST") return send(res, 405, { error: "不支持的请求方法。" });
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !sameKey(auth.slice(7), key))
      return send(res, 401, { error: "家庭密钥不正确。" });

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return send(res, 413, { error: "请求超过 1 MB，请分批同步。" });
      chunks.push(chunk);
    }
    let body: Row;
    try {
      const parsed: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      body = isObject(parsed) ? parsed : {};
    } catch {
      return send(res, 400, { error: "请求不是有效的 JSON。" });
    }
    try {
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
        store.reset();
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
  const store = openStore(process.env.BABYTIME_SYNC_DB ?? "/var/lib/babytime/sync.db");
  const handler = createHandler({
    store,
    key: process.env.BABYTIME_SYNC_KEY ?? "",
    allowHttp: process.env.BABYTIME_SYNC_ALLOW_HTTP === "1",
  });
  const port = Number(process.env.BABYTIME_SYNC_PORT ?? 8787);
  createServer(handler).listen(port, "127.0.0.1", () =>
    console.log(`babytime-sync ${VERSION} listening on 127.0.0.1:${port}`),
  );
}
