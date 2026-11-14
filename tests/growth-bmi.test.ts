import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GROWTH_PERCENTILES,
  GROWTH_STANDARD_2022,
} from "../src/data/growth-standard-2022.ts";
import { percentileBand, referenceAt, referenceLines } from "../src/domain/growth-percentiles.ts";
import { bmiFrom, GROWTH_METRICS, growthSeries } from "../src/domain/growth.ts";
import { defaultVaccinePlan } from "../src/domain/vaccines.ts";
import type { BabyProfile, GrowthEntry } from "../src/types.ts";
import type { CareObservation } from "../src/domain/care-types.ts";

const baby: BabyProfile = { name: "小满", birthDate: "2026-01-31", sex: "male" };

function measure(capturedAt: string, values: Partial<CareObservation>): GrowthEntry {
  return {
    id: `${capturedAt}-${JSON.stringify(values)}`,
    title: "生长测量记录",
    note: "",
    capturedAt,
    tag: "测量",
    favorite: false,
    milestone: false,
    care: { kind: "measurement", sourceText: "手动记录测量", ...values },
  };
}

test("P8.2.1 表 A.9/A.10 逐行录入：44 行、月龄连续、7 个单调百分位", () => {
  const expected = [
    ...Array.from({ length: 24 }, (_, month) => month),
    ...Array.from({ length: 20 }, (_, index) => 24 + index * 3),
  ];
  assert.equal(expected.length, 44);
  assert.equal(expected.at(-1), 81);
  for (const sex of ["male", "female"] as const) {
    const rows = GROWTH_STANDARD_2022[sex].bmi;
    assert.equal(rows.length, 44, `${sex} BMI 行数`);
    assert.deepEqual(rows.map((row) => row[0]), expected, `${sex} BMI 月龄连续`);
    for (const row of rows) {
      assert.equal(row.length, 8, `${sex} BMI 月龄 ${row[0]} 的列数`);
      for (let i = 1; i < 7; i++)
        assert.ok(row[i]! <= row[i + 1]!, `${sex} BMI 月龄 ${row[0]} 单调不减`);
    }
  }
  assert.deepEqual(GROWTH_PERCENTILES, [3, 10, 25, 50, 75, 90, 97]);
});

test("P8.2.1 抽样回查官方 PDF 表 A.9 / A.10 原文", () => {
  // 男童：0 月 / 6 月（A.9 续表首行）/ 2 岁 / 6 岁 9 月。
  assert.deepEqual(
    GROWTH_STANDARD_2022.male.bmi[0]!.slice(1),
    [11.2, 11.8, 12.5, 13.2, 14, 14.8, 15.5],
  );
  assert.deepEqual(
    GROWTH_STANDARD_2022.male.bmi[6]!.slice(1),
    [15.3, 16.1, 16.9, 17.9, 18.9, 20, 21.1],
  );
  assert.deepEqual(
    GROWTH_STANDARD_2022.male.bmi[24]!.slice(1),
    [14.1, 14.7, 15.3, 16.1, 17, 17.9, 18.8],
  );
  assert.deepEqual(
    GROWTH_STANDARD_2022.male.bmi[43]!.slice(1),
    [13.1, 13.7, 14.5, 15.4, 16.6, 17.8, 19.4],
  );
  // 女童：0 月 / 1 岁 / 4 岁（A.10 续表）/ 6 岁 9 月。
  assert.deepEqual(
    GROWTH_STANDARD_2022.female.bmi[0]!.slice(1),
    [11.1, 11.7, 12.3, 13.1, 13.8, 14.5, 15.3],
  );
  assert.deepEqual(
    GROWTH_STANDARD_2022.female.bmi[12]!.slice(1),
    [14.5, 15.1, 15.8, 16.7, 17.6, 18.5, 19.6],
  );
  assert.deepEqual(
    GROWTH_STANDARD_2022.female.bmi[32]!.slice(1),
    [13.1, 13.7, 14.3, 15.1, 15.9, 16.8, 17.8],
  );
  assert.deepEqual(
    GROWTH_STANDARD_2022.female.bmi[43]!.slice(1),
    [12.8, 13.4, 14.1, 15, 16.1, 17.2, 18.5],
  );
});

