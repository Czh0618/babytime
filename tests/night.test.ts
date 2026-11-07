import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isNightTime,
  nightWindow,
  resolveTheme,
} from "../src/domain/night.ts";
import { nightSummary } from "../src/domain/stats.ts";
import { deriveSleepSegments } from "../src/domain/sleep.ts";
import type { CareObservation } from "../src/domain/care-types.ts";
import type { GrowthEntry } from "../src/types.ts";

let seq = 0;
function sleepEntry(
  capturedAt: string,
  sleepState: "asleep" | "awake",
): GrowthEntry {
  const care: CareObservation = {
    kind: "sleep",
    sleepState,
    sourceText: sleepState,
  };
  return {
    id: `night-${++seq}`,
    title: "睡眠",
    note: "",
    capturedAt,
    tag: "睡眠",
    favorite: false,
    milestone: false,
    care,
  };
}

test("主题偏好解析：跟随系统 / 强制浅色 / 强制深色", () => {
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("夜间判断边界：21:59 / 22:00 / 05:59 / 06:00", () => {
  const at = (h: number, m: number) => new Date(2026, 10, 7, h, m);
  assert.equal(isNightTime(at(21, 59)), false);
  assert.equal(isNightTime(at(22, 0)), true);
  assert.equal(isNightTime(at(23, 30)), true);
  assert.equal(isNightTime(at(0, 0)), true);
  assert.equal(isNightTime(at(5, 59)), true);
  assert.equal(isNightTime(at(6, 0)), false);
  assert.equal(isNightTime(at(12, 0)), false);
});

test("夜间窗口是前一天 22:00 到当天 06:00", () => {
  const { start, end } = nightWindow(new Date(2026, 10, 7, 12, 0));
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 10);
  assert.equal(start.getDate(), 6);
  assert.equal(start.getHours(), 22);
  assert.equal(end.getDate(), 7);
  assert.equal(end.getHours(), 6);
});

test("昨夜醒来次数与最长连续睡眠只统计窗口内", () => {
  const entries = [
    sleepEntry("2026-11-06T21:00", "asleep"),
    sleepEntry("2026-11-07T02:00", "awake"),
    sleepEntry("2026-11-07T02:30", "asleep"),
    sleepEntry("2026-11-07T05:00", "awake"),
    sleepEntry("2026-11-07T08:00", "awake"), // 窗口外
  ];
  const summary = nightSummary(
    entries,
    deriveSleepSegments(entries),
    new Date(2026, 10, 7, 12, 0),
  );
  assert.equal(summary.wakeCount, 2);
  assert.equal(summary.longestSleepMinutes, 240); // 22:00→02:00
});

// WCAG 2.1 相对亮度与对比度，用于验证深浅两套主题的主要文字色。
function luminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/../g)!
    .map((part) => parseInt(part, 16) / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const LIGHT: Array<[string, string, string]> = [
  ["正文", "#302d28", "#faf7f2"],
  ["次要文字", "#756d62", "#faf7f2"],
  ["卡片正文", "#302d28", "#fffdf9"],
  ["提示文字", "#456249", "#e9eee6"],
  ["主按钮文字", "#fffdf9", "#73543c"],
  ["危险文字", "#a14d3b", "#faf7f2"],
  ["错误提示块", "#8d3f31", "#f7e5df"],
];
const DARK: Array<[string, string, string]> = [
  ["正文", "#f2ece3", "#1c1916"],
  ["次要文字", "#b8ac9c", "#1c1916"],
  ["卡片正文", "#f2ece3", "#26221e"],
  ["提示文字", "#bcd7c0", "#27352a"],
  ["主按钮文字", "#241d16", "#d8b38c"],
  ["危险文字", "#e08b78", "#1c1916"],
  ["错误提示块", "#f0b3a5", "#3a2420"],
  ["玫瑰色素材", "#d9b3a8", "#382a27"],
];

test("浅色与深色主题下主要文字对比度都 ≥ 4.5:1", () => {
  for (const [label, foreground, background] of [...LIGHT, ...DARK]) {
    const ratio = contrast(foreground, background);
    assert.ok(ratio >= 4.5, `${label} ${foreground}/${background} = ${ratio.toFixed(2)}`);
  }
});
