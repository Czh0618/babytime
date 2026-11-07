/**
 * 多标签页保护：同浏览器里任何一次工作区写入都会广播，其它标签页收到后重新从
 * IndexedDB 读取，避免旧标签页拿内存里的过期数据覆盖新写入。
 * 只刷新内存（读），收到广播的一方不再广播，避免消息循环。
 */

export const WORKSPACE_CHANNEL = "babytime.workspace";

export interface PeerChange {
  channel: typeof WORKSPACE_CHANNEL;
  kind: "workspace-changed";
  origin: string;
  at: number;
}

export function peerChangeMessage(origin: string, at = Date.now()): PeerChange {
  return {
    channel: WORKSPACE_CHANNEL,
    kind: "workspace-changed",
    origin,
    at,
  };
}

/** 只接受同通道、格式完整、且不是自己发出的消息。 */
export function shouldRefreshFromPeer(data: unknown, ownId: string): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const message = data as Record<string, unknown>;
  return (
    message.channel === WORKSPACE_CHANNEL &&
    message.kind === "workspace-changed" &&
    typeof message.origin === "string" &&
    message.origin.length > 0 &&
    message.origin !== ownId &&
    typeof message.at === "number" &&
    Number.isFinite(message.at)
  );
}