test("P8.2.1 提取脚本入库，且生成的数据与静态表一致", () => {
  const script = readFileSync(
    new URL("../scripts/extract_growth_bmi.py", import.meta.url),
    "utf8",
  );
  assert.match(script, /uv run scripts\/extract_growth_bmi\.py/);
  assert.match(script, /表 A\.9/);
  assert.match(script, /AGES = list\(range\(0, 24\)\) \+ list\(range\(24, 82, 3\)\)/);
  assert.match(script, /单调不减/);
  assert.match(script, /pdftotext/);
});

test("P8.2.2 BMI 由同一自然日派生，缺项、跨天、非正数都不算", () => {
  assert.equal(bmiFrom(7.25, 65.25), 17);
  assert.equal(bmiFrom(5, 50), 20);
  assert.equal(bmiFrom(undefined, 50), undefined);
  assert.equal(bmiFrom(5, undefined), undefined);
  assert.equal(bmiFrom(0, 50), undefined);
  assert.equal(bmiFrom(5, 0), undefined);
  assert.equal(bmiFrom(Number.NaN, 50), undefined);

  const entries = [
    measure("2026-05-01T08:00", { weightKg: 7.25 }),
    measure("2026-05-01T20:00", { heightCm: 65.25 }),
    measure("2026-06-01T09:00", { weightKg: 8 }), // 只有体重，不成点
    measure("2026-07-01T09:00", { heightCm: 70 }), // 只有身高，不成点
    measure("2026-08-01T09:00", { weightKg: 9, heightCm: 72 }),
  ];
  const points = growthSeries(entries, baby, "bmi");
  assert.equal(points.length, 2);
  assert.equal(points[0]!.date, "2026-05-01T12:00");
  assert.equal(points[0]!.value, 17);
  assert.ok(points[1]!.months > points[0]!.months);
  assert.equal(growthSeries(entries, baby, "weightKg").length, 3);
  // 早产矫正：预产期晚于生日时，BMI 与其它指标共用同一起点。
  const early: BabyProfile = { ...baby, dueDate: "2026-03-02" };
  assert.ok(
    growthSeries(entries, early, "bmi")[0]!.months <
      growthSeries(entries, baby, "bmi")[0]!.months,
  );
});

test("P8.2.2 / P8.2.3 区间复用查表，文案不写超重肥胖", () => {
  const values = referenceAt("male", "bmi", 0)!;
  assert.equal(values[3], 13.2, "0 月男童 BMI P50");
  assert.equal(referenceAt("male", "bmi", 82), undefined);
  assert.equal(referenceAt(undefined, "bmi", 0), undefined);
  assert.equal(referenceLines("female", "bmi", 12).length, 5);
  assert.equal(percentileBand("male", "bmi", 0, 13.2), "约 P50 参考值");
  assert.equal(percentileBand("male", "bmi", 0, 13), "位于 P25–P50 区间");
  assert.equal(percentileBand(undefined, "bmi", 0, 13.2), null);

  const metrics = GROWTH_METRICS.map((item) => item.id);
  assert.deepEqual(metrics, ["weightKg", "heightCm", "headCm", "bmi"]);
  const healthView = readFileSync(
    new URL("../src/views/HealthView.vue", import.meta.url),
    "utf8",
  );
  const chart = readFileSync(
    new URL("../src/components/GrowthChart.vue", import.meta.url),
    "utf8",
  );
  assert.match(healthView, /不写超重或肥胖/);
  assert.doesNotMatch(chart, /超重|肥胖|偏胖|偏瘦/);
  assert.match(chart, /percentileBand\(/);
  // 占位：确认疫苗计划默认值仍可用（BMI 不新增存储字段、不碰 schema）。
  assert.equal(defaultVaccinePlan().specialProgram, false);
});
