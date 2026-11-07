import { ref } from "vue";
import type { Transport } from "../domain/sync";

/**
 * 家庭同步的本机配置与网络通道（docs/SYNC.md 第 7 节）。
 * 密钥与同步进度只存 localStorage，不进 workspace，因此不会出现在备份 JSON 里。
 * 服务固定在同源的 /sync/，只在 https 页面可用，密钥不会明文上网。
 */

const CONFIG_KEY = "babytime.sync";
const SINCE_KEY = "babytime.syncSince";
const TIMEOUT_MS = 20_000;

export interface SyncConfig {
  key: string;
  enabled: boolean;
}

export interface SyncState {
  configured: boolean;
  enabled: boolean;
  running: boolean;
  /** 上次成功同步的本机时间（ISO），用于界面展示。 */
  lastAt: string;
  error: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSyncConfig(): SyncConfig | null {
  try {
    const parsed = JSON.parse(storage()?.getItem(CONFIG_KEY) ?? "null") as Partial<SyncConfig> | null;
    if (!parsed || typeof parsed.key !== "string" || !parsed.key) return null;
    return { key: parsed.key, enabled: parsed.enabled !== false };
  } catch {
    return null;
  }
}

export const syncState = ref<SyncState>({
  configured: false,
  enabled: false,
  running: false,
  lastAt: "",
  error: "",
});

export function refreshSyncState() {
  const config = readSyncConfig();
  syncState.value.configured = Boolean(config);
  syncState.value.enabled = Boolean(config?.enabled);
}

export function saveSyncConfig(config: SyncConfig) {
  const key = config.key.trim();
  if (key.length < 32) throw new Error("家庭密钥至少 32 个字符，请从部署输出里完整复制。");
  const previous = readSyncConfig();
  storage()?.setItem(CONFIG_KEY, JSON.stringify({ key, enabled: config.enabled }));
  // 换了密钥（可能是另一台服务器）就从头全量同步。
  if (previous?.key !== key) resetSince();
  refreshSyncState();
}

export function clearSyncConfig() {
  storage()?.removeItem(CONFIG_KEY);
  resetSince();
  syncState.value.error = "";
  refreshSyncState();
}

/** 上次同步的服务端时间；null 表示首次或恢复备份后，需要全量同步。 */
export function readSince(): number | null {
  const value = Number(storage()?.getItem(SINCE_KEY) ?? NaN);
  return Number.isFinite(value) ? value : null;
}

export function writeSince(value: number) {
  storage()?.setItem(SINCE_KEY, String(value));
}

export function resetSince() {
  storage()?.removeItem(SINCE_KEY);
}

export function syncUnavailableReason(): string | null {
  // localhost 也算安全上下文，便于本机开发；部署后的 http 地址会被拦下。
  if (typeof window === "undefined" || !window.isSecureContext)
    return "多设备同步只能在 https 地址下使用，避免家庭密钥明文上网。";
  return null;
}

/** 同源 /sync/ 通道；错误统一转成可以直接给家长看的中文。 */
export function createTransport(key: string): Transport {
  return async (path, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new Error("连不上同步服务，请检查网络；本机记录不受影响，稍后会自动重试。");
    } finally {
      clearTimeout(timer);
    }
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (response.status === 401) throw new Error("家庭密钥不正确，请在同步设置里重新填写。");
    if (response.status === 404 || response.status === 405 || (!data && response.ok))
      throw new Error("这台服务器还没有开启同步服务。");
    if (!response.ok || !data) throw new Error(data?.error ?? `同步服务出错（${response.status}）。`);
    return data;
  };
}
