import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pendingVaccinesOn, defaultVaccinePlan } from "../src/domain/vaccines.ts";
import { SCHOOL_CHECK_COPY, SCHOOL_CHECK_SOURCE } from "../src/data/school-check-cn.ts";
import { buildVisitSummary } from "../src/domain/summary.ts";
import type { BabyProfile, GrowthEntry, VaccinationRecord, VaccinePlan } from "../src/types.ts";
import type { CareObservation } from "../src/domain/care-types.ts";

const baby: BabyProfile = { name: "小满", birthDate: "2026-01-31", sex: "male" };

function record(code: string, dose: number): VaccinationRecord {
  return { id: `${code}-${dose}`, code, dose, date: "2026-03-01", createdAt: "2026-03-01" };
}

function measure(capturedAt: string, values: Partial<CareObservation>): GrowthEntry {
  return {
    id: `${capturedAt}-measure`, title: "生长测量记录", note: "",
    capturedAt, tag: "测量", favorite: false, milestone: false,
    care: { kind: "measurement", sourceText: "手动记录测量", ...values },
  };
}

test("P8.6.1 到指定日期应种未种，二选一未选标待选，已记录剂次不重复", () => {
  // 目标日期取到 2 岁以后，才能覆盖甲肝（18 月龄）等后续剂次。
  const target = "2028-12-31";
  const plan = defaultVaccinePlan();
  const items = pendingVaccinesOn(baby, plan, [], target);
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.dueDate <= target));
  const keys = items.map((item) => `${item.code}-${item.dose}`);
  assert.equal(new Set(keys).size, keys.length, "同一剂次不重复列出");
  assert.ok(
    items.some((item) => item.pendingChoice && item.code.startsWith("JE")),
    "乙脑二选一未选，两支都列出并标待选",
  );
  assert.ok(
    items.some((item) => item.pendingChoice && item.code.startsWith("HepA")),
    "甲肝二选一未选",
  );
  assert.ok(
    items.every((item, index) => index === 0 || items[index - 1]!.dueDate <= item.dueDate),
    "按应种日期排序",
  );

  const chosen: VaccinePlan = {
    specialProgram: false,
    choices: { je: "JE-L", hepa: "HepA-I" },
  };
  const narrowed = pendingVaccinesOn(baby, chosen, [], target);
  assert.equal(narrowed.some((item) => item.code === "JE-I"), false);
  assert.equal(narrowed.some((item) => item.code === "HepA-L"), false);
  assert.equal(narrowed.some((item) => item.pendingChoice), false);

  const withRecord = pendingVaccinesOn(baby, chosen, [record("HepB", 1)], target);
  assert.equal(withRecord.some((item) => item.code === "HepB" && item.dose === 1), false);
  assert.equal(
    pendingVaccinesOn(baby, plan, [], "2026-01-30").length,
    0,
    "目标日期早于出生日期时不列",
  );
  assert.equal(
    pendingVaccinesOn(baby, plan, [], "2026-02-01").length,
    2,
    "出生时应种的乙肝第 1 剂与卡介苗会列出",
  );
  assert.equal(pendingVaccinesOn({ name: "未填", birthDate: "" }, plan, [], target).length, 0);
});

test("P8.6.1 乙肝特殊程序沿用已有开关", () => {
  const target = "2026-11-30";
  const normal = pendingVaccinesOn(baby, defaultVaccinePlan(), [], target)
    .filter((item) => item.code === "HepB");
  const special = pendingVaccinesOn(
    baby,
    { specialProgram: true, choices: {} },
    [],
    target,
  ).filter((item) => item.code === "HepB");
  assert.equal(normal.length, 3, "常规 0/1/6 月龄三剂");
  assert.equal(special.length, 4, "特殊程序 0/1/2/7 月龄四剂");
});

