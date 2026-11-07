import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVisitSummary } from "../src/domain/summary.ts";
import { buildEntriesCsv } from "../src/lib/csv.ts";
import { defaultVaccinePlan } from "../src/domain/vaccines.ts";
import type { BabyProfile, GrowthEntry } from "../src/types.ts";
import type { CareObservation } from "../src/domain/care-types.ts";

const now = new Date(2026, 10, 7, 12, 0);
const baby: BabyProfile = { name: "小满", birthDate: "2026-01-31" };

function entry(capturedAt: string, care: CareObservation): GrowthEntry {
  return {
    id: `${capturedAt}-${care.kind}-${care.sourceText}`,
    title: "记录",
    note: "",
    capturedAt,
    tag: "记录",
    favorite: false,
    milestone: false,
    care,
  };
}

test("就诊摘要只统计最近 7 天，睡眠按段合计", () => {
  const entries = [
    entry("2026-11-04T20:00", { kind: "sleep", sleepState: "asleep", sourceText: "睡" }),
    entry("2026-11-04T22:00", { kind: "sleep", sleepState: "awake", sourceText: "醒" }),
    entry("2026-11-06T08:00", {
      kind: "feeding",
      amountMl: 120,
      sourceText: "喂奶",
    }),
    entry("2026-11-06T09:00", {
      kind: "feeding",
      feedingMethod: "pump",
      amountMl: 150,
      sourceText: "吸奶",
    }),
    entry("2026-11-06T10:00", {
      kind: "diaper",
      diaper: "mixed",
      sourceText: "换尿布",
    }),
    // 7 天窗口之外（窗口从 11-01 开始），不应计入
    entry("2026-10-20T10:00", {
      kind: "feeding",
      amountMl: 999,
      sourceText: "很久以前",
    }),
  ];
  const summary = buildVisitSummary(
    entries,
    baby,
    [],
    defaultVaccinePlan(),
    now,
    7,
  );
  assert.equal(summary.from, "2026-11-01");
  assert.equal(summary.to, "2026-11-07");
  assert.equal(summary.feedingCount, 2);
  assert.equal(summary.intakeMl, 120);
  assert.equal(summary.pumpedMl, 150);
  assert.equal(summary.sleepMinutes, 120);
  assert.equal(summary.diaperCount, 1);
  assert.equal(summary.wetCount, 1);
  assert.equal(summary.dirtyCount, 1);
  assert.equal(summary.entryCount, 5);
});

test("体温与用药按时间排序，疫苗给出待办", () => {
  const entries = [
    entry("2026-11-07T09:00", {
      kind: "temperature",
      temperatureC: 38.5,
      site: "ear",
      sourceText: "耳温",
    }),
    entry("2026-11-05T09:00", {
      kind: "temperature",
      temperatureC: 37.6,
      sourceText: "额温",
    }),
    entry("2026-11-06T10:00", {
      kind: "medicine",
      medicineName: "美林",
      dose: "2.5ml",
      sourceText: "喂了美林",
    }),
  ];
  const summary = buildVisitSummary(
    entries,
    baby,
    [],
    defaultVaccinePlan(),
    now,
    7,
  );
  assert.deepEqual(
    summary.temperature.map((item) => item.value),
    [37.6, 38.5],
  );
  assert.equal(summary.temperature[1]!.text, "体温 38.5℃（耳温）");
  assert.equal(summary.medicines.length, 1);
  assert.equal(summary.medicines[0]!.text, "美林 2.5ml");
  assert.ok(summary.vaccines.overdue > 0, "出生后应种未种的剂次算过期");
  assert.ok(summary.vaccines.upcoming.length <= 8);
});

test("CSV 带 BOM、转义引号，并按时间正序", () => {
  const entries = [
    entry("2026-11-06T08:00", {
      kind: "feeding",
      amountMl: 90,
      sourceText: "喂奶",
    }),
    {
      ...entry("2026-11-05T07:00", { kind: "note", sourceText: "备注" }),
      title: '他说"再睡会儿"',
      note: "逗号,和引号\"",
    },
  ];
  const csv = buildEntriesCsv(entries);
  assert.ok(csv.startsWith("\uFEFF"), "带 UTF-8 BOM");
  assert.ok(csv.includes('"日期","时间","类型","标题","照护内容","标签","备注","里程碑"'));
  assert.ok(csv.includes('"他说""再睡会儿"""'), "引号被转义");
  const lines = csv.split("\r\n").filter(Boolean);
  assert.equal(lines.length, 3);
  assert.ok(lines[1]!.startsWith('"2026-11-05"'), "按时间正序");
  assert.ok(lines[2]!.includes('"喂奶"'));
});
