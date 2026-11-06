import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  describePersistence,
  ensurePersistenceRequested,
  initializePersistenceStatus,
  persistenceStatus,
  requestPersistentStorage,
} from "../src/lib/persistence.ts";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const memory = new MemoryStorage();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memory,
  });
  memory.clear();
  persistenceStatus.value = "unknown";
});

afterEach(() => {
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("浏览器不提供 storage.persist 时返回 unsupported", async () => {
  assert.equal(await requestPersistentStorage(undefined), "unsupported");
  assert.equal(await requestPersistentStorage({}), "unsupported");
  assert.equal(persistenceStatus.value, "unsupported");
});

test("已经是持久化状态时不再重复申请", async () => {
  let calls = 0;
  const result = await requestPersistentStorage({
    persisted: async () => true,
    persist: async () => {
      calls++;
      return false;
    },
  });
  assert.equal(result, "persisted");
  assert.equal(calls, 0);
});

test("批准、拒绝、抛错与先查后申请的结果", async () => {
  assert.equal(
    await requestPersistentStorage({ persist: async () => true }),
    "persisted",
  );
  assert.equal(
    await requestPersistentStorage({ persist: async () => false }),
    "denied",
  );
  assert.equal(
    await requestPersistentStorage({
      persist: async () => {
        throw new Error("denied by browser");
      },
    }),
    "unsupported",
  );
  assert.equal(
    await requestPersistentStorage({
      persisted: async () => false,
      persist: async () => true,
    }),
    "persisted",
  );
});

test("结果写入本机存储，启动时可恢复", async () => {
  await requestPersistentStorage({ persist: async () => true });
  assert.equal(memory.getItem("babytime.persistenceStatus"), "persisted");
  persistenceStatus.value = "unknown";
  initializePersistenceStatus();
  assert.equal(persistenceStatus.value, "persisted");
});

test("本机存了非法值时回退为未申请", () => {
  memory.setItem("babytime.persistenceStatus", "garbage");
  initializePersistenceStatus();
  assert.equal(persistenceStatus.value, "unknown");
});

test("首次保存记录后只申请一次", async () => {
  let calls = 0;
  const runtime = {
    persist: async () => {
      calls++;
      return true;
    },
  };
  await ensurePersistenceRequested(runtime);
  assert.equal(calls, 1);
  assert.equal(memory.getItem("babytime.persistenceRequested"), "1");
  assert.equal(persistenceStatus.value, "persisted");
  await ensurePersistenceRequested(runtime);
  assert.equal(calls, 1);
});

test("四种状态都有可读的标签与说明", () => {
  assert.equal(describePersistence("persisted").label, "已持久化");
  assert.equal(describePersistence("denied").label, "未批准");
  assert.equal(describePersistence("unsupported").label, "不支持");
  assert.equal(describePersistence("unknown").label, "未申请");
  for (const status of ["persisted", "denied", "unsupported", "unknown"] as const) {
    assert.ok(describePersistence(status).copy.length > 10);
  }
});
