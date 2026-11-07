import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveSleepSegments,
  formatMinutes,
  ongoingSleep,
  sleepSummaryForDay,
  splitSegmentByDay,
  type SleepSegment,
} from "../src/domain/sleep.ts";
import type { GrowthEntry } from "../src/types.ts";
import type { CareObservation } from "../src/domain/care-types.ts";

function entry(
  capturedAt: string,
  care: CareObservation,
  id = capturedAt,
): GrowthEntry {
  return {
    id,
    title: "睡眠",
    note: "",
    capturedAt,
    tag: "睡眠",
    favorite: false,
    milestone: false,
    care,
  };
}

const asleep = (source = "睡着了"): CareObservation => ({
  kind: "sleep",
  sleepState: "asleep",
  sourceText: source,
});
const awake = (source = "醒来了"): CareObservation => ({
  kind: "sleep",
  sleepState: "awake",
  sourceText: source,
});

test("睡着与醒来配对成一段", () => {
  const segments = deriveSleepSegments(
    [
      entry("2026-11-06T22:00", awake(), "w"),
      entry("2026-11-06T20:00", asleep(), "s"),
    ], // 故意乱序
  );
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.start, "2026-11-06T20:00");
  assert.equal(segments[0]!.end, "2026-11-06T22:00");
  assert.equal(segments[0]!.minutes, 120);
  assert.equal(segments[0]!.source, "paired");
});

test("只有睡着没有醒来算进行中，不参与统计", () => {
  const segments = deriveSleepSegments([entry("2026-11-06T23:00", asleep())]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.ongoing, true);
  assert.equal(segments[0]!.end, null);
  assert.deepEqual(splitSegmentByDay(segments[0]!), []);
  assert.deepEqual(sleepSummaryForDay(segments, "2026-11-06"), {
    totalMinutes: 0,
    longestMinutes: 0,
    segmentCount: 0,
  });
});

test("连续两条睡着只取后一条", () => {
  const segments = deriveSleepSegments([
    entry("2026-11-06T20:00", asleep(), "a"),
    entry("2026-11-06T21:00", asleep(), "b"),
    entry("2026-11-06T23:00", awake(), "c"),
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.start, "2026-11-06T21:00");
  assert.equal(segments[0]!.minutes, 120);
});

test("带 durationMinutes 的记录直接成段", () => {
  const segments = deriveSleepSegments([
    entry("2026-11-06T13:00", {
      kind: "sleep",
      sleepState: "duration",
      durationMinutes: 90,
      sourceText: "睡了90分钟",
    }),
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.minutes, 90);
  assert.equal(segments[0]!.end, "2026-11-06T14:30");
  assert.equal(segments[0]!.source, "duration");
});

test("跨午夜按自然日切分统计", () => {
  const segment: SleepSegment = {
    start: "2026-11-06T22:30",
    end: "2026-11-07T06:30",
    minutes: 480,
    ongoing: false,
    source: "paired",
  };
  assert.deepEqual(splitSegmentByDay(segment), [
    { date: "2026-11-06", minutes: 90 },
    { date: "2026-11-07", minutes: 390 },
  ]);
  assert.deepEqual(sleepSummaryForDay([segment], "2026-11-06"), {
    totalMinutes: 90,
    longestMinutes: 90,
    segmentCount: 1,
  });
  assert.deepEqual(sleepSummaryForDay([segment], "2026-11-07"), {
    totalMinutes: 390,
    longestMinutes: 390,
    segmentCount: 1,
  });
});

test("空日与多段合计、最长一段", () => {
  const segments: SleepSegment[] = [
    {
      start: "2026-11-06T09:00",
      end: "2026-11-06T10:00",
      minutes: 60,
      ongoing: false,
      source: "paired",
    },
    {
      start: "2026-11-06T13:00",
      end: "2026-11-06T15:00",
      minutes: 120,
      ongoing: false,
      source: "paired",
    },
  ];
  assert.deepEqual(sleepSummaryForDay(segments, "2026-11-06"), {
    totalMinutes: 180,
    longestMinutes: 120,
    segmentCount: 2,
  });
  assert.deepEqual(sleepSummaryForDay([], "2026-11-05"), {
    totalMinutes: 0,
    longestMinutes: 0,
    segmentCount: 0,
  });
});

test("时长文案", () => {
  assert.equal(formatMinutes(45), "45 分钟");
  assert.equal(formatMinutes(120), "2 小时");
  assert.equal(formatMinutes(135), "2 小时 15 分");
});

test("进行中的睡眠：最近一条是「睡着」、不晚于现在、且在 24 小时内", () => {
  const now = new Date("2026-11-07T15:00:00");
  const start = entry("2026-11-07T13:00", asleep());
  assert.equal(ongoingSleep([start], now)?.id, start.id);
  assert.equal(
    ongoingSleep([start, entry("2026-11-07T14:00", awake())], now),
    undefined,
    "已经醒来",
  );
  assert.equal(
    ongoingSleep(
      [entry("2026-11-07T13:00", { ...asleep(), sleepState: "duration", durationMinutes: 60 })],
      now,
    ),
    undefined,
    "已经补成一段睡眠",
  );
  assert.equal(
    ongoingSleep([entry("2026-11-06T14:59", asleep())], now),
    undefined,
    "超过 24 小时没点醒来，当作忘了点",
  );
  assert.equal(
    ongoingSleep([start, entry("2026-11-07T16:00", awake())], now)?.id,
    start.id,
    "晚于现在的记录不参与判断",
  );
});
