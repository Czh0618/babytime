import { test } from "node:test";
import assert from "node:assert/strict";
import {
  peerChangeMessage,
  shouldRefreshFromPeer,
  WORKSPACE_CHANNEL,
} from "../src/lib/peer-refresh.ts";

test("广播消息结构完整；只接受同通道、别人发的消息", () => {
  const message = peerChangeMessage("tab-A", 1_700_000_000_000);
  assert.deepEqual(message, {
    channel: WORKSPACE_CHANNEL,
    kind: "workspace-changed",
    origin: "tab-A",
    at: 1_700_000_000_000,
  });
  assert.equal(shouldRefreshFromPeer(message, "tab-A"), false, "自己发的消息不刷新");
  assert.equal(shouldRefreshFromPeer(message, "tab-B"), true);
  assert.equal(
    shouldRefreshFromPeer({ ...message, channel: "other" }, "tab-B"),
    false,
  );
  assert.equal(
    shouldRefreshFromPeer({ ...message, kind: "something-else" }, "tab-B"),
    false,
  );
  assert.equal(
    shouldRefreshFromPeer({ ...message, origin: "" }, "tab-B"),
    false,
  );
  assert.equal(
    shouldRefreshFromPeer({ ...message, at: Number.NaN }, "tab-B"),
    false,
  );
  for (const bad of [null, undefined, "text", 42, [], { origin: "tab-A" }])
    assert.equal(shouldRefreshFromPeer(bad, "tab-B"), false);
});

/** 两个标签页模拟：写入方广播，接收方刷新一次且不会回播，避免消息循环。 */
test("同浏览器两个标签页：写入方广播，接收方只刷新一次", async () => {
  const channels: Array<{
    name: string;
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage(data: unknown): void;
  }> = [];
  function tab(name: string) {
    const channel = {
      name,
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage(data: unknown) {
        for (const other of channels)
          if (other !== channel && other.name === name)
            queueMicrotask(() => other.onmessage?.({ data }));
      },
    };
    channels.push(channel);
    return channel;
  }
  const a = tab(WORKSPACE_CHANNEL);
  const b = tab(WORKSPACE_CHANNEL);
  let refreshed = 0;
  let broadcasts = 0;
  b.onmessage = ({ data }) => {
    if (!shouldRefreshFromPeer(data, "tab-B")) return;
    refreshed++;
    // 刷新只读内存，不回播。
  };
  a.onmessage = () => {
    broadcasts++;
  };
  a.postMessage(peerChangeMessage("tab-A", 1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(refreshed, 1);
  assert.equal(broadcasts, 0, "接收方不会把刷新再广播出去");
  assert.equal(a.onmessage === null, false);
});
