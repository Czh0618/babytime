import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVoiceTranscript,
  validateVoiceDraft,
  voiceDraftToEntry,
} from "../src/domain/voice-parser.ts";

const now = new Date(2026, 10, 4, 18, 30, 0);

test("连续照护事件继承下午语境并拆成三条", () => {
  const drafts = parseVoiceTranscript(
    "下午三点十分喂了九十毫升奶，四点换了尿布，五点睡着了",
    now,
  );
  assert.equal(drafts.length, 3);
  assert.deepEqual(
    drafts.map((item) => item.kind),
    ["feeding", "diaper", "sleep"],
  );
  assert.equal(drafts[0]!.amountMl, 90);
  assert.equal(drafts[0]!.capturedAt, "2026-11-04T15:10");
  assert.equal(drafts[1]!.capturedAt, "2026-11-04T16:00");
  assert.equal(drafts[2]!.capturedAt, "2026-11-04T17:00");
});

test("刚刚喂奶保留当前时间与显式毫升数", () => {
  const [draft] = parseVoiceTranscript("刚刚喂奶90ml", now);
  assert.equal(draft!.kind, "feeding");
  assert.equal(draft!.amountMl, 90);
  assert.equal(draft!.capturedAt, "2026-11-04T18:30");
});

test("相对时间和睡眠时长被分别识别", () => {
  const [halfHour] = parseVoiceTranscript("半小时前睡着了", now);
  const [duration] = parseVoiceTranscript("睡了半个小时", now);
  assert.equal(halfHour!.capturedAt, "2026-11-04T18:00");
  assert.equal(duration!.durationMinutes, 30);
  assert.equal(duration!.sleepState, "duration");
});

test("没有上午下午的三点不猜时刻", () => {
  const [draft] = parseVoiceTranscript("三点喂奶", now);
  assert.equal(draft!.capturedAt, "");
  assert.equal(draft!.needsTimeConfirmation, true);
  assert.match(draft!.timeHint ?? "", /三点/);
  const validation = validateVoiceDraft(draft!);
  assert.ok(validation);
  assert.match(validation, /时间/);
});

test("昨天晚上和中午十二点按本地日期换算", () => {
  const [yesterday] = parseVoiceTranscript("昨天晚上十点喂奶", now);
  const [noon] = parseVoiceTranscript("今天中午十二点换了尿布", now);
  assert.equal(yesterday!.capturedAt, "2026-11-03T22:00");
  assert.equal(noon!.capturedAt, "2026-11-04T12:00");
});

test("没有时间的换尿布使用传入当前时间", () => {
  const [draft] = parseVoiceTranscript("换了尿布", now);
  assert.equal(draft!.kind, "diaper");
  assert.equal(draft!.capturedAt, "2026-11-04T18:30");
  assert.equal(draft!.diaper, "changed");
});

test("只说今天喂奶不猜具体时刻", () => {
  const [draft] = parseVoiceTranscript("今天喂奶", now);
  assert.equal(draft!.capturedAt, "");
  assert.equal(draft!.needsTimeConfirmation, true);
});

test("没有逗号时按下一个明确时间切开事件", () => {
  const drafts = parseVoiceTranscript("下午三点喂奶四点换尿布", now);
  assert.deepEqual(
    drafts.map((item) => item.kind),
    ["feeding", "diaper"],
  );
  assert.equal(drafts[1]!.capturedAt, "2026-11-04T16:00");
});

test("刚刚喂奶但还没换尿布只记录已经发生的喂奶", () => {
  const drafts = parseVoiceTranscript("刚刚喂奶但还没换尿布", now);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]!.kind, "feeding");
});

test("中文数字解析，奶奶抱宝宝不误判喂奶", () => {
  const [feeding] = parseVoiceTranscript("下午四点喂了一百二十毫升奶", now);
  const [note] = parseVoiceTranscript("奶奶来抱宝宝", now);
  const [negative] = parseVoiceTranscript("还没换尿布", now);
  assert.equal(feeding!.amountMl, 120);
  assert.equal(note!.kind, "note");
  assert.equal(note!.title, "日常备注");
  assert.equal(negative, undefined);
});

test("无法理解的话保留为日常备注且不生成建议", () => {
  const [draft] = parseVoiceTranscript("今天风很大，宝宝一直看着窗外", now);
  assert.equal(draft!.kind, "note");
  assert.equal(draft!.sourceText, "今天风很大，宝宝一直看着窗外");
  assert.equal(draft!.capturedAt, "2026-11-04T18:30");
  assert.equal(draft!.amountMl, undefined);
});

test("转换为成长记录时保留照护事实和输入幂等键", () => {
  const [draft] = parseVoiceTranscript("刚刚喂奶90ml", now);
  const entry = voiceDraftToEntry(draft!, "voice-input-1");
  assert.equal(entry.tag, "喂奶");
  assert.equal(entry.milestone, false);
  assert.deepEqual(entry.care, {
    kind: "feeding",
    amountMl: 90,
    durationMinutes: undefined,
    sleepState: undefined,
    diaper: undefined,
    sourceText: "刚刚喂奶90ml",
    inputId: "voice-input-1",
  });
});

test("半点、刻钟和数字冒号都保留分钟", () => {
  const half = parseVoiceTranscript("今天上午八点半喂奶", now)[0]!;
  const quarter = parseVoiceTranscript("下午三点一刻喂奶", now)[0]!;
  const threeQuarter = parseVoiceTranscript("下午三点三刻喂奶", now)[0]!;
  const colon = parseVoiceTranscript("今天上午8:30喂奶", now)[0]!;
  assert.equal(half.capturedAt, "2026-11-04T08:30");
  assert.equal(quarter.capturedAt, "2026-11-04T15:15");
  assert.equal(threeQuarter.capturedAt, "2026-11-04T15:45");
  assert.equal(colon.capturedAt, "2026-11-04T08:30");
});

test("多一点或左右属于含糊时间，不能静默当作整点", () => {
  const more = parseVoiceTranscript("下午三点多喂奶", now)[0]!;
  const around = parseVoiceTranscript("下午三点左右喂奶", now)[0]!;
  assert.equal(more.needsTimeConfirmation, true);
  assert.equal(around.needsTimeConfirmation, true);
  assert.equal(more.capturedAt, "");
  assert.equal(around.capturedAt, "");
});

test("计划语句保留为备注，不生成已经发生的照护事件", () => {
  for (const text of ["准备喂奶", "晚点换尿布", "明天喂奶"]) {
    const [draft] = parseVoiceTranscript(text, now);
    assert.equal(draft!.kind, "note", text);
    assert.equal(draft!.sourceText, text);
  }
});
