import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GROWTH_PERCENTILES,
  GROWTH_STANDARD_2022,
} from "../src/data/growth-standard-2022.ts";
import {
  percentileBand,
  referenceAt,
  referenceLines,
  SHOWN_PERCENTILES,
} from "../src/domain/growth-percentiles.ts";

test("静态表来自标准原文：8 张表（含 P8.2 的 BMI）、月龄连续、每行 7 个单调百分位", () => {
  assert.deepEqual(GROWTH_PERCENTILES, [3, 10, 25, 50, 75, 90, 97]);
  for (const sex of ["male", "female"] as const) {
    for (const metric of ["weightKg", "heightCm", "headCm", "bmi"] as const) {
      const rows = GROWTH_STANDARD_2022[sex][metric];
      const expected = metric === "headCm" ? 29 : 44;
      assert.equal(rows.length, expected, `${sex}/${metric} 行数`);
      assert.equal(rows[0]![0], 0);
      assert.equal(rows[rows.length - 1]![0], metric === "headCm" ? 36 : 81);
      for (const row of rows) {
        assert.equal(row.length, 8, `${sex}/${metric} 月龄 ${row[0]} 的列数`);
        for (let i = 1; i < 7; i++)
          assert.ok(row[i]! <= row[i + 1]!, `${sex}/${metric} 月龄 ${row[0]} 单调`);
      }
    }
  }
  // PDF 表 A.1 / A.3 / A.11 首行抽样。
  assert.deepEqual(
    GROWTH_STANDARD_2022.male.weightKg[0]!.slice(1),
    [2.8, 3, 3.2, 3.5, 3.7, 4, 4.2],
  );
  assert.deepEqual(
    GROWTH_STANDARD_2022.male.heightCm[0]!.slice(1),
    [47.6, 48.7, 49.9, 51.2, 52.5, 53.6, 54.8],
  );
  assert.deepEqual(
    GROWTH_STANDARD_2022.male.headCm[0]!.slice(1),
    [31.9, 32.7, 33.4, 34.3, 35.2, 36, 36.8],
  );
});

test("查表与相邻行插值；超范围、未填性别都不出参考值", () => {
  const atBirth = referenceAt("male", "weightKg", 0)!;
  assert.equal(atBirth[3], 3.5, "0 月男童 P50 = 3.5 kg");
  const between = referenceAt("male", "weightKg", 0.5)!;
  assert.equal(Math.round(between[3]! * 100) / 100, 4.05, "0 与 1 月之间线性插值");
  assert.equal(referenceAt("male", "weightKg", 81)![6], 30.6);
  assert.equal(referenceAt("male", "weightKg", 82), undefined, "超过 6 岁 9 月");
  assert.equal(referenceAt("male", "headCm", 37), undefined, "头围只到 3 岁");
  assert.equal(referenceAt(undefined, "weightKg", 0), undefined);
  assert.equal(referenceAt("female", "weightKg", -1), undefined);
});

test("参考线只画可见月龄范围里的 5 条，且按表行采样", () => {
  const lines = referenceLines("female", "heightCm", 12);
  assert.deepEqual(
    lines.map((line) => line.percentile),
    SHOWN_PERCENTILES,
  );
  for (const line of lines) {
    assert.ok(line.points.length >= 2);
    assert.equal(line.points[0]!.months, 0);
    assert.equal(line.points[line.points.length - 1]!.months, 12);
    assert.ok(line.points.every((point) => point.months <= 12));
  }
  const median = lines.find((line) => line.percentile === 50)!;
  assert.equal(median.points[0]!.value, 50.3, "女童 0 月身长 P50");
  assert.equal(referenceLines(undefined, "heightCm", 12).length, 0);
});

test("区间文案只描述数据，不出现偏高偏低等判断", () => {
  assert.equal(
    percentileBand("male", "weightKg", 0, 3.5),
    "约 P50 参考值",
  );
  assert.equal(
    percentileBand("male", "weightKg", 0, 3.3),
    "位于 P25–P50 区间",
  );
  assert.equal(percentileBand("male", "weightKg", 0, 2), "低于 P3 参考值");
  assert.equal(percentileBand("male", "weightKg", 0, 5), "高于 P97 参考值");
  assert.equal(percentileBand("male", "headCm", 48, 48), null, "头围表外不描述");
  assert.equal(percentileBand(undefined, "weightKg", 0, 3.5), null);
  const text = percentileBand("male", "weightKg", 0, 3.3)!;
  assert.doesNotMatch(text, /偏| abnormal|正常|异常|建议/);
});