test("P8.6.2 固定文案守住边界：只按国家程序、不做倒计时", () => {
  const text = [
    ...Object.values(SCHOOL_CHECK_COPY).filter((value) => typeof value === "string"),
    SCHOOL_CHECK_SOURCE,
  ].join("\n");
  assert.match(text, /仅按国家免疫规划核对/);
  assert.match(text, /以接种单位出具的评估为准/);
  assert.match(text, /各省可能增加疫苗/);
  assert.match(text, /补种间隔请咨询接种门诊/);
  assert.match(text, /不做倒计时/);
  assert.match(SCHOOL_CHECK_SOURCE, /2021〕4 号/);
  assert.doesNotMatch(text, /超重|肥胖|异常|确诊|诊断/);

  const card = readFileSync(
    new URL("../src/components/SchoolCheckCard.vue", import.meta.url),
    "utf8",
  );
  const healthView = readFileSync(
    new URL("../src/views/HealthView.vue", import.meta.url),
    "utf8",
  );
  const layout = readFileSync(
    new URL("../src/styles/layout.css", import.meta.url),
    "utf8",
  );
  assert.match(card, /Teleport to="body"/);
  assert.match(card, /window\.print\(\)/);
  assert.match(card, /pendingVaccinesOn/);
  assert.match(healthView, /SchoolCheckCard/);
  assert.match(layout, /\.school-check-sheet/, "打印样式只留核对单");
});

test("P8.7 就诊摘要补最近一次测量与百分位区间（含 BMI）", () => {
  const entries = [
    measure("2026-01-31T09:00", { weightKg: 3.2 }),
    measure("2026-02-01T09:00", { weightKg: 3.5, heightCm: 50, headCm: 34 }),
  ];
  const summary = buildVisitSummary(
    entries,
    baby,
    [],
    defaultVaccinePlan(),
    new Date(2026, 1, 7, 12, 0),
    7,
  );
  const growth = summary.growth!;
  assert.equal(growth.date, "2026-02-01T09:00");
  assert.equal(growth.weightKg, 3.5);
  assert.equal(growth.heightCm, 50);
  assert.equal(growth.headCm, 34);
  assert.equal(growth.bmi, 14, "3.5 kg ÷ 0.5 m² = 14");
  assert.ok(growth.bands.length >= 3);
  assert.ok(growth.bands.some((band) => band.label === "BMI"));
  assert.match(growth.note, /只描述数据，不做发育判断/);
  assert.match(growth.note, /以医生为准/);
  assert.doesNotMatch(
    JSON.stringify(growth),
    /偏高|偏低|超重|肥胖|异常|确诊/,
  );
});

test("P8.7 未填性别只列数值不写区间，表外月龄不给头围区间", () => {
  const entries = [measure("2026-02-01T09:00", { weightKg: 3.5, heightCm: 50, headCm: 34 })];
  const noSex = buildVisitSummary(
    entries,
    { name: "小满", birthDate: "2026-01-31" },
    [],
    defaultVaccinePlan(),
    new Date(2026, 1, 7, 12, 0),
    7,
  );
  assert.equal(noSex.growth!.bands.length, 0);
  assert.equal(noSex.growth!.bmi, 14);
  assert.match(noSex.growth!.note, /只列测量数值，不给参考区间/);

  const older = buildVisitSummary(
    [measure("2026-02-01T09:00", { weightKg: 18, heightCm: 105, headCm: 50 })],
    { name: "小满", birthDate: "2021-01-01", sex: "female" },
    [],
    defaultVaccinePlan(),
    new Date(2026, 1, 7, 12, 0),
    7,
  );
  assert.equal(
    older.growth!.bands.some((band) => band.label === "头围"),
    false,
    "头围表只到 3 岁，超出不写区间",
  );
  const noMeasurement = buildVisitSummary(
    [],
    baby,
    [],
    defaultVaccinePlan(),
    new Date(2026, 1, 7, 12, 0),
    7,
  );
  assert.equal(noMeasurement.growth, undefined);

  const sheet = readFileSync(
    new URL("../src/components/VisitSummary.vue", import.meta.url),
    "utf8",
  );
  assert.match(sheet, /最近一次生长测量/);
  assert.match(sheet, /summary\.growth\.bands/);
});
