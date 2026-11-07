import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUICK_ACTIONS,
  manualSleepDraft,
  quickActionLabel,
  quickCareDraft,
  wakeUpCare,
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

test("点「醒来」把进行中的「睡着」补成一段睡眠，不另起一条", () => {
  const asleep = quickCareDraft("asleep", at);
  const care = wakeUpCare(asleep.care!, asleep.capturedAt, new Date("2026-11-07T10:16:20"));
  assert.equal(care.kind, "sleep");
  assert.equal(care.sleepState, "duration");
  assert.equal(care.durationMinutes, 95);
  assert.equal(care.sourceText, "快记：睡着；快记：醒来");
  assert.equal(validateEntry({ ...asleep, care }), null);
  assert.equal(wakeUpCare(asleep.care!, asleep.capturedAt, at).durationMinutes, 1);
  assert.equal(
    wakeUpCare(asleep.care!, asleep.capturedAt, new Date("2026-11-07T08:00:00")).durationMinutes,
    1,
  );
});

test("补记睡眠只填两个时间：跨午夜、醒来晚于现在都往前推一天", () => {
  const now = new Date("2026-11-07T08:41:00");
  const nap = manualSleepDraft("06:30", "07:50", now)!;
  assert.equal(nap.capturedAt, "2026-11-07T06:30");
  assert.equal(nap.title, "睡眠记录");
  assert.equal(nap.tag, "睡眠");
  assert.equal(nap.care?.sleepState, "duration");
  assert.equal(nap.care?.durationMinutes, 80);
  assert.equal(validateEntry(nap), null);

  const night = manualSleepDraft("22:10", "06:40", now)!;
  assert.equal(night.capturedAt, "2026-11-06T22:10");
  assert.equal(night.care?.durationMinutes, 510);

  const yesterday = manualSleepDraft("13:00", "14:30", now)!;
  assert.equal(yesterday.capturedAt, "2026-11-06T13:00");
  assert.equal(yesterday.care?.durationMinutes, 90);

  assert.equal(manualSleepDraft("08:41", "08:41", now), null, "两个时间相同");
  assert.equal(manualSleepDraft("", "08:41", now), null, "没填睡着时间");
});
