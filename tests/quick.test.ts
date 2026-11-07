import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUICK_ACTIONS,
  quickActionLabel,
  quickCareDraft,
} from "../src/domain/quick.ts";
import { validateEntry } from "../src/domain/records.ts";

const at = new Date("2026-11-07T08:41:00");

test("快记默认当前时间，四个动作各有对应照护类型", () => {
  const feeding = quickCareDraft("feeding", at);
  assert.equal(feeding.capturedAt, "2026-11-07T08:41");
  assert.equal(feeding.title, "喂奶记录");
  assert.equal(feeding.tag, "喂奶");
  assert.deepEqual(feeding.care, { kind: "feeding", sourceText: "快记：喂奶" });

  const diaper = quickCareDraft("diaper", at);
  assert.equal(diaper.care?.kind, "diaper");
  assert.equal(diaper.care?.diaper, "changed");
  assert.equal(diaper.tag, "换尿布");

  const asleep = quickCareDraft("asleep", at);
  assert.equal(asleep.care?.kind, "sleep");
  assert.equal(asleep.care?.sleepState, "asleep");
  assert.equal(asleep.tag, "睡眠");

  const awake = quickCareDraft("awake", at);
  assert.equal(awake.care?.sleepState, "awake");
  assert.equal(awake.title, "醒来记录");
});

test("快记不填数量与时长，避免替家长编数字", () => {
  for (const action of QUICK_ACTIONS) {
    const draft = quickCareDraft(action.id, at);
    assert.equal(draft.care?.amountMl, undefined);
    assert.equal(draft.care?.durationMinutes, undefined);
    assert.equal(draft.note, "");
    assert.equal(validateEntry(draft), null, action.id);
  }
});

test("快记的按钮文案固定，便于测试与界面复用", () => {
  assert.deepEqual(
    QUICK_ACTIONS.map((item) => item.label),
    ["喂奶", "尿布", "睡着", "醒来"],
  );
  assert.equal(quickActionLabel("awake"), "醒来");
});
