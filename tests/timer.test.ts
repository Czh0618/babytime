import { test } from "node:test";
import assert from "node:assert/strict";
import {
  elapsedSeconds,
  feedingSideMinutes,
  formatClock,
  parseActiveTimer,
  parseActiveTimers,
  startTimer,
  switchTimerSide,
  timerDraft,
} from "../src/domain/timer.ts";

const at = (iso: string) => new Date(iso);

test("损坏或缺失的计时状态一律当作没有计时", () => {
  assert.equal(parseActiveTimer(null), null);
  assert.equal(parseActiveTimer(""), null);
  assert.equal(parseActiveTimer("{"), null);
  assert.equal(parseActiveTimer("[]"), null);
  assert.equal(parseActiveTimer(JSON.stringify({ kind: "nap" })), null);
  assert.equal(
    parseActiveTimer(
      JSON.stringify({
        kind: "sleep",
        startedAt: "2026-11-07T14:00",
        segmentAt: "2026-11-07T14:00",
      }),
    ),
    null,
    "旧版残留的 sleep 计时安全忽略",
  );
  assert.equal(
    parseActiveTimer(
      JSON.stringify({
        kind: "feeding",
        startedAt: "2026-11-07T14:00",
        segmentAt: "2026-11-07T14:00",
      }),
    ),
    null,
    "亲喂缺少侧别",
  );
  assert.equal(
    parseActiveTimer(
      JSON.stringify({
        kind: "feeding",
        side: "left",
        startedAt: "2026-11-07T14:00",
        segmentAt: "2026-11-07T13:00",
      }),
    ),
    null,
    "当前段早于开始时间",
  );
  assert.equal(
    parseActiveTimer(
      JSON.stringify({
        kind: "feeding",
        side: "left",
        babyId: "",
        startedAt: "2026-11-07T14:00",
        segmentAt: "2026-11-07T14:00",
      }),
    ),
    null,
    "空的 babyId 视为损坏状态",
  );
});

test("计时状态带 babyId，写入后原样恢复", () => {
  const timer = startTimer(at("2026-11-07T14:00"), "right", "baby-2");
  assert.equal(timer.kind, "feeding");
  assert.equal(timer.babyId, "baby-2");
  assert.equal(timer.side, "right");
  assert.deepEqual(parseActiveTimer(JSON.stringify(timer)), timer);
  const legacy = startTimer(at("2026-11-07T22:10"));
  assert.equal(legacy.babyId, undefined);
  assert.deepEqual(parseActiveTimer(JSON.stringify(legacy)), legacy);
});

test("多个宝宝的计时并存；旧单对象格式与旧 sleep 计时兼容", () => {
  const first = startTimer(at("2026-11-07T14:00"), "left", "b1");
  const second = startTimer(at("2026-11-07T15:00"), "right", "b2");
  const timers = parseActiveTimers(JSON.stringify([first, second]));
  assert.equal(timers.length, 2);
  assert.deepEqual(timers.map((item) => item.babyId), ["b1", "b2"]);
  assert.deepEqual(parseActiveTimers(JSON.stringify(first)), [first]);
  assert.deepEqual(
    parseActiveTimers(
      JSON.stringify([
        { kind: "sleep", startedAt: "2026-11-07T14:00", segmentAt: "2026-11-07T14:00" },
        first,
      ]),
    ),
    [first],
    "旧版睡眠计时被丢掉，不影响亲喂计时",
  );
  assert.deepEqual(
    parseActiveTimers(JSON.stringify([first, { ...first, side: "right" }])).map(
      (item) => item.side,
    ),
    ["right"],
    "同一宝宝只保留最后一条",
  );
  assert.deepEqual(parseActiveTimers(null), []);
  assert.deepEqual(parseActiveTimers("{"), []);
  const legacy = parseActiveTimers(JSON.stringify(second) + JSON.stringify(first));
  assert.deepEqual(legacy, [], "坏 JSON 不产生计时");
});

