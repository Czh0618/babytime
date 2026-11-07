import { test } from "node:test";
import assert from "node:assert/strict";
import type { CareObservation } from "../src/domain/care-types.ts";
import type { GrowthEntry } from "../src/types.ts";
import {
  buildTimeline,
  filterTimelineEntries,
  hasTimelineQuery,
  TIMELINE_CARE_FILTERS,
} from "../src/domain/timeline.ts";

type CareInput = Partial<CareObservation> & Pick<CareObservation, "kind">;

function entry(
  id: string,
  title: string,
  note: string,
  care?: CareInput,
  tag = "日常备注",
): GrowthEntry {
  return {
    id,
    title,
    note,
    tag,
    capturedAt: "2026-11-07T09:00",
    milestone: false,
    favorite: false,
    care: care
      ? ({ ...care, sourceText: care.sourceText ?? "" } as CareObservation)
      : undefined,
  };
}

const feeding: CareInput = {
  kind: "feeding",
  amountMl: 90,
  feedingMethod: "bottle-formula",
};
const sleep: CareInput = {
  kind: "sleep",
  sleepState: "duration",
  durationMinutes: 80,
};
const diaper: CareInput = { kind: "diaper", diaper: "wet" };
const temperature: CareInput = {
  kind: "temperature",
  temperatureC: 37.8,
  site: "armpit",
};
const medicine: CareInput = {
  kind: "medicine",
  medicineName: "对乙酰氨基酚",
  dose: "2 ml",
  sourceText: "早上说有点发烧，先按说明书给了退烧药",
};
const solid: CareInput = {
  kind: "feeding",
  feedingMethod: "solid",
  food: "南瓜泥",
  reaction: "嘴角有点红",
};

const entries = [
  entry("e1", "第一次翻身", "趴着练了一会儿"),
  entry("e2", "奶量记录", "上午那顿", feeding, "喂奶"),
  entry("e3", "午睡", "", sleep, "睡眠"),
  entry("e4", "换尿布", "", diaper, "换尿布"),
  entry("e5", "体温记录", "", temperature, "体温"),
  entry("e6", "用药记录", "", medicine, "用药"),
  entry("e7", "加辅食", "", solid, "喂奶"),
];

test("关键词可搜标题、备注、照护内容、原话与照护文字字段", () => {
  assert.deepEqual(
    filterTimelineEntries(entries, "翻身").map((item) => item.id),
    ["e1"],
  );
  assert.deepEqual(
    filterTimelineEntries(entries, "上午那顿").map((item) => item.id),
    ["e2"],
  );
  assert.deepEqual(
    filterTimelineEntries(entries, "90 ml").map((item) => item.id),
    ["e2"],
    "整理后的照护内容",
  );
  assert.deepEqual(
    filterTimelineEntries(entries, "37.8").map((item) => item.id),
    ["e5"],
  );
  assert.deepEqual(
    filterTimelineEntries(entries, "说明书").map((item) => item.id),
    ["e6"],
    "原话",
  );
  assert.deepEqual(
    filterTimelineEntries(entries, "南瓜泥").map((item) => item.id),
    ["e7"],
    "辅食名称",
  );
  assert.deepEqual(
    filterTimelineEntries(entries, "嘴角").map((item) => item.id),
    ["e7"],
    "不适反应",
  );
  assert.deepEqual(filterTimelineEntries(entries, "  ").map((item) => item.id),
    entries.map((item) => item.id),
    "空关键词不过滤");
});

test("照护类别筛选只保留该类别，且与关键词同时生效", () => {
  assert.deepEqual(TIMELINE_CARE_FILTERS.map((item) => item.id), [
    "all",
    "feeding",
    "sleep",
    "diaper",
    "temperature",
    "medicine",
  ]);
  assert.deepEqual(
    filterTimelineEntries(entries, "", "feeding").map((item) => item.id),
    ["e2", "e7"],
  );
  assert.deepEqual(
    filterTimelineEntries(entries, "", "sleep").map((item) => item.id),
    ["e3"],
  );
  assert.deepEqual(
    filterTimelineEntries(entries, "", "temperature").map((item) => item.id),
    ["e5"],
  );
  assert.deepEqual(
    filterTimelineEntries(entries, "南瓜", "feeding").map((item) => item.id),
    ["e7"],
  );
  assert.deepEqual(filterTimelineEntries(entries, "南瓜", "sleep"), []);
  assert.equal(filterTimelineEntries(entries, "", "all"), entries);
  assert.equal(hasTimelineQuery("", "all"), false);
  assert.equal(hasTimelineQuery(" ", "all"), false);
  assert.equal(hasTimelineQuery("", "feeding"), true);
  assert.equal(hasTimelineQuery("奶", "all"), true);
});

test("筛选后时间线只含命中记录；当天多条照护仍折叠，供界面自动展开", () => {
  const matched = filterTimelineEntries(entries, "", "feeding");
  const page = buildTimeline(matched, 14);
  assert.equal(page.days.length, 1);
  assert.equal(page.days[0]!.entries.length, 2);
  assert.equal(page.days[0]!.care.length, 2, "折叠行里有 2 条命中记录");
  assert.equal(hasTimelineQuery("", "feeding"), true, "界面据此自动展开");
});
