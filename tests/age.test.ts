import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn } from "../src/domain/age.ts";
import {
  AGE_GUIDES,
  guideForAge,
  guideForBaby,
} from "../src/data/age-guides.ts";

test("按日历月计算整月和余天，不把天数除以30", () => {
  assert.deepEqual(ageOn("2026-01-31", "2026-02-28"), {
    months: 1,
    days: 0,
    valid: true,
  });
  assert.deepEqual(ageOn("2026-01-31", "2026-03-01"), {
    months: 1,
    days: 1,
    valid: true,
  });
  assert.deepEqual(ageOn("2024-02-29", "2025-02-28"), {
    months: 12,
    days: 0,
    valid: true,
  });
});

test("出生当天为0个月0天，隔天为1天", () => {
  assert.deepEqual(ageOn("2026-11-04", "2026-11-04"), {
    months: 0,
    days: 0,
    valid: true,
  });
  assert.deepEqual(ageOn("2026-11-04", "2026-11-05"), {
    months: 0,
    days: 1,
    valid: true,
  });
});

test("无效日期、未来出生日期不会产生误导月龄", () => {
  assert.equal(ageOn("2026-02-30", "2026-03-01").valid, false);
  assert.deepEqual(ageOn("2026-12-01", "2026-11-04"), {
    months: 0,
    days: 0,
    valid: false,
  });
  assert.equal(ageOn("2026/01/01", "2026-11-04").valid, false);
});

test("活动阶段边界落在下一阶段，且覆盖到60个月以上", () => {
  assert.equal(guideForAge(0).id, "0-2");
  assert.equal(guideForAge(2).id, "2-4");
  assert.equal(guideForAge(24).id, "24-36");
  assert.equal(guideForAge(60).id, "60+");
  assert.equal(AGE_GUIDES.length, 11);
});

test("按宝宝生日自动选择参考阶段，不改变宝宝资料", () => {
  const result = guideForBaby(
    { name: "小满", birthDate: "2026-09-04" },
    "2026-11-04",
  );
  assert.equal(result.age.months, 2);
  assert.equal(result.guide.id, "2-4");
});
