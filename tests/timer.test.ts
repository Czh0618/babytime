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

test("计时显示格式", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(75), "01:15");
  assert.equal(formatClock(3735), "1:02:15");
});
