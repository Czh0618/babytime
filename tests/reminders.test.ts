import { test } from "node:test";
import assert from "node:assert/strict";
import { findAnniversary } from "../src/domain/anniversary.ts";
import {
  previousMonthRange,
  suggestMonthlyRecap,
} from "../src/domain/recap-draft.ts";
import {
  buildHandoffSummary,
  numbersConsistent,
  numbersIn,
} from "../src/domain/handoff.ts";
import { isMedicalQuestion, MEDICAL_REPLY } from "../src/domain/ai.ts";
import type { BabyProfile, GrowthEntry } from "../src/types.ts";
import type { CareObservation } from "../src/domain/care-types.ts";

const baby: BabyProfile = { name: "小满", birthDate: "2026-06-01" };

function entry(
  id: string,
  capturedAt: string,
  care?: CareObservation,
  extra: Partial<GrowthEntry> = {},
): GrowthEntry {
  return {
    id,
    title: extra.title ?? "记录",
    note: "",
    capturedAt,
    tag: "记录",
    favorite: false,
    milestone: false,
    care,
    ...extra,
  };
}

test("满月、百天与生日按本机日期判断", () => {
  // 6-01 出生，第 30 天是 6-30，第 100 天是 9-08
  assert.equal(
    findAnniversary(baby, [], "2026-06-30")?.key,
    "full-month-2026-06-30",
  );
  assert.match(findAnniversary(baby, [], "2026-06-30")!.title, /满月/);
  assert.match(findAnniversary(baby, [], "2026-09-08")!.title, /百天/);
  assert.match(findAnniversary(baby, [], "2027-06-01")!.title, /1 岁生日/);
  assert.equal(findAnniversary(baby, [], "2026-09-09"), null);
});

test("那年今日取同月同日的往年记录", () => {
  const entries = [
    entry("a", "2026-11-07T10:00", undefined, { title: "第一次翻身" }),
    entry("b", "2025-11-07T09:00", undefined, { title: "去年的今天" }),
    entry("c", "2025-11-08T09:00"),
  ];
  const firstYear = findAnniversary(baby, entries, "2026-11-07");
  assert.match(firstYear!.title, /1 年前/);
  assert.match(firstYear!.detail, /1 条记录/);
  const withPast = [
    ...entries,
    entry("d", "2024-11-07T09:00", undefined, { title: "更早的一张" }),
  ];
  const found = findAnniversary(baby, withPast, "2026-11-07");
  assert.match(found!.title, /1 年前的今天/);
  assert.match(found!.detail, /2 条记录/);
});

test("月度回顾草稿取上个月，优先收藏与里程碑", () => {
  assert.deepEqual(previousMonthRange("2026-11-07"), {
    from: "2026-10-01",
    to: "2026-10-31",
    month: 10,
    year: 2026,
  });
  const entries = [
    entry("f1", "2026-10-02T10:00", undefined, { favorite: true, mediaIds: ["m1"] }),
    entry("m1", "2026-10-03T10:00", undefined, { milestone: true, mediaIds: ["m2"] }),
    entry("f2", "2026-10-04T10:00", undefined, { favorite: true, mediaIds: ["m3"] }),
    entry("x1", "2026-10-05T10:00", undefined, { mediaIds: ["m4"] }),
    entry("old", "2026-09-30T10:00"),
  ];
  const draft = suggestMonthlyRecap(entries, "2026-11-07");
  assert.equal(draft!.title, "10 月的小日子");
  // 收藏与里程碑已满 3 条，不再补普通素材。
  assert.deepEqual(draft!.entryIds, ["f1", "m1", "f2"]);
  assert.equal(draft!.dateFrom, "2026-10-01");
  assert.equal(draft!.dateTo, "2026-10-31");
  assert.equal(suggestMonthlyRecap([], "2026-11-07"), null);
});

test("今日交接摘要只写当天记录到的数字", () => {
  const now = new Date(2026, 10, 7, 18, 0);
  const entries = [
    entry("1", "2026-11-07T08:00", { kind: "feeding", amountMl: 120, sourceText: "喂奶" }),
    entry("2", "2026-11-07T11:00", { kind: "feeding", amountMl: 150, sourceText: "喂奶" }),
    entry("3", "2026-11-07T12:30", { kind: "sleep", sleepState: "asleep", sourceText: "睡" }),
    entry("4", "2026-11-07T14:00", { kind: "sleep", sleepState: "awake", sourceText: "醒" }),
    entry("5", "2026-11-07T15:00", { kind: "diaper", diaper: "mixed", sourceText: "换" }),
    entry("6", "2026-11-07T16:00", {
      kind: "temperature",
      temperatureC: 37.8,
      sourceText: "体温",
    }),
    entry("7", "2026-11-07T17:00", {
      kind: "medicine",
      medicineName: "美林",
      dose: "2.5ml",
      sourceText: "喂药",
    }),
  ];
  const text = buildHandoffSummary(entries, { name: "小满", now });
  assert.match(text, /小满今天喂奶 2 次、共 270 ml/);
  assert.match(text, /睡眠 1 小时 30 分/);
  assert.match(text, /尿布 1 次（尿湿 1、便便 1）/);
  assert.match(text, /最近体温 37.8℃（16:00）/);
  assert.match(text, /上次用药 17:00 美林 2.5ml/);
  assert.equal(buildHandoffSummary([], { now }), "");
});

test("交接摘要的最近体温取最后一次测量，不上报当日最高", () => {
  const now = new Date(2026, 10, 7, 18, 0);
  const entries = [
    entry("1", "2026-11-07T08:00", {
      kind: "temperature",
      temperatureC: 38.6,
      sourceText: "早上量的",
    }),
    entry("2", "2026-11-07T15:00", {
      kind: "temperature",
      temperatureC: 36.8,
      sourceText: "下午量的",
    }),
  ];
  const text = buildHandoffSummary(entries, { name: "小满", now });
  assert.match(text, /最近体温 36.8℃（15:00）/);
  assert.doesNotMatch(text, /38.6/);
});

test("AI 改写只允许保留原有数字，不能新增", () => {
  const source = "小满今天喂奶 2 次、共 270 ml。睡眠 1 小时 30 分。";
  assert.deepEqual(numbersIn(source), ["2", "270", "1", "30"]);
  assert.equal(
    numbersConsistent("今天喂了 2 次奶，一共 270 ml，睡了 1 小时 30 分。", source),
    true,
  );
  assert.equal(numbersConsistent("今天喂了 3 次奶，共 270 ml。", source), false);
  assert.equal(numbersConsistent("今天喂了 2 次奶，共 300 ml。", source), false);
});

test("医疗类问题直接给固定回复，不调用模型", () => {
  assert.equal(isMedicalQuestion("宝宝发烧了要不要吃药"), true);
  assert.equal(isMedicalQuestion("疫苗可以晚点打吗"), true);
  assert.equal(isMedicalQuestion("最近睡得怎么样"), false);
  assert.equal(isMedicalQuestion("这周喂奶几次"), false);
  assert.match(MEDICAL_REPLY, /请咨询医生/);
});
