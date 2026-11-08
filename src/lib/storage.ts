import type { Workspace } from "../types";

const DB_NAME = "babytime";
const DB_VERSION = 1;
const WORKSPACE_STORE = "workspace";
const MEDIA_STORE = "media";
const CURRENT_WORKSPACE_KEY = "current";

interface WorkspaceRecord {
  key: string;
  value: Workspace;
}

export interface StoredMedia {
  id: string;
  file: Blob;
  thumbnail?: Blob;
  /** P7.2：只从服务器拿到缩略图时，file 存的是缩略图副本，不能当原图显示。 */
  remoteOnly?: boolean;
}

let databasePromise: Promise<IDBDatabase> | undefined;

function storageError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new Error("本机存储空间不足，请删除不需要的素材后再试。");
  }
  if (error instanceof DOMException && error.name === "SecurityError") {
    return new Error("浏览器禁止使用本机存储，请关闭隐私浏览或检查站点权限。");
  }
  if (error instanceof Error && error.message) return error;
  return new Error("本机存储暂时不可用，请稍后重试。");
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("当前浏览器不支持本机存储，请使用较新的浏览器。"),
    );
  }

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(storageError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(MEDIA_STORE)) {
        database.createObjectStore(MEDIA_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        // 版本升级会使当前连接失效，下一次调用必须重新 open，而不能复用旧 Promise。
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () =>
      reject(new Error("本机存储正在被其他页面占用，请关闭旧页面后重试。"));
  }).catch((error): never => {
    databasePromise = undefined;
    throw storageError(error);
  });
  return databasePromise!;
}

function snapshotWorkspace(workspace: Workspace): Workspace {
  try {
    const json = JSON.stringify(workspace, (key, value) => {
      if (key === "url" || key === "thumbnailUrl") return undefined;
      return value;
    });
    return JSON.parse(json) as Workspace;
  } catch (error) {
    throw new Error(`保存成长记录失败：${storageError(error).message}`);
  }
}

function completeTransaction<T>(
  transaction: IDBTransaction,
  operation: (
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(storageError(error));
      }
    };
    transaction.onabort = () =>
      fail(transaction.error ?? new Error("事务已中止"));
    transaction.onerror = () =>
      fail(transaction.error ?? new Error("事务执行失败"));
    transaction.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(undefined as T);
      }
    };
    try {
      operation(resolve, fail);
    } catch (error) {
      fail(error);
      try {
        transaction.abort();
      } catch {
        /* 已完成的事务不能再次中止 */
      }
    }
  });
}

export async function readWorkspace(): Promise<Workspace | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(WORKSPACE_STORE, "readonly");
      const request = transaction
        .objectStore(WORKSPACE_STORE)
        .get(CURRENT_WORKSPACE_KEY);
      request.onsuccess = () => {
        const record = request.result as WorkspaceRecord | undefined;
        resolve(record?.value ?? null);
      };
      request.onerror = () => reject(storageError(request.error));
      transaction.onerror = () => reject(storageError(transaction.error));
      transaction.onabort = () =>
        reject(storageError(transaction.error ?? new Error("事务已中止")));
    } catch (error) {
      reject(storageError(error));
    }
  });
}

export async function writeWorkspace(workspace: Workspace): Promise<void> {
  return writeWorkspaceAndMedia(workspace, []);
}

/** 原片和记录引用在同一个事务里提交，任一写入失败都会整体回滚。 */
export async function writeWorkspaceAndMedia(
  workspace: Workspace,
  mediaFiles: StoredMedia[],
): Promise<void> {
  const value = snapshotWorkspace(workspace);
  // P7.1：多图记录可能把同一素材写进多个槽，按 id 去重后再入事务。
  const uniqueFiles = [...new Map(mediaFiles.map((item) => [item.id, item])).values()];
  const database = await openDatabase();
  const transaction = database.transaction(
    uniqueFiles.length ? [WORKSPACE_STORE, MEDIA_STORE] : WORKSPACE_STORE,
    "readwrite",
  );
  await completeTransaction<void>(transaction, (_resolve, reject) => {
    const request = transaction
      .objectStore(WORKSPACE_STORE)
      .put({ key: CURRENT_WORKSPACE_KEY, value } satisfies WorkspaceRecord);
    request.onerror = () =>
      reject(request.error ?? new Error("写入成长记录失败"));
    for (const media of uniqueFiles) {
      if (!media.id || !(media.file instanceof Blob) || !media.file.size)
        throw new Error("素材为空或缺少标识，无法保存。");
      const mediaRequest = transaction.objectStore(MEDIA_STORE).put(media);
      mediaRequest.onerror = () => reject(mediaRequest.error ?? new Error("写入素材失败"));
    }
  });
}

