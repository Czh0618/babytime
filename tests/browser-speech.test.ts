import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBrowserSpeech,
  getBrowserSpeechAvailability,
  type BrowserSpeechCallbacks,
  type SpeechRecognitionLike,
} from "../src/lib/browser-speech.ts";

type ResultEvent = Parameters<
  NonNullable<SpeechRecognitionLike["onresult"]>
>[0];
type ErrorEvent = Parameters<NonNullable<SpeechRecognitionLike["onerror"]>>[0];

class FakeRecognition implements SpeechRecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: ResultEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  start() {
    this.startCalls += 1;
    this.onstart?.();
  }

  stop() {
    this.stopCalls += 1;
  }

  abort() {
    this.abortCalls += 1;
    this.onend?.();
  }
}

function resultEvent(
  text: string,
  isFinal: boolean,
  resultIndex = 0,
): ResultEvent {
  return {
    resultIndex,
    results: {
      length: 1,
      0: { isFinal, 0: { transcript: text } },
    },
  } as unknown as ResultEvent;
}

function callbacks(overrides: Partial<BrowserSpeechCallbacks> = {}) {
  const texts: string[] = [];
  const states: string[] = [];
  const errors: string[] = [];
  return {
    texts,
    states,
    errors,
    handlers: {
      onText: (text: string, isFinal: boolean) =>
        texts.push(`${isFinal ? "final" : "interim"}:${text}`),
      onState: (state: "listening" | "stopped") => states.push(state),
      onError: (error: never) => errors.push(String(error)),
      ...overrides,
    } as BrowserSpeechCallbacks,
  };
}

test("配置中文连续识别并在开始时进入聆听状态", () => {
  const fake = new FakeRecognition();
  const observed = callbacks();
  const controller = createBrowserSpeech(
    observed.handlers,
    class {
      constructor() {
        return fake;
      }
    } as unknown as new () => SpeechRecognitionLike,
  );
  controller?.start();
  assert.equal(fake.lang, "zh-CN");
  assert.equal(fake.continuous, true);
  assert.equal(fake.interimResults, true);
  assert.deepEqual(observed.states, ["listening"]);
  assert.equal(fake.startCalls, 1);
});

test("临时结果和最终结果分别通知，最终结果不会把临时文字重复拼接", () => {
  const fake = new FakeRecognition();
  const observed = callbacks();
  const controller = createBrowserSpeech(
    observed.handlers,
    class {
      constructor() {
        return fake;
      }
    } as unknown as new () => SpeechRecognitionLike,
  );
  controller?.start();
  fake.onresult?.(resultEvent("你", false));
  fake.onresult?.(resultEvent("你好", true));
  assert.deepEqual(observed.texts, ["interim:你", "final:你好"]);
});

test("stop 后在 end 前仍可接收最后一个最终结果", () => {
  const fake = new FakeRecognition();
  const observed = callbacks();
  const controller = createBrowserSpeech(
    observed.handlers,
    class {
      constructor() {
        return fake;
      }
    } as unknown as new () => SpeechRecognitionLike,
  );
  controller?.start();
  controller?.stop();
  fake.onresult?.(resultEvent("刚刚喂过奶", true));
  fake.onend?.();
  assert.equal(fake.stopCalls, 1);
  assert.ok(observed.texts.includes("final:刚刚喂过奶"));
  assert.equal(observed.states.at(-1), "stopped");
});

test("网络、权限和无声错误结束当前代次，不会自动重启", async () => {
  for (const error of ["network", "not-allowed", "no-speech"] as const) {
    const fake = new FakeRecognition();
    const observed = callbacks();
    const controller = createBrowserSpeech(
      observed.handlers,
      class {
        constructor() {
          return fake;
        }
      } as unknown as new () => SpeechRecognitionLike,
    );
    controller?.start();
    fake.onerror?.({ error } as ErrorEvent);
    fake.onend?.();
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal(fake.startCalls, 1, error);
    assert.deepEqual(observed.errors, [error]);
  }
});

test("destroy 清理事件处理器，迟到的结果不再修改外部文字", () => {
  const fake = new FakeRecognition();
  const observed = callbacks();
  const controller = createBrowserSpeech(
    observed.handlers,
    class {
      constructor() {
        return fake;
      }
    } as unknown as new () => SpeechRecognitionLike,
  );
  controller?.start();
  controller?.destroy();
  fake.onresult?.(resultEvent("迟到文字", true));
  assert.equal(fake.onresult, null);
  assert.equal(fake.onend, null);
  assert.deepEqual(observed.texts, []);
});

test("取消识别后迟到的start与result不会重新进入聆听或追加文字", () => {
  const fake = new FakeRecognition();
  const observed = callbacks();
  const controller = createBrowserSpeech(
    observed.handlers,
    class {
      constructor() {
        return fake;
      }
    } as unknown as new () => SpeechRecognitionLike,
  );
  controller?.start();
  controller?.abort();
  const stateCount = observed.states.length;
  fake.onstart?.();
  fake.onresult?.(resultEvent("取消后的迟到文字", true));
  assert.equal(observed.states.length, stateCount);
  assert.deepEqual(observed.texts, []);
});

test("http 页面一律提示改用 https，不管浏览器是否保留识别接口", () => {
  const Recognition = class {} as unknown as new () => SpeechRecognitionLike;
  const availability = (
    isSecureContext: boolean,
    webkitSpeechRecognition?: new () => SpeechRecognitionLike,
  ) =>
    getBrowserSpeechAvailability({ isSecureContext, webkitSpeechRecognition });
  // iOS Safari/Chrome 在 http 下移除接口；桌面 Chrome 保留接口但会拒绝麦克风。
  assert.equal(availability(false), "needs-https");
  assert.equal(availability(false, Recognition), "needs-https");
  assert.equal(availability(true), "unsupported");
  assert.equal(availability(true, Recognition), "available");
});