test("亲喂计时按侧累计，换边后继续计时", () => {
  const timer = startTimer(at("2026-11-07T14:00"), "left");
  assert.equal(elapsedSeconds(timer, at("2026-11-07T14:15")), 900);
  assert.deepEqual(feedingSideMinutes(timer, at("2026-11-07T14:15")), {
    left: 15,
    right: 0,
  });

  const switched = switchTimerSide(timer, "right", at("2026-11-07T14:15"));
  assert.equal(switched.side, "right");
  assert.equal(switched.segmentAt, "2026-11-07T14:15");
  assert.equal(
    elapsedSeconds(switched, at("2026-11-07T14:18")),
    180,
    "换边后只算这一段的秒数",
  );
  assert.deepEqual(feedingSideMinutes(switched, at("2026-11-07T14:18")), {
    left: 15,
    right: 3,
  });
  // 同一侧再点一次不重置计时。
  assert.equal(switchTimerSide(switched, "right", at("2026-11-07T14:20")), switched);
});

test("结束亲喂计时生成两侧分钟数，记录时间为开始那一刻", () => {
  const timer = startTimer(at("2026-11-07T14:00"), "left", "b1");
  const draft = timerDraft(timer, at("2026-11-07T14:15"));
  assert.equal(draft.kind, "feeding");
  assert.equal(draft.capturedAt, "2026-11-07T14:00");
  assert.equal(draft.feedingMethod, "breast");
  assert.equal(draft.breastSide, "left");
  assert.equal(draft.leftMinutes, 15);
  assert.equal(draft.rightMinutes, undefined);
  assert.equal(draft.needsTimeConfirmation, false);
  assert.match(draft.sourceText, /左 15 分/);

  const both = timerDraft(
    switchTimerSide(timer, "right", at("2026-11-07T14:15")),
    at("2026-11-07T14:20"),
  );
  assert.equal(both.breastSide, "both");
  assert.equal(both.leftMinutes, 15);
  assert.equal(both.rightMinutes, 5);
});

test("不足一分钟和时钟回拨都按 1 分钟记，不会生成 0", () => {
  const timer = startTimer(at("2026-11-07T14:00"), "left");
  assert.equal(timerDraft(timer, at("2026-11-07T14:00:20")).leftMinutes, 1);
  assert.equal(elapsedSeconds(timer, at("2026-11-07T13:00")), 0);
  const draft = timerDraft(timer, at("2026-11-07T13:59"));
  assert.equal(draft.leftMinutes, 1);
});

test("当前分钟的任意秒开始计时，都从 00:00 起算", () => {
  const started = at("2026-11-07T14:18:32");
  const timer = startTimer(started, "left", "b1");
  // 记录时间仍按分钟，但计时起点精确到毫秒。
  assert.equal(timer.segmentAt, "2026-11-07T14:18");
  assert.equal(elapsedSeconds(timer, started), 0);
  assert.equal(formatClock(elapsedSeconds(timer, started)), "00:00");
  assert.equal(elapsedSeconds(timer, at("2026-11-07T14:18:33")), 1);

  // 写入再读出不会跳到 32 秒，换边后同样从 0 开始。
  const restored = parseActiveTimer(JSON.stringify(timer))!;
  assert.equal(elapsedSeconds(restored, at("2026-11-07T14:19:02")), 30);
  const switched = switchTimerSide(restored, "right", at("2026-11-07T14:20:45"));
  assert.equal(elapsedSeconds(switched, at("2026-11-07T14:20:45")), 0);
  assert.equal(
    formatClock(elapsedSeconds(switched, at("2026-11-07T14:20:46"))),
    "00:01",
  );
});

test("旧计时状态仍可恢复，损坏的精确起点被忽略", () => {
  const legacy = {
    kind: "feeding",
    startedAt: "2026-11-07T14:18",
    segmentAt: "2026-11-07T14:18",
    side: "left",
  };
  const timer = parseActiveTimer(JSON.stringify(legacy))!;
  assert.equal(timer.segmentStartedMs, undefined);
  assert.equal(elapsedSeconds(timer, at("2026-11-07T14:19:00")), 60);
  const broken = parseActiveTimer(
    JSON.stringify({ ...legacy, segmentStartedMs: "oops" }),
  )!;
  assert.equal(broken.segmentStartedMs, undefined);
});

test("计时显示格式", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(75), "01:15");
  assert.equal(formatClock(3735), "1:02:15");
});