export async function storeMedia(
  mediaId: string,
  file: Blob,
  thumbnail?: Blob,
  /** P7.2：只存远端缩略图时置 true，attachMedia 不会把它当原图。 */
  remoteOnly = false,
): Promise<void> {
  if (!mediaId) throw new Error("素材缺少唯一标识，无法保存。");
  if (!(file instanceof Blob) || file.size === 0)
    throw new Error("素材为空，无法保存。");
  const database = await openDatabase();
  const transaction = database.transaction(MEDIA_STORE, "readwrite");
  await completeTransaction<void>(transaction, (_resolve, reject) => {
    const request = transaction
      .objectStore(MEDIA_STORE)
      .put({ id: mediaId, file, thumbnail, remoteOnly } satisfies StoredMedia);
    request.onerror = () => reject(request.error ?? new Error("写入素材失败"));
  });
}

export async function readMedia(
  mediaId: string,
): Promise<{ file: Blob; thumbnail?: Blob; remoteOnly?: boolean } | undefined> {
  if (!mediaId) return undefined;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const transaction = database.transaction(MEDIA_STORE, "readonly");
      const request = transaction.objectStore(MEDIA_STORE).get(mediaId);
      request.onsuccess = () => {
        const result = request.result as StoredMedia | undefined;
        resolve(
          result
            ? { file: result.file, thumbnail: result.thumbnail, remoteOnly: result.remoteOnly }
            : undefined,
        );
      };
      request.onerror = () => reject(storageError(request.error));
      transaction.onerror = () => reject(storageError(transaction.error));
      transaction.onabort = () =>
        reject(storageError(transaction.error ?? new Error("事务已中止")));
    } catch (error) {
      reject(storageError(error));
    }
  });
}

export async function deleteMedia(mediaId: string): Promise<void> {
  if (!mediaId) return;
  const database = await openDatabase();
  const transaction = database.transaction(MEDIA_STORE, "readwrite");
  await completeTransaction<void>(transaction, (_resolve, reject) => {
    const request = transaction.objectStore(MEDIA_STORE).delete(mediaId);
    request.onerror = () => reject(request.error ?? new Error("删除素材失败"));
  });
}

/**
 * 在同一事务里保存调用方已经更新过的工作区，并删除对应的原片与缩略图。
 * 调用方负责先从 workspace 中移除相关领域引用；这里不修改传入对象。
 */
export async function removeMediaAndWorkspace(
  mediaIds: string[],
  workspace: Workspace,
): Promise<void> {
  const ids = [...new Set(mediaIds)].filter(Boolean);
  if (!ids.length) throw new Error("素材缺少唯一标识，无法删除。");
  const value = snapshotWorkspace(workspace);
  const database = await openDatabase();
  const transaction = database.transaction(
    [WORKSPACE_STORE, MEDIA_STORE],
    "readwrite",
  );
  await completeTransaction<void>(transaction, (_resolve, reject) => {
    const workspaceRequest = transaction
      .objectStore(WORKSPACE_STORE)
      .put({ key: CURRENT_WORKSPACE_KEY, value } satisfies WorkspaceRecord);
    workspaceRequest.onerror = () =>
      reject(workspaceRequest.error ?? new Error("保存成长记录失败"));
    for (const id of ids) {
      const mediaRequest = transaction.objectStore(MEDIA_STORE).delete(id);
      mediaRequest.onerror = () =>
        reject(mediaRequest.error ?? new Error("删除素材失败"));
    }
  });
}

/** 纯函数：本机原片里不再被任何记录引用的 id。 */
export function orphanMediaIds(
  storedIds: Iterable<string>,
  keepIds: Iterable<string>,
): string[] {
  const keep = new Set(keepIds);
  return [...new Set(storedIds)].filter((id) => !keep.has(id));
}

/**
 * 孤儿原片回收：在同一个事务里列出 media 表的全部 key，删掉不在 keepIds 里的原片。
 * 调用方要先更新 workspace 里的引用，并把自己刚写入、还没进 workspace 的 id 一起传进来。
 * 返回删除条数；清理失败不影响主流程，由调用方决定如何处理。
 */
export async function pruneOrphanMedia(
  keepIds: Iterable<string>,
): Promise<number> {
  const keep = new Set([...keepIds].map(String));
  const database = await openDatabase();
  return new Promise<number>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(MEDIA_STORE, "readwrite");
    } catch (error) {
      reject(storageError(error));
      return;
    }
    const store = transaction.objectStore(MEDIA_STORE);
    let removed = 0;
    const request = store.getAllKeys();
    request.onsuccess = () => {
      for (const id of orphanMediaIds(request.result.map(String), keep)) {
        removed++;
        store.delete(id);
      }
    };
    request.onerror = () => reject(storageError(request.error));
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () =>
      reject(storageError(transaction.error ?? new Error("清理孤儿原片失败")));
    transaction.oncomplete = () => resolve(removed);
  });
}

export async function clearAllData(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [WORKSPACE_STORE, MEDIA_STORE],
    "readwrite",
  );
  await completeTransaction<void>(transaction, (_resolve, reject) => {
    const workspaceRequest = transaction.objectStore(WORKSPACE_STORE).clear();
    const mediaRequest = transaction.objectStore(MEDIA_STORE).clear();
    workspaceRequest.onerror = () =>
      reject(workspaceRequest.error ?? new Error("清除成长记录失败"));
    mediaRequest.onerror = () =>
      reject(mediaRequest.error ?? new Error("清除素材失败"));
  });
}
