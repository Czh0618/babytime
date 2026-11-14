import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SLEEP_REFERENCES,
  SLEEP_REFERENCE_BAND_HINT,
  SLEEP_REFERENCE_DISCLAIMER,
  SLEEP_REFERENCE_SOURCE,
  sleepReferenceFor,
  sleepReferenceText,
} from "../src/data/sleep-reference.ts";

test("P8.3.1 四档来自 WS/T 579—2017 附录 A，含出处与实施日期", () => {
  assert.equal(SLEEP_REFERENCES.length, 4);
  assert.deepEqual(
    SLEEP_REFERENCES.map((item) => [
      item.minMonths,
      item.maxMonths,
      item.minHours,
      item.maxHours,
    ]),
    [
      [0, 3, 13, 18],
      [4, 11, 12, 16],
      [12, 35, 11, 14],
      [36, 71, 10, 13],
    ],
  );
  assert.match(SLEEP_REFERENCE_SOURCE, /WS\/T 579—2017/);
  assert.match(SLEEP_REFERENCE_SOURCE, /2018-04-01/);
});

test("P8.3.1 按完整月龄取档，边界与 72 月龄起的空值", () => {
  assert.equal(sleepReferenceFor(0)!.id, "0-3");
  assert.equal(sleepReferenceFor(3)!.id, "0-3");
  assert.equal(sleepReferenceFor(4)!.id, "4-11");
  assert.equal(sleepReferenceFor(11)!.id, "4-11");
  assert.equal(sleepReferenceFor(12)!.id, "12-35");
  assert.equal(sleepReferenceFor(35)!.id, "12-35");
  assert.equal(sleepReferenceFor(36)!.id, "36-71");
  assert.equal(sleepReferenceFor(71)!.id, "36-71");
  assert.equal(sleepReferenceFor(71.9)!.id, "36-71", "按完整月龄而不是四舍五入");
  assert.equal(sleepReferenceFor(72), null);
  assert.equal(sleepReferenceFor(120), null);
  assert.equal(sleepReferenceFor(-1), null);
  assert.equal(sleepReferenceFor(Number.NaN), null);
});

test("P8.3.2 睡眠对照文案只描述范围，不写不足/过多/异常/建议", () => {
  const text = [
    sleepReferenceText(SLEEP_REFERENCES[0]!),
    SLEEP_REFERENCE_DISCLAIMER,
    SLEEP_REFERENCE_BAND_HINT,
    SLEEP_REFERENCE_SOURCE,
  ].join("\n");
  assert.match(text, /13～18 小时（含白天小睡）/);
  assert.match(text, /记录可能不全/);
  assert.match(text, /以医生为准/);
  assert.match(text, /只画在已过完的日子上/);
  assert.doesNotMatch(text, /不足|过多|偏少|偏多|异常|确诊|建议|达标|医学评估/);
});

test("P8.3.2 今日卡片与趋势图都引用同一份参考文案", () => {
  const today = readFileSync(
    new URL("../src/components/TodayCareSummary.vue", import.meta.url),
    "utf8",
  );
  const trend = readFileSync(
    new URL("../src/components/TrendChart.vue", import.meta.url),
    "utf8",
  );
  assert.match(today, /sleepReferenceText\(sleepReference\)/);
  assert.match(today, /SLEEP_REFERENCE_DISCLAIMER/);
  assert.match(trend, /SLEEP_REFERENCE_BAND_HINT/);
  assert.match(trend, /referenceBand/);
  assert.match(trend, /bars\.value\.length - 2/, "今天未过完不画参考带");
});
