import { test } from "node:test";
import assert from "node:assert/strict";
import {
  elapsedSeconds,
  feedingSideMinutes,
  formatClock,
  parseActiveTimer,
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
        kind: "sleep",
        startedAt: "2026-11-07T14:00",
        segmentAt: "2026-11-07T13:00",
      }),
    ),
    null,
    "当前段早于开始时间",
  );
});

test("计时状态可以写入后原样恢复", () => {
  const timer = startTimer("feeding", at("2026-11-07T14:00"), "right");
  assert.deepEqual(parseActiveTimer(JSON.stringify(timer)), timer);
  const sleep = startTimer("sleep", at("2026-11-07T22:10"));
  assert.equal(sleep.side, undefined);
  assert.deepEqual(parseActiveTimer(JSON.stringify(sleep)), sleep);
});

test("亲喂计时按侧累计，换边后继续计时", () => {
  const timer = startTimer("feeding", at("2026-11-07T14:00"), "left");
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

test("睡眠计时按总时长计算，含中途刷新页面", () => {
  const timer = startTimer("sleep", at("2026-11-07T13:00"));
  assert.equal(elapsedSeconds(timer, at("2026-11-07T14:30")), 5400);
  const restored = parseActiveTimer(JSON.stringify(timer))!;
  assert.equal(elapsedSeconds(restored, at("2026-11-07T14:30")), 5400);
});

test("结束睡眠计时生成带时长的草稿，记录时间为睡着那一刻", () => {
  const timer = startTimer("sleep", at("2026-11-07T13:00"));
  const draft = timerDraft(timer, at("2026-11-07T14:30"));
  assert.equal(draft.kind, "sleep");
  assert.equal(draft.capturedAt, "2026-11-07T13:00");
  assert.equal(draft.durationMinutes, 90);
  assert.equal(draft.sleepState, "duration");
  assert.equal(draft.needsTimeConfirmation, false);
  assert.match(draft.sourceText, /1 小时 30 分/);
});

test("结束亲喂计时生成两侧分钟数，够一分钟才计入", () => {
  const timer = startTimer("feeding", at("2026-11-07T14:00"), "left");
  const draft = timerDraft(timer, at("2026-11-07T14:15"));
  assert.equal(draft.kind, "feeding");
  assert.equal(draft.feedingMethod, "breast");
  assert.equal(draft.breastSide, "left");
  assert.equal(draft.leftMinutes, 15);
  assert.equal(draft.rightMinutes, undefined);
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
  const timer = startTimer("sleep", at("2026-11-07T13:00"));
  assert.equal(timerDraft(timer, at("2026-11-07T13:00:20")).durationMinutes, 1);
  assert.equal(elapsedSeconds(timer, at("2026-11-07T12:00")), 0);
  const feeding = startTimer("feeding", at("2026-11-07T14:00"));
  const draft = timerDraft(feeding, at("2026-11-07T13:59"));
  assert.equal(draft.leftMinutes, 1);
});

test("计时显示格式", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(75), "01:15");
  assert.equal(formatClock(3735), "1:02:15");
});
