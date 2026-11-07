import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateByDay,
  dateRange,
  metricValue,
} from "../src/domain/stats.ts";
import type { CareObservation } from "../src/domain/care-types.ts";
import type { GrowthEntry } from "../src/types.ts";

const TODAY = "2026-11-07";
let seq = 0;

function entry(capturedAt: string, care: CareObservation): GrowthEntry {
  return {
    id: `entry-${++seq}`,
    title: "照护记录",
    note: "",
    capturedAt,
    tag: "喂奶",
    favorite: false,
    milestone: false,
    care,
  };
}

test("日期区间按自然日升序，末位是今天", () => {
  const week = dateRange(7, TODAY);
  assert.equal(week.length, 7);
  assert.equal(week[6], TODAY);
  assert.equal(week[5], "2026-11-06");
  const month = dateRange(30, TODAY);
  assert.equal(month.length, 30);
  assert.equal(month[0], "2026-10-09");
  assert.equal(month[29], TODAY);
});

test("按天聚合喂奶、吸出、尿布与睡眠，空日留空", () => {
  const entries = [
    entry("2026-11-07T08:00", {
      kind: "feeding",
      amountMl: 90,
      sourceText: "喂奶",
    }),
    entry("2026-11-07T12:00", {
      kind: "feeding",
      amountMl: 60,
      feedingMethod: "bottle-formula",
      sourceText: "配方奶",
    }),
    entry("2026-11-07T12:30", {
      kind: "feeding",
      amountMl: 120,
      feedingMethod: "pump",
      sourceText: "吸奶",
    }),
    entry("2026-11-07T09:00", {
      kind: "diaper",
      diaper: "wet",
      sourceText: "尿湿",
    }),
    entry("2026-11-07T15:00", {
      kind: "diaper",
      diaper: "mixed",
      sourceText: "都有",
    }),
    entry("2026-11-06T22:30", {
      kind: "sleep",
      sleepState: "asleep",
      sourceText: "睡着了",
    }),
    entry("2026-11-07T06:30", {
      kind: "sleep",
      sleepState: "awake",
      sourceText: "醒来了",
    }),
  ];
  const days = aggregateByDay(entries, 7, TODAY);
  const today = days[6]!;
  assert.equal(today.feedingCount, 3);
  assert.equal(today.intakeMl, 150);
  assert.equal(today.pumpedMl, 120);
  assert.equal(today.diaperCount, 2);
  assert.equal(today.wetCount, 2);
  assert.equal(today.dirtyCount, 1);
  assert.equal(today.sleepMinutes, 390);
  assert.equal(today.hasData, true);

  const yesterday = days[5]!;
  assert.equal(yesterday.sleepMinutes, 90);
  assert.equal(yesterday.feedingCount, 0);
  assert.equal(yesterday.hasData, true);

  const empty = days[0]!;
  assert.equal(empty.hasData, false);
  assert.equal(empty.intakeMl, 0);
});

test("跨午夜睡眠在两天都计入，范围外的记录被忽略", () => {
  const entries = [
    entry("2026-11-05T22:00", {
      kind: "sleep",
      sleepState: "asleep",
      sourceText: "睡着了",
    }),
    entry("2026-11-06T06:00", {
      kind: "sleep",
      sleepState: "awake",
      sourceText: "醒来了",
    }),
    entry("2026-10-01T08:00", {
      kind: "feeding",
      amountMl: 999,
      sourceText: "很久以前",
    }),
  ];
  const days = aggregateByDay(entries, 7, TODAY);
  assert.equal(days[4]!.sleepMinutes, 120); // 11-05 22:00–24:00
  assert.equal(days[5]!.sleepMinutes, 360); // 11-06 00:00–06:00
  assert.equal(days[3]!.sleepMinutes, 0); // 11-04 无睡眠
  assert.ok(days.every((day) => day.intakeMl === 0));
});

test("指标取值：睡眠换算成小时", () => {
  const [day] = aggregateByDay(
    [
      entry("2026-11-07T01:00", {
        kind: "sleep",
        sleepState: "asleep",
        sourceText: "睡",
      }),
      entry("2026-11-07T03:30", {
        kind: "sleep",
        sleepState: "awake",
        sourceText: "醒",
      }),
      entry("2026-11-07T09:00", {
        kind: "diaper",
        diaper: "dirty",
        sourceText: "便便",
      }),
    ],
    1,
    TODAY,
  );
  assert.equal(metricValue(day!, "sleep"), 2.5);
  assert.equal(metricValue(day!, "diaper"), 1);
  assert.equal(metricValue(day!, "intake"), 0);
});
