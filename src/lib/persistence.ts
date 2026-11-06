import { ref } from "vue";

/**
 * 持久化存储申请：Safari 开启防跨站跟踪时，会清理 7 天无交互站点的 IndexedDB。
 * navigator.storage.persist() 可以请求豁免。结果只显示，不影响记录保存。
 */

export type PersistenceStatus =
  | "unknown"
  | "persisted"
  | "denied"
  | "unsupported";

const STATUS_KEY = "babytime.persistenceStatus";
const REQUESTED_KEY = "babytime.persistenceRequested";

export interface StorageRuntime {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export const persistenceStatus = ref<PersistenceStatus>("unknown");

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function defaultRuntime(): StorageRuntime | undefined {
  try {
    return typeof navigator === "undefined" ? undefined : navigator.storage;
  } catch {
    return undefined;
  }
}

function remember(status: PersistenceStatus): PersistenceStatus {
  try {
    browserStorage()?.setItem(STATUS_KEY, status);
  } catch {
    // 隐私模式下写不进去也不影响本次结果。
  }
  persistenceStatus.value = status;
  return status;
}

function isStatus(value: unknown): value is PersistenceStatus {
  return (
    value === "unknown" ||
    value === "persisted" ||
    value === "denied" ||
    value === "unsupported"
  );
}

/** 恢复上次申请结果；页面启动时调用。 */
export function initializePersistenceStatus(): void {
  let saved: string | null = null;
  try {
    saved = browserStorage()?.getItem(STATUS_KEY) ?? null;
  } catch {
    saved = null;
  }
  persistenceStatus.value = isStatus(saved) ? saved : "unknown";
}

/** 可注入 runtime，便于测试浏览器不支持 / 拒绝 / 抛错等分支。 */
export async function requestPersistentStorage(
  runtime: StorageRuntime | undefined = defaultRuntime(),
): Promise<PersistenceStatus> {
  if (!runtime || typeof runtime.persist !== "function")
    return remember("unsupported");
  try {
    const already =
      typeof runtime.persisted === "function" ? await runtime.persisted() : false;
    const granted = already || (await runtime.persist());
    return remember(granted ? "persisted" : "denied");
  } catch {
    return remember("unsupported");
  }
}

/** 首次保存记录后调用一次；浏览器不支持时也只申请一次。 */
export async function ensurePersistenceRequested(
  runtime?: StorageRuntime,
): Promise<void> {
  let requested = false;
  try {
    requested = browserStorage()?.getItem(REQUESTED_KEY) === "1";
  } catch {
    requested = false;
  }
  if (requested) return;
  try {
    browserStorage()?.setItem(REQUESTED_KEY, "1");
  } catch {
    // 写不进去时仍申请一次，结果由 remember 保存。
  }
  await requestPersistentStorage(runtime);
}

export function describePersistence(status: PersistenceStatus): {
  label: string;
  copy: string;
} {
  switch (status) {
    case "persisted":
      return {
        label: "已持久化",
        copy: "浏览器已批准持久化存储，长时间不打开也不易被自动清理本机记录。",
      };
    case "denied":
      return {
        label: "未批准",
        copy: "浏览器没有批准持久化存储，建议定期用下方的导出备份 JSON 保留记录。",
      };
    case "unsupported":
      return {
        label: "不支持",
        copy: "当前浏览器不支持持久化存储申请，建议定期导出备份 JSON。",
      };
    default:
      return {
        label: "未申请",
        copy: "保存第一条记录后，会向浏览器申请持久化存储。",
      };
  }
}
