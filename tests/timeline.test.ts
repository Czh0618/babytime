import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, COLLAPSE_THRESHOLD } from "../src/domain/timeline.ts";
import type { GrowthEntry } from "../src/types.ts";
import type { CareObservation } from "../src/domain/care-types.ts";

function entry(
  capturedAt: string,
  care?: CareObservation,
): GrowthEntry {
  return {
    id: `${capturedAt}-${care?.kind ?? "memory"}`,
    title: care ? care.kind : "一张照片",
    note: "",
    capturedAt,
    tag: care ? "喂奶" : "日常片刻",
    favorite: false,
    milestone: false,
    care,
  };
}

const feeding = (capturedAt: string, amountMl?: number): GrowthEntry =>
  entry(capturedAt, { kind: "feeding", amountMl, sourceText: "喂奶" });
const sleep = (capturedAt: string): GrowthEntry =>
  entry(capturedAt, { kind: "sleep", sleepState: "asleep", sourceText: "睡着" });
const diaper = (capturedAt: string): GrowthEntry =>
  entry(capturedAt, { kind: "diaper", diaper: "changed", sourceText: "换尿布" });

test("按天分组并按日期倒序，天内按时间倒序", () => {
  const page = buildTimeline(
    [
      feeding("2026-11-06T09:00"),
      entry("2026-11-07T10:00"),
      feeding("2026-11-07T08:00"),
    ],
    14,
  );
  assert.deepEqual(
    page.days.map((day) => day.date),
    ["2026-11-07", "2026-11-06"],
  );
  assert.deepEqual(
    page.days[0]!.entries.map((item) => item.capturedAt),
    ["2026-11-07T10:00", "2026-11-07T08:00"],
  );
});

test("同一天两条以上照护记录折叠成摘要，照片文字照常显示", () => {
  const page = buildTimeline(
    [
      feeding("2026-11-07T08:00", 120),
      sleep("2026-11-07T13:00"),
      diaper("2026-11-07T15:00"),
      entry("2026-11-07T16:00"),
    ],
    14,
  );
  const day = page.days[0]!;
  assert.equal(day.care.length, 3);
  assert.equal(day.memories.length, 1);
  assert.equal(day.memories[0]!.care, undefined);
  assert.equal(day.careSummary, "喂奶 1 次（120 ml） · 睡眠 1 条 · 尿布 1 次");
});

test("只有一条照护记录时不折叠", () => {
  const page = buildTimeline([feeding("2026-11-07T08:00"), entry("2026-11-07T09:00")], 14);
  const day = page.days[0]!;
  assert.equal(day.care.length, 0);
  assert.equal(day.memories.length, 2);
  assert.equal(day.careSummary, "");
  assert.equal(COLLAPSE_THRESHOLD, 2);
});

test("吸奶量不计入摘要里的摄入奶量", () => {
  const page = buildTimeline(
    [
      feeding("2026-11-07T08:00", 120),
      entry("2026-11-07T09:00", {
        kind: "feeding",
        feedingMethod: "pump",
        amountMl: 200,
        sourceText: "吸奶",
      }),
    ],
    14,
  );
  assert.equal(page.days[0]!.careSummary, "喂奶 2 次（120 ml）");
});

test("首屏只取最近 N 天，剩余的分批加载", () => {
  const entries = Array.from({ length: 20 }, (_, index) =>
    feeding(`2026-11-${String(20 - index).padStart(2, "0")}T09:00`),
  );
  const first = buildTimeline(entries, 14);
  assert.equal(first.days.length, 14);
  assert.equal(first.totalDays, 20);
  assert.equal(first.hasMore, true);
  assert.equal(first.days[0]!.date, "2026-11-20");
  assert.equal(first.days[13]!.date, "2026-11-07");

  const second = buildTimeline(entries, 28);
  assert.equal(second.days.length, 20);
  assert.equal(second.hasMore, false);
});

test("空列表与非法日期不会崩", () => {
  assert.deepEqual(buildTimeline([], 14), {
    days: [],
    hasMore: false,
    totalDays: 0,
  });
  const page = buildTimeline([{ ...feeding("2026-11-07T08:00"), capturedAt: "" }], 14);
  assert.equal(page.days.length, 0);
});

test("6000 条记录的分组本身不超过 100ms（渲染时间另在浏览器实测）", () => {
  const entries: GrowthEntry[] = [];
  for (let day = 0; day < 200; day++) {
    const date = new Date(2026, 0, 1 + day);
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    for (let index = 0; index < 30; index++)
      entries.push(
        feeding(`${stamp}T${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`, 90),
      );
  }
  const started = performance.now();
  const page = buildTimeline(entries, 14);
  const elapsed = performance.now() - started;
  assert.equal(page.days.length, 14);
  assert.equal(page.totalDays, 200);
  assert.ok(elapsed < 100, `分组耗时 ${elapsed.toFixed(1)}ms`);
});
