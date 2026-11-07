import { test } from "node:test";
import assert from "node:assert/strict";
import {
  achievedMilestones,
  milestoneKey,
  toggleMilestone,
} from "../src/domain/milestones.ts";
import { AGE_GUIDES } from "../src/data/age-guides.ts";

test("勾选写入日期，再勾一次取消", () => {
  const key = milestoneKey("0-2", 0);
  const on = toggleMilestone({}, key, "2026-11-07");
  assert.deepEqual(on, { "0-2:0": "2026-11-07" });
  const off = toggleMilestone(on, key, "2026-11-08");
  assert.deepEqual(off, {});
  // 不改原对象
  assert.deepEqual(on, { "0-2:0": "2026-11-07" });
});

test("达成清单按日期倒序，并带上原文与月龄段", () => {
  const first = AGE_GUIDES[0]!;
  const map = {
    [milestoneKey(first.id, 0)]: "2026-11-01",
    [milestoneKey(first.id, 1)]: "2026-11-05",
  };
  const list = achievedMilestones(map);
  assert.equal(list.length, 2);
  assert.equal(list[0]!.date, "2026-11-05");
  assert.equal(list[0]!.text, first.focus[1]);
  assert.equal(list[0]!.guideLabel, first.label);
  assert.equal(list[1]!.date, "2026-11-01");
});

test("未知键不会出现在清单里", () => {
  assert.deepEqual(achievedMilestones({ "not-a-guide:9": "2026-11-01" }), []);
});
