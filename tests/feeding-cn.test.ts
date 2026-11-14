import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FEEDING_GUIDES,
  FEEDING_SOURCE,
  FEEDING_SOURCE_URL,
  NEW_FOOD_OBSERVATION_NOTE,
  NEW_FOOD_SOURCE,
  NEW_FOOD_SOURCE_URL,
  NEW_FOOD_VERSION_NOTE,
  ORAL_CARE_FOOTNOTE,
  ORAL_CARE_TIPS,
  ORAL_SOURCE_URL,
  feedingGuideFor,
} from "../src/data/feeding-guide-cn.ts";
import { firstFoodIntroductions } from "../src/domain/feeding-new-food.ts";
import type { GrowthEntry } from "../src/types.ts";
import type { CareObservation } from "../src/domain/care-types.ts";

function entry(capturedAt: string, care: Partial<CareObservation>): GrowthEntry {
  return {
    id: `${capturedAt}-${JSON.stringify(care)}`,
    title: "吃了什么", note: "", capturedAt, tag: "喂奶",
    favorite: false, milestone: false,
    care: { kind: "feeding", sourceText: "原话", ...care },
  };
}

test("P8.5.1 膳食指南 2022 两组各 6 条准则，带来源且不写剂量", () => {
  assert.equal(FEEDING_GUIDES.length, 2);
  assert.deepEqual(FEEDING_GUIDES.map((guide) => guide.items.length), [6, 6]);
  assert.deepEqual(
    FEEDING_GUIDES.map((guide) => [guide.minMonths, guide.maxMonths]),
    [[0, 6], [7, 24]],
  );
  assert.match(FEEDING_SOURCE, /中国居民膳食指南（2022）/);
  assert.match(FEEDING_SOURCE_URL, /dg\.cnsoc\.org/);
  assert.match(ORAL_SOURCE_URL, /nhc\.gov\.cn/);
  const text = FEEDING_GUIDES.flatMap((guide) => guide.items).join("\n");
  assert.match(text, /满 6 月龄起必须添加辅食/);
  assert.match(text, /维生素 D/);
  assert.doesNotMatch(text, /400|IU|微克|毫升|剂量|用量/);
  assert.doesNotMatch(text, /不足|过多|异常|确诊/);
});

test("P8.5.1 按完整月龄选准则组，超过 24 月龄不显示", () => {
  assert.equal(feedingGuideFor(0)!.id, "0-6");
  assert.equal(feedingGuideFor(6)!.id, "0-6");
  assert.equal(feedingGuideFor(7)!.id, "7-24");
  assert.equal(feedingGuideFor(24)!.id, "7-24");
  assert.equal(feedingGuideFor(25), undefined);
  assert.equal(feedingGuideFor(-1), undefined);
  assert.equal(feedingGuideFor(Number.NaN), undefined);
});

test("P8.5.0 / P8.5.2 观察天数只作带出处的描述，不做倒计时与判断", () => {
  assert.match(NEW_FOOD_OBSERVATION_NOTE, /2～3 天/);
  assert.match(NEW_FOOD_OBSERVATION_NOTE, /只记首次吃的日期，不计时、不判断/);
  assert.match(NEW_FOOD_OBSERVATION_NOTE, /以医生为准/);
  assert.match(NEW_FOOD_SOURCE, /2016 版/);
  assert.match(NEW_FOOD_SOURCE_URL, /dg\.cnsoc\.org/);
  assert.match(NEW_FOOD_VERSION_NOTE, /2022 版官方核心信息以图示发布/);
  assert.doesNotMatch(NEW_FOOD_OBSERVATION_NOTE, /不足|过多|异常|确诊|达标/);
});

test("P8.5.3 口腔提示只列已核实条目，不做乳牙萌出时间表", () => {
  assert.equal(ORAL_CARE_TIPS.length, 4);
  const tips = ORAL_CARE_TIPS.join("\n");
  assert.match(tips, /第一颗牙萌出后 6 个月内/);
  assert.match(tips, /每半年检查一次/);
  assert.match(tips, /每天刷牙 2 次/);
  assert.match(tips, /1 岁半～2 岁停用/);
  assert.match(tips, /按实际出牙数填写/);
  assert.match(ORAL_CARE_FOOTNOTE, /不做乳牙萌出时间表/);
  assert.doesNotMatch(tips + ORAL_CARE_FOOTNOTE, /下乳中切牙|乳侧切牙|第一乳磨牙|6～8 个月萌出/);
});

test("P8.5.2 新食物由已有 food / reaction 派生，精确匹配不猜同义词", () => {
  const entries = [
    entry("2026-09-02T08:00", { food: "米粉", reaction: "没有特别反应" }),
    entry("2026-09-01T09:00", { food: "蛋黄" }),
    entry("2026-09-03T10:00", { food: "米粉", reaction: "第二次的记录" }),
    entry("2026-09-04T11:00", { food: " 蛋黄 " }),
    entry("2026-09-05T12:00", { food: "蛋黄泥" }),
    entry("2026-09-06T13:00", { food: "" }),
    entry("2026-09-07T14:00", {}),
  ];
  const foods = firstFoodIntroductions(entries);
  assert.deepEqual(foods, [
    { name: "蛋黄", date: "2026-09-01" },
    { name: "米粉", date: "2026-09-02", reaction: "没有特别反应" },
    { name: "蛋黄泥", date: "2026-09-05" },
  ]);
  assert.equal(firstFoodIntroductions([]).length, 0);
  assert.equal(
    firstFoodIntroductions([entry("2026-09-01T09:00", { food: "米粉" })]).length,
    1,
  );
});

test("P8.5 月龄卡与健康页接线，不新增存储字段", () => {
  const guide = readFileSync(
    new URL("../src/components/AgeGuideCard.vue", import.meta.url),
    "utf8",
  );
  const feeding = readFileSync(
    new URL("../src/components/FeedingNotesCard.vue", import.meta.url),
    "utf8",
  );
  const healthView = readFileSync(
    new URL("../src/views/HealthView.vue", import.meta.url),
    "utf8",
  );
  assert.match(guide, /feedingGuideFor/);
  assert.match(guide, /FEEDING_SOURCE_URL/);
  assert.match(guide, /可以留意/, "CDC 里程碑块保持原样");
  assert.match(feeding, /firstFoodIntroductions/);
  assert.match(feeding, /NEW_FOOD_OBSERVATION_NOTE/);
  assert.match(feeding, /ORAL_CARE_TIPS/);
  assert.match(healthView, /FeedingNotesCard/);
  assert.doesNotMatch(feeding, /newFood|saveFood|foodIntroductions:/);
});
