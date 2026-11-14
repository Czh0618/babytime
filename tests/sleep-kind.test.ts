import { test } from "node:test";
import assert from "node:assert/strict";
import type { CareObservation, SleepKind } from "../src/domain/care-types.ts";
import type { GrowthEntry } from "../src/types.ts";
import { emptyWorkspace } from "../src/domain/seed.ts";
import { parseBackup } from "../src/domain/workspace-schema.ts";
import {
  deriveSleepSegments,
  inferSleepKind,
  sleepBreakdownForDay,
} from "../src/domain/sleep.ts";

function entry(id: string, capturedAt: string, care: CareObservation): GrowthEntry {
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

const sleep = (extra: Partial<CareObservation> = {}): CareObservation => ({
  kind: "sleep",
  sleepState: "asleep",
  sourceText: "睡着了",
  ...extra,
});

test("按入睡时刻推断类型：19:00 至次日 06:00 记夜睡", () => {
  assert.equal(inferSleepKind("2026-11-06T18:59"), "nap");
  assert.equal(inferSleepKind("2026-11-06T19:00"), "night");
  assert.equal(inferSleepKind("2026-11-06T23:30"), "night");
  assert.equal(inferSleepKind("2026-11-07T00:10"), "night");
  assert.equal(inferSleepKind("2026-11-07T05:59"), "night");
  assert.equal(inferSleepKind("2026-11-07T06:00"), "nap");
  assert.equal(inferSleepKind("2026-11-07T13:20"), "nap");
});

test("家长手动选过类型时优先，自动推断只兜底", () => {
  const segments = deriveSleepSegments([
    entry("a", "2026-11-06T13:00", sleep({ sleepKind: "catch-up" })),
    entry("b", "2026-11-06T14:00", {
      kind: "sleep",
      sleepState: "awake",
      sourceText: "醒来了",
    }),
    entry("c", "2026-11-06T21:00", sleep()),
    entry("d", "2026-11-06T22:30", {
      kind: "sleep",
      sleepState: "awake",
      sourceText: "醒来了",
    }),
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[0]!.kind, "catch-up");
  assert.equal(segments[1]!.kind, "night");
});

test("带时长的记录也带类型，进行中的段同样有类型", () => {
  const segments = deriveSleepSegments([
    entry("a", "2026-11-06T10:00", sleep({ durationMinutes: 45 })),
    entry("b", "2026-11-06T20:00", sleep()),
  ]);
  assert.equal(segments[0]!.kind, "nap");
  assert.equal(segments[1]!.kind, "night");
  assert.equal(segments[1]!.ongoing, true);
});

test("按天分类汇总：小睡计次，夜睡与补觉按时长", () => {
  const segments = deriveSleepSegments([
    entry("a", "2026-11-06T10:00", sleep({ durationMinutes: 40 })),
    entry("b", "2026-11-06T14:00", sleep({ sleepKind: "catch-up", durationMinutes: 60 })),
    entry("c", "2026-11-06T19:30", sleep()),
    // 跨午夜到 11-07 06:30：落在 11-06 的是 19:30–24:00 共 4.5 小时。
    entry("d", "2026-11-07T06:30", {
      kind: "sleep",
      sleepState: "awake",
      sourceText: "醒来了",
    }),
  ]);
  const day = sleepBreakdownForDay(segments, "2026-11-06");
  assert.equal(day.napCount, 1);
  assert.equal(day.napMinutes, 40);
  assert.equal(day.catchUpMinutes, 60);
  assert.equal(day.nightMinutes, 270);

  const next = sleepBreakdownForDay(segments, "2026-11-07");
  assert.equal(next.nightMinutes, 390);
  assert.equal(next.napCount, 0);
});

test("睡眠类型随备份往返，非法值被拒", () => {
  const workspace = emptyWorkspace();
  const care = { kind: "sleep" as const, sleepKind: "catch-up" as const, sourceText: "补觉" };
  workspace.entries = [
    {
      id: "e1",
      title: "睡眠",
      note: "",
      capturedAt: "2026-11-06T13:00",
      tag: "睡眠",
      favorite: false,
      milestone: false,
      care,
      mediaIds: [],
      updatedAt: "2026-11-06T13:00:00Z",
      deviceId: "dev-a",
    },
  ];
  const restored = parseBackup(JSON.stringify(workspace));
  assert.equal(restored.entries[0]!.care?.sleepKind, "catch-up");

  const bad = emptyWorkspace();
  bad.entries = [
    { ...workspace.entries[0]!, care: { ...care, sleepKind: "deep" as unknown as SleepKind } },
  ];
  assert.throws(() => parseBackup(JSON.stringify(bad)), /字段缺失、类型错误/);
});
