import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  AIServiceError,
  aiAvailable,
  aiChat,
  aiStatus,
  clearAIConfig,
  describeAIConfig,
  readAIConfig,
  refreshAIStatus,
  saveAIConfig,
  setAIEnabled,
} from "../src/lib/ai-service.ts";

const KEY = "babytime.aiService";
const config = {
  baseUrl: "https://models.example.com/v1",
  apiKey: "sk-test-secret",
  model: "example-chat",
  enabled: true,
};

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
const originalFetch = globalThis.fetch;

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memory,
  });
  memory.clear();
  refreshAIStatus();
});

afterEach(() => {
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
  globalThis.fetch = originalFetch;
});

test("服务地址校验：协议、账号密码、密钥与模型都不能为空", () => {
  assert.equal(describeAIConfig(config), null);
  assert.match(describeAIConfig({ ...config, baseUrl: "" }) ?? "", /地址/);
  assert.match(describeAIConfig({ ...config, baseUrl: "not-a-url" }) ?? "", /网址/);
  assert.match(describeAIConfig({ ...config, baseUrl: "ftp://x/v1" }) ?? "", /http/);
  assert.match(
    describeAIConfig({ ...config, baseUrl: "https://user:pass@x/v1" }) ?? "",
    /账号/,
  );
  assert.match(describeAIConfig({ ...config, apiKey: "" }) ?? "", /密钥/);
  assert.match(describeAIConfig({ ...config, model: "  " }) ?? "", /模型/);
});

test("保存时归一化地址，配置与状态都不把密钥暴露给界面", () => {
  saveAIConfig({
    ...config,
    baseUrl: "https://models.example.com/v1/chat/completions/",
  });
  const stored = readAIConfig();
  assert.equal(stored?.baseUrl, "https://models.example.com/v1");
  assert.equal(stored?.enabled, true);
  assert.equal(aiStatus.value.model, "example-chat");
  assert.equal(aiAvailable(), true);
  assert.equal("apiKey" in aiStatus.value, false);
  assert.equal(JSON.stringify(aiStatus.value).includes("sk-test-secret"), false);
});

test("暂停与清除配置都会即时反映到可用状态，清除后本机不再留密钥", () => {
  saveAIConfig(config);
  setAIEnabled(false);
  assert.equal(aiAvailable(), false);
  assert.equal(aiStatus.value.configured, true);
  setAIEnabled(true);
  assert.equal(aiAvailable(), true);
  clearAIConfig();
  assert.equal(memory.getItem(KEY), null);
  assert.equal(aiStatus.value.configured, false);
  assert.equal(aiAvailable(), false);
});

test("损坏的本机配置不会让应用崩溃，按未配置处理", () => {
  memory.setItem(KEY, "{broken");
  assert.equal(readAIConfig(), null);
  memory.setItem(KEY, JSON.stringify({ baseUrl: "https://x/v1" }));
  assert.equal(readAIConfig(), null);
});

test("未配置或已暂停时直接拒绝调用，不发起网络请求", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}");
  };
  await assert.rejects(
    () => aiChat("system", "user"),
    (error: unknown) =>
      error instanceof AIServiceError && error.code === "not-configured",
  );
  saveAIConfig({ ...config, enabled: false });
  await assert.rejects(
    () => aiChat("system", "user"),
    (error: unknown) => error instanceof AIServiceError && error.code === "disabled",
  );
  assert.equal(called, false);
});

test("请求带 system 首条消息、密钥只进请求头，返回正文被取出", async () => {
  saveAIConfig(config);
  let captured: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init: init ?? {} };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] }),
      { status: 200 },
    );
  };
  const content = await aiChat("你是整理助手", "原话内容");
  assert.equal(content, '{"items":[]}');
  assert.equal(captured?.url, "https://models.example.com/v1/chat/completions");
  const headers = captured?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sk-test-secret");
  const body = JSON.parse(String(captured?.init.body)) as {
    messages: Array<{ role: string; content: string }>;
    stream: boolean;
    model: string;
  };
  assert.equal(body.messages[0]?.role, "system");
  assert.equal(body.messages[0]?.content, "你是整理助手");
  assert.equal(body.messages[1]?.content, "原话内容");
  assert.equal(body.stream, false);
  assert.equal(body.model, "example-chat");
  assert.equal(String(captured?.init.body).includes("sk-test-secret"), false);
});

test("401/429/5xx 与空内容映射成可读错误，不外泄响应体", async () => {
  saveAIConfig(config);
  const cases: Array<[number, string]> = [
    [401, "auth"],
    [429, "rate-limit"],
    [503, "server"],
  ];
  for (const [status, code] of cases) {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "internal detail" }), { status });
    await assert.rejects(
      () => aiChat("s", "u"),
      (error: unknown) => error instanceof AIServiceError && error.code === code,
    );
  }
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
      status: 200,
    });
  await assert.rejects(
    () => aiChat("s", "u"),
    (error: unknown) => error instanceof AIServiceError && error.code === "bad-response",
  );
});
